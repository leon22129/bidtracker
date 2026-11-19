const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const base = process.env.PDF_TEST_URL || 'http://127.0.0.1:3118';
const output = path.join(root, '.tmp', 'resume-downloads');
fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(output, 'run-'));
const pending = new Map();
const downloads = new Map();
const errors = [];
let server, browser, sequence = 0, buffer = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(100);
  }
  throw Error(`Timed out: ${label}. ${errors.join('; ')}`);
}

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}

async function evaluate(sessionId, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

function fixture() {
  localStorage.setItem('bidtracker_token', 'pdf-download-fixture');
  const original = window.fetch.bind(window);
  const user = { id: 'pdf-admin', username: 'PDF Test Admin', email: 'pdf@example.test', role: 'admin', is_active: true };
  const workspace = { id: 'pdf-workspace', name: 'PDF download test', owner_user_id: user.id, owner: user, is_archived: false, can_edit: true, profile: null };
  const row = { id: 'pdf-application', workspace_id: workspace.id, number: 1, date: '2026-11-19', job_title: 'Software Engineer', company_name: 'Example Company', url: 'https://example.test/job', job_source: 'Other', application_status: 'Applied', pipeline_status: 'Not Started', paid: false, screenshot: null, documents: [], resume_generated_at: '2026-11-19T12:00:00Z', cover_letter_template: 'classic' };
  const resume = {
    personalInfo: { fullName: 'Test Candidate', title: 'Software Engineer', email: 'candidate@example.test', phone: '555-0100', location: 'New York, NY', linkedin: 'https://www.linkedin.com/in/test-candidate' },
    summary: 'Experienced software engineer building reliable applications and services for distributed teams.',
    skills: [{ category: 'Engineering', items: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'] }],
    workexperience: Array.from({ length: 5 }, (_, index) => ({ role: 'Senior Software Engineer', companyname: `Example Company ${index + 1}`, duration: '2020 - 2026', experience: Array.from({ length: 5 }, () => 'Built reliable services with automated tests, improved application performance, and collaborated across teams to deliver accessible user experiences.') })),
    education: [{ school: 'Example University', degree: 'B.S. Computer Science', year: '2018' }],
    certifications: [{ name: 'Cloud Engineering', issuer: 'Example Institute', year: '2024' }],
  };
  window.pdfTest = { template: 'classic', coverLetterTemplate: 'classic' };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return original(input, init);
    let value = [];
    if (url.pathname === '/api/auth/me') value = user;
    else if (url.pathname === '/api/workspaces') value = [workspace];
    else if (url.pathname === '/api/workspaces/pdf-workspace') value = workspace;
    else if (url.pathname === '/api/applications/summary') value = { total: 1, paid: 0, by_application_status: {}, by_pipeline_status: {}, by_job_source: {} };
    else if (url.pathname === '/api/applications') value = { items: [row], total: 1, page: 1, page_size: 100, total_pages: 1 };
    else if (url.pathname === '/api/applications/pdf-application/resume') value = {
      id: row.id, job_title: row.job_title, company_name: row.company_name, resume,
      template: window.pdfTest.template, cover_letter_template: window.pdfTest.coverLetterTemplate,
      generated_at: row.resume_generated_at, job_description: 'Software engineering role.',
      cover_letter_text: 'Dear Hiring Team,\n\nI would like to join your engineering team. My experience delivering reliable services and accessible applications is a strong fit for this role.\n\nSincerely,\nTest Candidate',
      conversation_available: false, questions: [], answers: [],
    };
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  };
}

async function main() {
  if (!process.env.PDF_TEST_URL) {
    server = spawn(process.execPath, ['server.cjs', '-p', new URL(base).port], {
      cwd: path.join(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, HOSTNAME_BIND: '127.0.0.1' },
    });
    server.on('error', error => errors.push(error.message));
    server.stderr.on('data', chunk => errors.push(String(chunk)));
  }
  await until(async () => {
    try { return (await fetch(base + '/login', { signal: AbortSignal.timeout(2000) })).ok; }
    catch { return false; }
  }, 'frontend');
  browser = spawn(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-pipe', `--user-data-dir=${path.join(run, 'chrome')}`, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  browser.on('error', error => errors.push(error.message));
  browser.stdio[4].setEncoding('utf8');
  browser.stdio[4].on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      const request = pending.get(message.id);
      if (request) {
        clearTimeout(request.timer); pending.delete(message.id);
        message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value || arg.description).join(' '));
      if (message.method === 'Browser.downloadProgress') downloads.set(message.params.guid, message.params.state);
    }
  });
  await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: run, eventsEnabled: true });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${fixture.toString()})()` }, sessionId);
  await send('Page.navigate', { url: base + '/workspaces/pdf-workspace' }, sessionId);
  await until(() => evaluate(sessionId, `!!document.querySelector('button[title="Download saved resume PDF"]')`), 'resume download button');

  async function download(kind, template) {
    const before = new Set(downloads.keys());
    const started = Date.now();
    const title = kind === 'resume' ? 'Download saved resume PDF' : 'Download cover letter.pdf';
    const property = kind === 'resume' ? 'template' : 'coverLetterTemplate';
    await evaluate(sessionId, `window.pdfTest.${property} = ${JSON.stringify(template)}; document.querySelector(${JSON.stringify(`button[title="${title}"]`)}).click()`);
    let guid;
    await until(() => {
      guid = [...downloads].find(([id, state]) => !before.has(id) && state === 'completed')?.[0];
      return !!guid;
    }, `${kind} ${template}`);
    const bytes = fs.readFileSync(path.join(run, guid));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.match(bytes.subarray(-50).toString(), /%%EOF/);
    assert.ok(bytes.length > 1000);
    if (kind === 'resume') assert.ok((bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 2, 'resume fixture spans multiple pages');
    console.log(`PASS: ${kind} ${template} downloaded ${bytes.length} bytes in ${Date.now() - started}ms`);
  }

  for (const template of ['classic', 'modern', 'minimal', 'executive', 'academic', 'tech', 'elegant', 'bold', 'corporate']) await download('resume', template);
  for (const template of ['classic', 'modern', 'minimal']) await download('cover letter', template);
  await download('resume', 'classic');
  assert.deepEqual(errors, []);
  console.log('PASS: admin downloaded every resume and cover-letter template, including a repeated download, without browser errors.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const request of pending.values()) clearTimeout(request.timer);
  browser?.kill();
  server?.kill();
});
