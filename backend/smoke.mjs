/**
 * End-to-end HTTP smoke test against a running server.
 *
 * Deliberately not part of the Jest suite: it needs a live server and it writes data. The unit tests
 * cover the policy functions in isolation; this covers the wiring — guards actually mounted, DTOs
 * actually validating, indexes actually used, and every deny rule enforced over real HTTP.
 *
 * It provisions the fixtures it needs through the API as admin, so it runs against a freshly deployed
 * stack that contains nothing but the bootstrapped admin account:
 *
 *   node smoke.mjs                                            # local dev server on :3001
 *   SMOKE_BASE=http://127.0.0.1:3000/api \
 *     SMOKE_ADMIN_PASSWORD=... node smoke.mjs                 # a docker compose stack via the proxy
 *
 * Env: SMOKE_BASE, SMOKE_ADMIN_EMAIL, SMOKE_ADMIN_PASSWORD.
 */
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3001/api';
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${extra ? `  -- ${extra}` : ''}`);
  if (!cond) fails++;
};
const section = (s) => console.log(`\n### ${s}`);

async function req(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
const msg = (r) => (r.body && r.body.message ? JSON.stringify(r.body.message) : JSON.stringify(r.body).slice(0, 160));
const cut = (v, n = 260) => JSON.stringify(v).slice(0, n);

async function login(email, password) {
  const r = await req('/auth/login', { method: 'POST', body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${msg(r)}`);
  return r.body.access_token;
}

const stamp = Date.now().toString(36);
const iso = (d) => d.toISOString().slice(0, 10);

// ISO week: Monday-start, Sunday-end, in UTC — the same definition the payment settlement uses.
const now = new Date();
const isoDay = now.getUTCDay() || 7;
const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (isoDay - 1)));
const PREV_MONDAY = iso(new Date(thisMonday.getTime() - 7 * 86_400_000));
const TODAY = iso(now);

/**
 * Bring the deployment to a known state using nothing but admin API calls.
 *
 * Everything below is idempotent, so the script can be run repeatedly against the same database — and
 * because it only uses public endpoints, it doubles as a test of the admin provisioning flow itself.
 */
async function provision(adminToken) {
  const BIDDERS = [
    { username: 'john', email: 'john@example.com', role: 'bidder', workspace: 'John Applications' },
    { username: 'mike', email: 'mike@example.com', role: 'bidder_manager', workspace: 'Mike Applications' },
    { username: 'sarah', email: 'sarah@example.com', role: 'bidder', workspace: 'Sarah Applications' },
  ];
  const PASSWORD = 'Password123!';

  const existingUsers = (await req('/users', { token: adminToken })).body;
  const userByEmail = new Map(existingUsers.map((u) => [u.email, u]));

  for (const b of BIDDERS) {
    let user = userByEmail.get(b.email);
    if (!user) {
      const created = await req('/users', {
        method: 'POST',
        token: adminToken,
        body: { username: b.username, email: b.email, password: PASSWORD, role: b.role },
      });
      if (created.status >= 300) throw new Error(`could not create ${b.email}: ${msg(created)}`);
      user = created.body;
    } else {
      // The password may be whatever a previous seed chose, so normalise it rather than guess.
      await req(`/users/${user.id}/reset-password`, {
        method: 'POST',
        token: adminToken,
        body: { new_password: PASSWORD },
      });
      await req(`/users/${user.id}`, { method: 'PATCH', token: adminToken, body: { is_active: true, role: b.role } });
    }
    b.userId = user.id;
  }

  const existingWorkspaces = (await req('/workspaces', { token: adminToken })).body;
  const wsByName = new Map(existingWorkspaces.map((w) => [w.name, w]));
  for (const b of BIDDERS) {
    let ws = wsByName.get(b.workspace);
    if (!ws) {
      const created = await req('/workspaces', {
        method: 'POST',
        token: adminToken,
        body: { name: b.workspace, owner_user_id: b.userId },
      });
      if (created.status >= 300) throw new Error(`could not create ${b.workspace}: ${msg(created)}`);
      ws = created.body;
    }
    b.workspaceId = ws.id;
  }

  // The spec's own example: Mike manages John's tab without owning it.
  const johnWs = BIDDERS[0].workspaceId;
  await req(`/workspaces/${johnWs}/permissions`, {
    method: 'POST',
    token: adminToken,
    body: { user_id: BIDDERS[1].userId, permission_type: 'edit' },
  });

  // Rows inside the previous ISO week, so the weekly settlement has something to count. Statuses are
  // mixed on purpose: only the Applied ones may ever appear in a payment.
  for (const b of BIDDERS) {
    const urls = Array.from(
      { length: 6 },
      (_, i) => `https://boards.greenhouse.io/${b.username}-wk/jobs/${stamp}-${i}`,
    ).join('\n');
    await req('/applications/urls', {
      method: 'POST',
      token: adminToken,
      body: { workspace_id: b.workspaceId, date: PREV_MONDAY, urls, enrich: false },
    });
    const week = (
      await req(
        `/applications?workspace_id=${b.workspaceId}&date_from=${PREV_MONDAY}&date_to=${PREV_MONDAY}&search=${stamp}&page_size=10`,
        { token: adminToken },
      )
    ).body.items;
    const ids = week.map((r) => r.id);
    if (ids.length >= 5) {
      await req('/applications/bulk', {
        method: 'PATCH',
        token: adminToken,
        body: { ids: ids.slice(0, 3), patch: { application_status: 'Applied' } },
      });
      await req(`/applications/${ids[3]}`, {
        method: 'PATCH',
        token: adminToken,
        body: { application_status: 'Rejected' },
      });
      // ids[4] and beyond stay Pending, which is what makes "all rows > paid-for rows" meaningful.
    }
  }

  // Rows dated today in John's tab: the open rows the policy checks edit, plus one already-paid row.
  // Today is never inside the previous ISO week, so touching these cannot disturb the payment figures.
  const urls = Array.from(
    { length: 8 },
    (_, i) => `https://jobs.lever.co/john-today/${stamp}-${i}`,
  ).join('\n');
  await req('/applications/urls', {
    method: 'POST',
    token: adminToken,
    body: { workspace_id: johnWs, date: TODAY, urls, enrich: false },
  });
  const today = (
    await req(`/applications?workspace_id=${johnWs}&date_from=${TODAY}&date_to=${TODAY}&search=${stamp}&page_size=20`, {
      token: adminToken,
    })
  ).body.items;
  if (today.length) {
    // One row taken all the way to paid: the paid lock has to be tested against a real locked row.
    const lockMe = today[today.length - 1].id;
    await req(`/applications/${lockMe}`, {
      method: 'PATCH',
      token: adminToken,
      body: { application_status: 'Applied' },
    });
    await req(`/applications/${lockMe}`, {
      method: 'PATCH',
      token: adminToken,
      body: { paid: true },
    });
  }

  return { password: PASSWORD };
}

section('provision fixtures');
const adminBoot = await login(
  process.env.SMOKE_ADMIN_EMAIL || 'admin@example.com',
  process.env.SMOKE_ADMIN_PASSWORD || 'devpassword',
);
const { password: BIDDER_PASSWORD } = await provision(adminBoot);
check('fixtures provisioned through the admin API', true, `week=${PREV_MONDAY} today=${TODAY}`);

section('auth');
const admin = adminBoot;
const john = await login('john@example.com', BIDDER_PASSWORD);
const mike = await login('mike@example.com', BIDDER_PASSWORD);
const sarah = await login('sarah@example.com', BIDDER_PASSWORD);
check('four logins succeed', true);
const me = await req('/auth/me', { token: john });
check('/auth/me returns the caller', me.status === 200 && me.body.username === 'john');
check('/auth/me never returns password_hash', !JSON.stringify(me.body).includes('password_hash'));
check('garbage token rejected', (await req('/auth/me', { token: 'not.a.jwt' })).status === 401);

section('workspace scope');
const wsAdmin = await req('/workspaces', { token: admin });
check('admin sees every workspace', wsAdmin.body.length >= 3, wsAdmin.body.map((w) => w.name).join(', '));
check('bidder sees only their own', (await req('/workspaces', { token: john })).body.length === 1);
check('manager sees own + granted', (await req('/workspaces', { token: mike })).body.length === 2);
const JW = wsAdmin.body.find((w) => w.name === 'John Applications').id;
const MW = wsAdmin.body.find((w) => w.name === 'Mike Applications').id;
const SW = wsAdmin.body.find((w) => w.name === 'Sarah Applications').id;
// 404 rather than 403 is deliberate: a bidder should not be able to probe which workspace ids exist.
check('cross-workspace read is refused', (await req(`/applications?workspace_id=${JW}`, { token: sarah })).status === 404);
check('cross-workspace write is refused', (await req(`/workspaces/${JW}`, { token: sarah })).status === 404);

section('paged reads');
const t0 = Date.now();
const p1 = await req(`/applications?workspace_id=${JW}&page=1&page_size=100`, { token: admin });
// Scale-adaptive: this same script runs against a freshly provisioned deployment holding a couple of
// dozen rows and against the 150,000-row perf database, so assert the window, not an absolute count.
const wsTotal = p1.body.total;
check(
  'page 1 fills the window',
  p1.status === 200 && p1.body.items.length === Math.min(100, wsTotal),
  `total=${wsTotal} page_size=${p1.body.page_size} pages=${p1.body.total_pages} ${Date.now() - t0}ms`,
);
check('default sort is date desc', new Date(p1.body.items[0].date) >= new Date(p1.body.items.at(-1).date));
check(
  'page_size above the cap is rejected',
  (await req(`/applications?workspace_id=${JW}&page_size=5000`, { token: admin })).status === 400,
);
if (wsTotal > 600) {
  const t1 = Date.now();
  const deep = await req(`/applications?workspace_id=${JW}&page=7&page_size=100`, { token: admin });
  check('deep page (offset 600)', deep.status === 200 && deep.body.items.length === 100, `${Date.now() - t1}ms`);
  check('no id overlap between pages', !p1.body.items.some((r) => deep.body.items.find((d) => d.id === r.id)));
} else {
  console.log(`skip  deep-page checks -- workspace holds ${wsTotal} rows, needs > 600 (run prisma/seed.ts)`);
}

const applied = await req(`/applications?workspace_id=${JW}&application_status=Applied&page_size=20`, { token: admin });
check('status filter', applied.body.items.every((r) => r.application_status === 'Applied'), `total=${applied.body.total}`);
const multi = await req(`/applications?workspace_id=${JW}&application_status=Applied,Pending&page_size=20`, {
  token: admin,
});
check(
  'multi-value status filter',
  multi.body.items.every((r) => ['Applied', 'Pending'].includes(r.application_status)),
  `total=${multi.body.total}`,
);
const src = await req(`/applications?workspace_id=${JW}&job_source=Lever&page_size=5`, { token: admin });
check('job_source filter', src.body.items.every((r) => r.job_source === 'Lever'), `total=${src.body.total}`);
const paidOnly = await req(`/applications?workspace_id=${JW}&paid=true&page_size=5`, { token: admin });
check('paid filter', paidOnly.body.items.every((r) => r.paid === true), `total=${paidOnly.body.total}`);
const search = await req(`/applications?workspace_id=${JW}&search=greenhouse&page_size=5`, { token: admin });
check('search matches url/company/title', search.status === 200 && search.body.total > 0, `total=${search.body.total}`);
const numSort = await req(`/applications?workspace_id=${JW}&sort_by=number&sort_dir=asc&page_size=5`, { token: admin });
check('sort by number asc', numSort.body.items[0].number <= numSort.body.items.at(-1).number);
check(
  'unknown sort column rejected',
  (await req(`/applications?workspace_id=${JW}&sort_by=password_hash`, { token: admin })).status === 400,
);
const sum = await req(`/applications/summary?workspace_id=${JW}`, { token: admin });
check('summary endpoint', sum.status === 200, cut(sum.body, 220));
check('/applications/meta enum catalogue', (await req('/applications/meta', { token: john })).body.job_sources?.length > 5);

section('field-level policy (bidder)');
// Restricted to today on purpose. This section drives a row through Applied and Rejected, and the
// payment checks further down count Applied rows in the *previous* ISO week — mutating one of those
// would silently move the figures the cross-check is supposed to validate.
const openRow = (
  await req(
    `/applications?workspace_id=${JW}&application_status=Pending&paid=false&date_from=${TODAY}&date_to=${TODAY}&page_size=1`,
    { token: admin },
  )
).body.items[0];
const titleEdit = await req(`/applications/${openRow.id}`, {
  method: 'PATCH',
  token: john,
  body: { job_title: 'Smoke Test Title' },
});
check('bidder may edit job_title on an open row', titleEdit.status === 200 && titleEdit.body.job_title === 'Smoke Test Title', msg(titleEdit));
const dupAttempt = await req(`/applications/${openRow.id}`, {
  method: 'PATCH',
  token: john,
  body: { application_status: 'Duplicated' },
});
check('bidder cannot set Duplicated', dupAttempt.status === 403, `${dupAttempt.status} ${msg(dupAttempt)}`);
const pipeAttempt = await req(`/applications/${openRow.id}`, {
  method: 'PATCH',
  token: john,
  body: { pipeline_status: 'Offer Received' },
});
check('bidder cannot set pipeline_status via PATCH', pipeAttempt.status === 403, `${pipeAttempt.status} ${msg(pipeAttempt)}`);
const paidAttempt = await req(`/applications/${openRow.id}`, { method: 'PATCH', token: john, body: { paid: true } });
check('bidder cannot set paid', paidAttempt.status === 403, `${paidAttempt.status} ${msg(paidAttempt)}`);
const pipeRoute = await req(`/applications/${openRow.id}/pipeline`, {
  method: 'PATCH',
  token: john,
  body: { pipeline_status: 'Offer Received' },
});
check('pipeline route is admin-only', pipeRoute.status === 403, `${pipeRoute.status}`);

const toApplied = await req(`/applications/${openRow.id}`, {
  method: 'PATCH',
  token: john,
  body: { application_status: 'Applied' },
});
check('Pending -> Applied allowed', toApplied.status === 200 && toApplied.body.application_status === 'Applied', msg(toApplied));
const backToPending = await req(`/applications/${openRow.id}`, {
  method: 'PATCH',
  token: john,
  body: { application_status: 'Pending' },
});
check('Applied -> Pending rejected', backToPending.status === 403, `${backToPending.status} ${msg(backToPending)}`);
const toRejected = await req(`/applications/${openRow.id}`, {
  method: 'PATCH',
  token: john,
  body: { application_status: 'Rejected' },
});
check('Applied -> Rejected allowed', toRejected.status === 200, msg(toRejected));
const revive = await req(`/applications/${openRow.id}`, {
  method: 'PATCH',
  token: john,
  body: { application_status: 'Applied' },
});
check('Rejected -> Applied rejected', revive.status === 403, `${revive.status} ${msg(revive)}`);
const adminRevive = await req(`/applications/${openRow.id}`, {
  method: 'PATCH',
  token: admin,
  body: { application_status: 'Applied' },
});
check('admin may override any transition', adminRevive.status === 200, msg(adminRevive));

section('paid lock');
const paidRow = (await req(`/applications?workspace_id=${JW}&paid=true&page_size=1`, { token: admin })).body.items[0];
const lockedEdit = await req(`/applications/${paidRow.id}`, {
  method: 'PATCH',
  token: john,
  body: { note: 'should not stick' },
});
check('bidder cannot edit a paid row', lockedEdit.status === 403, `${lockedEdit.status} ${msg(lockedEdit)}`);
const adminLocked = await req(`/applications/${paidRow.id}`, {
  method: 'PATCH',
  token: admin,
  body: { note: 'admin override note' },
});
check('admin can edit a paid row', adminLocked.status === 200 && adminLocked.body.note === 'admin override note', msg(adminLocked));

section('bulk paths reuse the same policy');
// Today only, for the same reason as `openRow` above: these rows get flipped to Applied and paid.
const bulkIds = (
  await req(
    `/applications?workspace_id=${JW}&application_status=Pending&paid=false&date_from=${TODAY}&date_to=${TODAY}&page_size=3`,
    { token: admin },
  )
).body.items.map((r) => r.id);
check('three open rows available for the bulk checks', bulkIds.length === 3, `found ${bulkIds.length}`);
const bulkDup = await req('/applications/bulk', {
  method: 'PATCH',
  token: john,
  body: { ids: bulkIds, patch: { application_status: 'Duplicated' } },
});
check('bulk cannot smuggle Duplicated', bulkDup.status === 403 || bulkDup.body.updated === 0, `${bulkDup.status} ${msg(bulkDup)}`);
const bulkPipe = await req('/applications/bulk', {
  method: 'PATCH',
  token: john,
  body: { ids: bulkIds, patch: { pipeline_status: 'Accepted' } },
});
check('bulk cannot smuggle pipeline_status', bulkPipe.status === 403 || bulkPipe.body.updated === 0, `${bulkPipe.status} ${msg(bulkPipe)}`);
const bulkOk = await req('/applications/bulk', {
  method: 'PATCH',
  token: john,
  body: { ids: bulkIds, patch: { application_status: 'Applied' } },
});
check('bulk Pending -> Applied works', bulkOk.status === 200 && bulkOk.body.updated === bulkIds.length, msg(bulkOk));
check(
  'bulk-delete is admin-only',
  (await req('/applications/bulk-delete', { method: 'POST', token: mike, body: { ids: bulkIds } })).status === 403,
);
const markPaid = await req(`/applications/${bulkIds[0]}`, { method: 'PATCH', token: admin, body: { paid: true } });
check('admin can mark a row paid', markPaid.status === 200, msg(markPaid));
const afterPaid = await req(`/applications/${bulkIds[0]}`, { token: admin });
check(
  'paid boolean is returned',
  afterPaid.body.paid === true && !('paid_by' in afterPaid.body) && !('paid_at' in afterPaid.body),
  `paid=${afterPaid.body.paid}`,
);
await req(`/applications/${bulkIds[0]}`, { method: 'PATCH', token: admin, body: { paid: false } });

section('URL paste, numbering and duplicates');
// A date this run has never used before, so "numbering restarts at 1" is a real assertion rather than
// a coincidence. Far enough out that no seeded or provisioned row can share it.
const DATE = iso(new Date(Date.UTC(2030, 0, 1) + (Date.now() % 3000) * 86_400_000));
const urls = [
  `https://boards.greenhouse.io/smoketest/jobs/${stamp}?utm_source=x&gh_src=y`,
  `https://jobs.lever.co/smoketest/${stamp}-b`,
  `HTTPS://BOARDS.GREENHOUSE.IO/smoketest/jobs/${stamp}/`,
  'not-a-url-at-all',
].join('\n');
const preview = await req('/applications/urls/preview', { method: 'POST', token: john, body: { workspace_id: JW, urls } });
check('preview endpoint responds', preview.status === 200, cut(preview.body, 300));
const ins = await req('/applications/urls', {
  method: 'POST',
  token: john,
  body: { workspace_id: JW, date: DATE, urls, enrich: false },
});
check(
  'paste inserts the valid lines and rejects the malformed one',
  ins.status < 300 && ins.body.created === 3 && ins.body.invalid_lines.length === 1 && ins.body.duplicates === 1,
  cut(ins.body, 300),
);
const day = await req(
  `/applications?workspace_id=${JW}&date_from=${DATE}&date_to=${DATE}&sort_by=number&sort_dir=asc&page_size=50`,
  { token: admin },
);
check(
  'numbering restarts at 1 for a fresh date',
  day.body.items.length > 0 && day.body.items[0].number === 1,
  `numbers=${day.body.items.map((r) => r.number).join(',')}`,
);
check('numbers are contiguous', day.body.items.every((r, i) => r.number === i + 1));
check(
  'job source detected from hostname',
  day.body.items.some((r) => r.job_source === 'Greenhouse') && day.body.items.some((r) => r.job_source === 'Lever'),
  day.body.items.map((r) => r.job_source).join(','),
);
check('tracking params stripped from normalized_url', day.body.items.every((r) => !r.normalized_url.includes('utm_source')));
// Fetch this run's rows by search rather than by reading the first page of the day: on a large
// database the date already holds hundreds of seeded rows and the new ones sit far past page 1.
// `smoketest` narrows to the paste fixtures; `stamp` then narrows to this run's three.
const thisRun = (await req(`/applications?workspace_id=${JW}&search=smoketest&page_size=200`, { token: admin })).body.items.filter(
  (r) => r.url.includes(stamp),
);
check('the three pasted rows are retrievable', thisRun.length === 3, `found ${thisRun.length}`);
const dupRow = thisRun.find((r) => r.application_status === 'Duplicated');
check('case/trailing-slash variant auto-flagged Duplicated', !!dupRow, dupRow && dupRow.url);
check(
  'the other two lines inserted un-flagged',
  thisRun.filter((r) => r.application_status !== 'Duplicated').length === 2,
  `statuses=${thisRun.map((r) => r.application_status).join(',')}`,
);
if (dupRow) {
  const clearDup = await req(`/applications/${dupRow.id}`, {
    method: 'PATCH',
    token: john,
    body: { application_status: 'Applied' },
  });
  check('bidder cannot un-duplicate a row', clearDup.status === 403, `${clearDup.status}`);
  check(
    'admin can un-duplicate',
    (await req(`/applications/${dupRow.id}`, { method: 'PATCH', token: admin, body: { application_status: 'Applied' } }))
      .status === 200,
  );
}

section('spreadsheet import');
async function upload(path, token, csv, fields = {}) {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'import.csv');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(BASE + path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
// Deliberately messy: aliased headers, a blank URL, a malformed URL, a duplicate of row 1, and a
// Status column a bidder is not allowed to honour.
// Its own fresh date, so "imported rows numbered from 1" cannot pass on leftovers from a prior run.
const IDATE = iso(new Date(Date.parse(DATE) + 86_400_000));
const csv = [
  'Date,Job Title,Company,Job URL,Status,Notes,Resume',
  `${IDATE},Staff Engineer,"Acme, Inc.",https://boards.greenhouse.io/importtest/jobs/${stamp}1,Applied,"Referred, strong fit",https://d.example.com/r1.pdf`,
  `${IDATE},Backend Engineer,Globex,https://jobs.lever.co/importtest/${stamp}2,Pending,,`,
  `${IDATE},Duplicate Row,Acme,https://boards.greenhouse.io/importtest/jobs/${stamp}1/,Applied,,`,
  `${IDATE},No URL Row,Initech,,Applied,,`,
  `${IDATE},Bad URL Row,Initech,http://,Applied,,`,
  `${IDATE},Smuggled Status,Hooli,https://jobs.lever.co/importtest/${stamp}3,Duplicated,,`,
].join('\n');

check('import rejects an unsupported extension', (await (async () => {
  const form = new FormData();
  form.append('file', new Blob(['x'], { type: 'application/pdf' }), 'resume.pdf');
  const r = await fetch(`${BASE}/import/${JW}`, { method: 'POST', headers: { Authorization: `Bearer ${john}` }, body: form });
  return r.status;
})()) === 400);

const impPreview = await upload(`/import/${JW}/preview`, john, csv);
check('import preview maps aliased headers', impPreview.status < 300, cut(impPreview.body, 420));
const impRun = await upload(`/import/${JW}`, john, csv, { enrich: 'false' });
check('import commits rows', impRun.status < 300, cut(impRun.body, 420));

const firstOfDay = await req(
  `/applications?workspace_id=${JW}&date_from=${IDATE}&date_to=${IDATE}&sort_by=number&sort_dir=asc&page_size=1`,
  { token: admin },
);
check('imported rows numbered from 1', firstOfDay.body.items[0]?.number === 1, `rows on that date=${firstOfDay.body.total}`);
const importedAll = await req(`/applications?workspace_id=${JW}&search=importtest&page_size=200`, { token: admin });
const importedRows = importedAll.body.items.filter((r) => r.url.includes(stamp));
check('the four imported rows are retrievable', importedRows.length === 4, `found ${importedRows.length}`);
check(
  'quoted comma survives CSV parsing',
  importedRows.some((r) => r.company_name === 'Acme, Inc.'),
  importedRows.map((r) => r.company_name).join(' | '),
);
check(
  'import duplicate flagged from normalized url',
  importedRows.filter((r) => r.application_status === 'Duplicated').length === 1,
  importedRows.map((r) => r.application_status).join(' | '),
);
const smuggled = importedRows.find((r) => r.job_title === 'Smuggled Status');
check(
  'import Status column cannot smuggle Duplicated for a bidder',
  !smuggled || smuggled.application_status !== 'Duplicated',
  smuggled && `status=${smuggled.application_status}`,
);
check(
  'rows without a usable URL were skipped',
  importedRows.every((r) => r.job_title !== 'No URL Row' && r.job_title !== 'Bad URL Row'),
  importedRows.map((r) => r.job_title).join(' | '),
);
check('import is refused on a workspace the caller cannot edit', (await upload(`/import/${JW}`, sarah, csv)).status === 404);

section('payments');
check('bidder blocked from /payments', (await req('/payments/weekly', { token: john })).status === 403);
check('manager blocked from /payments', (await req('/payments/weekly', { token: mike })).status === 403);
const prev = await req('/payments/weekly/preview', { token: admin });
check('weekly preview', prev.status === 200, cut(prev.body, 400));
const gen1 = await req('/payments/weekly/generate', { method: 'POST', token: admin, body: {} });
const gen2 = await req('/payments/weekly/generate', { method: 'POST', token: admin, body: {} });
check(
  'generate is idempotent',
  gen1.status === 200 && gen2.status === 200 && JSON.stringify(gen1.body.rows ?? gen1.body) === JSON.stringify(gen2.body.rows ?? gen2.body),
  cut(gen2.body, 300),
);
const stored = await req('/payments/weekly', { token: admin });
check('stored reports readable', stored.status === 200 && Array.isArray(stored.body), `${stored.body.length} rows`);
const byBidder = await req('/payments/by-bidder', { token: admin });
check('payout grouped by workspace owner', byBidder.status === 200, cut(byBidder.body, 300));

// The spec's hard rules: the week is the previous Monday-Sunday, only Applied counts, and credit
// follows Workspace.owner_user_id. Cross-check the report against an independent filtered query.
const week = prev.body;
const from = week.week_start_date.slice(0, 10);
const to = week.week_end_date.slice(0, 10);
check('week runs Monday to Sunday', new Date(week.week_start_date).getUTCDay() === 1 && new Date(week.week_end_date).getUTCDay() === 0, `${from}..${to}`);
check('week is the one before the current one', new Date(week.week_end_date) < new Date(), week.week_label);
check('preview covers every workspace', week.rows.length >= 3, `${week.rows.length} rows`);
check('every row credits the workspace owner', week.rows.every((r) => !!r.owner_user_id && !!r.owner_username));

// Only the three fixture workspaces are cross-checked: a pre-existing workspace with no rows in this
// week would make the "all rows > paid-for rows" comparison vacuous rather than wrong.
for (const r of week.rows.filter((w) => [JW, MW, SW].includes(w.workspace_id))) {
  const q = await req(
    `/applications?workspace_id=${r.workspace_id}&application_status=Applied&date_from=${from}&date_to=${to}&page_size=1`,
    { token: admin },
  );
  check(
    `applied_count matches an independent query (${r.owner_username})`,
    q.body.total === r.applied_count,
    `report=${r.applied_count} query=${q.body.total}`,
  );
  const everything = await req(
    `/applications?workspace_id=${r.workspace_id}&date_from=${from}&date_to=${to}&page_size=1`,
    { token: admin },
  );
  check(
    `Pending/Rejected/Duplicated excluded from pay (${r.owner_username})`,
    everything.body.total > r.applied_count,
    `all=${everything.body.total} paid-for=${r.applied_count}`,
  );
}

section('analytics');
for (const p of ['overview', 'conversion', 'interviews-by-workspace', 'interviews-by-source', 'pipeline', 'upcoming-interviews']) {
  const r = await req(`/analytics/${p}`, { token: admin });
  check(`GET /analytics/${p}`, r.status === 200, cut(r.body, 180));
}
check('analytics accepts a workspace filter', (await req(`/analytics/conversion?workspace_id=${SW}`, { token: admin })).status === 200);
check('bidder blocked from analytics', [401, 403].includes((await req('/analytics/overview', { token: john })).status));

section('user administration');
check('bidder blocked from /users', (await req('/users', { token: john })).status === 403);
check(
  'manager cannot create users',
  (
    await req('/users', {
      method: 'POST',
      token: mike,
      body: { username: 'x', email: 'x@example.com', password: 'Password123!', role: 'bidder' },
    })
  ).status === 403,
);
const created = await req('/users', {
  method: 'POST',
  token: admin,
  body: { username: `smoke${stamp}`, email: `smoke${stamp}@example.com`, password: 'Password123!', role: 'bidder' },
});
check('admin creates a user', created.status === 201 || created.status === 200, msg(created));
check('created user response has no hash', !JSON.stringify(created.body).includes('password_hash'));
const dupEmail = await req('/users', {
  method: 'POST',
  token: admin,
  body: { username: 'other', email: `smoke${stamp}@example.com`, password: 'Password123!', role: 'bidder' },
});
check('duplicate email rejected', dupEmail.status === 409 || dupEmail.status === 400, `${dupEmail.status}`);
const newTok = await login(`smoke${stamp}@example.com`, 'Password123!');
check('new user can log in', !!newTok);
const chg = await req('/auth/change-password', {
  method: 'POST',
  token: newTok,
  body: { current_password: 'Password123!', new_password: 'Rotated123!' },
});
check('change-password works', chg.status === 200 || chg.status === 201, msg(chg));
check(
  'old password no longer valid',
  (await req('/auth/login', { method: 'POST', body: { email: `smoke${stamp}@example.com`, password: 'Password123!' } })).status === 401,
);
check('new password valid', !!(await login(`smoke${stamp}@example.com`, 'Rotated123!')));
const wrongCurrent = await req('/auth/change-password', {
  method: 'POST',
  token: newTok,
  body: { current_password: 'nope', new_password: 'Another123!' },
});
check('change-password requires the current one', [400, 401, 403].includes(wrongCurrent.status), `${wrongCurrent.status}`);
const deact = await req(`/users/${created.body.id}`, { method: 'PATCH', token: admin, body: { is_active: false } });
check('admin deactivates a user', deact.status === 200, msg(deact));
check(
  'deactivated user cannot log in',
  (await req('/auth/login', { method: 'POST', body: { email: `smoke${stamp}@example.com`, password: 'Rotated123!' } })).status === 401,
);
check('cleanup: delete user', (await req(`/users/${created.body.id}`, { method: 'DELETE', token: admin })).status < 300);

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
