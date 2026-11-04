const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/public/background.js'), 'utf8');
const key = 'resume_ai_pending_screenshots';
const day = 24 * 60 * 60 * 1000;

function setup(local = {}, session = {}, frameStates = [{ frameId: 0, helpers: true, recorder: true }]) {
  const listeners = [];
  let uploadStatus = 200;
  const captures = [];
  const uploads = [];
  const injections = [];
  const frames = structuredClone(frameStates);
  const tabs = new Map([[7, { id: 7, windowId: 1 }], [8, { id: 8, windowId: 1 }]]);
  let activeTabId = 7;
  local.resume_ai_access_token ??= 'test-token';
  local.resume_ai_api_url ??= 'https://api.example.com/api';
  const storage = (data) => ({
    get: async (keys) => structuredClone(Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).map((item) => [item, data[item]]),
    )),
    set: async (values) => Object.assign(data, structuredClone(values)),
  });
  const context = vm.createContext({
    console, Date, URL, Response, FormData, crypto: { randomUUID },
    setTimeout: (callback) => { callback(); return 0; },
    chrome: {
      action: { onClicked: { addListener() {} } },
      sidePanel: { setPanelBehavior() {}, open() {} },
      runtime: {
        getManifest: () => require('../src/renderer/public/manifest.json'),
        onInstalled: { addListener() {} },
        onMessage: { addListener(callback) { listeners.push(callback); } },
      },
      storage: { local: storage(local), session: storage(session) },
      webNavigation: { getAllFrames: async () => frames.map(({ frameId }) => ({ frameId })) },
      scripting: { executeScript: async ({ target, files }) => {
        const frame = frames.find((item) => item.frameId === target.frameIds[0]);
        if (!frame || frame.restricted) throw Error('Cannot access this frame');
        if (!files) return [{ frameId: frame.frameId, result: frame.helpers }];
        injections.push({ tabId: target.tabId, frameId: frame.frameId, files: Array.from(files) });
        if (files.includes('content-script.js')) frame.helpers = true;
        if (files.includes('application-capture.js')) {
          assert.equal(frame.helpers, true, 'capture needs the page helpers first');
          frame.recorder = true;
        }
        return [{ frameId: frame.frameId }];
      } },
      tabs: {
        sendMessage: async (_tabId, message, { frameId = 0 } = {}) => {
          const frame = frames.find((item) => item.frameId === frameId);
          if (!frame || frame.restricted || !frame.recorder) throw Error('Receiving end does not exist');
          return { ok: true, captureReady: message.type === 'APPLICATION_CAPTURE_START' };
        },
        get: async (id) => {
          if (!tabs.has(id)) throw new Error('No tab with this ID');
          return tabs.get(id);
        },
        update: async (id) => { activeTabId = id; return tabs.get(id); },
        query: async ({ windowId }) => [...tabs.values()].filter((tab) => tab.id === activeTabId && tab.windowId === windowId),
        captureVisibleTab: async (windowId) => {
          captures.push(windowId);
          return 'data:image/png;base64,iVBORw0KGgo=';
        },
      },
    },
    fetch: async (url, options) => {
      if (url.startsWith('data:')) return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      uploads.push({ url, options });
      return new Response(JSON.stringify(uploadStatus === 200 ? { saved: true } : { message: 'Upload unavailable' }), {
        status: uploadStatus,
      });
    },
  });
  vm.runInContext(source, context);
  const send = (message, sender = {}) => new Promise((resolve) => {
    assert.ok(listeners.some((listener) => listener(message, sender, resolve) === true));
  }).then((result) => JSON.parse(JSON.stringify(result)));
  const arm = (applicationId, tabId = 7) => send({
    type: 'ARM_APPLICATION_SCREENSHOT', applicationId, tabId,
    companyName: `Company ${applicationId}`, jobTitle: 'Engineer',
  });
  return {
    local, session, tabs, captures, uploads, injections, send, arm,
    list: () => send({ type: 'GET_SCREENSHOT_APPLICATIONS' }),
    capture: (applicationId, tabId = 7, confirmed = true) => send({ type: 'CAPTURE_APPLICATION_SCREENSHOT', applicationId, tabId, confirmed }),
    setUploadStatus: (value) => { uploadStatus = value; },
    drain: () => vm.runInContext('Promise.allSettled([...captureSyncs.values()])', context),
    retry: () => vm.runInContext('pendingEntries().then(entries => Promise.allSettled(Object.keys(entries).map(syncCapturedSteps)))', context),
  };
}

test('the stable button can load an application before any submission signal', async () => {
  const app = setup();
  assert.equal((await app.arm('one')).ok, true);
  const { items } = await app.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].companyName, 'Company one');
  assert.equal(items[0].submitted, false);
});

const formSender = { tab: { id: 7 }, url: 'https://jobs.example.test/apply' };
const formStep = (name, answer, time = Date.now()) => ({
  key: name, step: name, url: formSender.url, captured_at: time,
  fields: [{ id: 'q', question: 'Why this role?', answer, section: '', field_type: 'textarea' }],
});
async function armDraft(app, id = 'draft-1') {
  await app.send({ type: 'ARM_APPLICATION_SCREENSHOT', applicationId: id, draftId: id, profileTabId: 'profile-1', tabId: 7 });
  return (await app.send({ type: 'GET_FORM_CAPTURE_CONTEXT' }, formSender)).token;
}
const record = (app, token, step) => app.send({ type: 'APPLICATION_FORM_CAPTURE', token, step }, formSender);

test('starts the recorder on an already-open Ashby page where only the job scanner was injected', async () => {
  const app = setup({}, {}, [{ frameId: 0, helpers: true, recorder: false }]);
  await armDraft(app);
  assert.deepEqual(app.injections, [{ tabId: 7, frameId: 0, files: ['application-capture.js'] }]);
  await armDraft(app);
  assert.equal(app.injections.length, 1, 'a running recorder is reused');
});

test('initializes missing scripts in each readable frame, including an embedded Greenhouse form', async () => {
  const app = setup({}, {}, [
    { frameId: 0, helpers: false, recorder: false },
    { frameId: 12, helpers: false, recorder: false },
    { frameId: 13, restricted: true },
  ]);
  const token = await armDraft(app);
  assert.deepEqual(app.injections, [0, 12].map((frameId) => ({ tabId: 7, frameId, files: ['content-script.js', 'application-capture.js'] })));
  const url = 'https://job-boards.greenhouse.io/embed/job_app';
  assert.equal((await app.send({ type: 'APPLICATION_FORM_CAPTURE', token, step: { ...formStep('Application', 'No'), url } },
    { tab: { id: 7 }, frameId: 12, url })).ok, true);
  await app.drain();
  assert.equal(JSON.parse(app.uploads[0].options.body).fields[0].answer, 'No');
});

test('reports a startup failure when no frame allows answer capture', async () => {
  const app = setup({}, {}, [{ frameId: 0, restricted: true }]);
  const result = await app.send({ type: 'ARM_APPLICATION_SCREENSHOT', applicationId: 'draft', draftId: 'draft', profileTabId: 'profile', tabId: 7 });
  assert.equal(result.ok, false);
  assert.match(result.error, /start.*capture/i);
});

test('captures several steps, corrections and cleared answers in the database request', async () => {
  const app = setup();
  const token = await armDraft(app);
  const now = Date.now();
  await record(app, token, formStep('Step 1', 'Entered by bidder', now));
  await app.drain();
  await record(app, token, formStep('Step 2', 'Another answer', now + 1));
  await app.drain();
  await record(app, token, formStep('Step 1', '', now + 2));
  await app.drain();
  const entry = (await app.list()).items[0];
  assert.equal(entry.captureSteps.length, 2);
  assert.equal(entry.captureSteps[0].fields[0].answer, '');
  assert.equal(entry.capturedAnswerCount, 2);
  assert.equal(app.uploads.length, 3);
  assert.match(app.uploads[2].url, /drafts\/draft-1\/form-capture$/);
  assert.equal(JSON.parse(app.uploads[2].options.body).fields[0].answer, '');
});

test('failed answer sync survives worker restart, retries, and prevents premature submission', async () => {
  const app = setup();
  const token = await armDraft(app);
  app.setUploadStatus(503);
  await record(app, token, formStep('Step 1', 'Keep this answer'));
  await app.drain();
  assert.match((await app.list()).items[0].captureError, /Upload unavailable/);
  assert.equal((await app.send({ type: 'CAPTURE_APPLICATION_SCREENSHOT', applicationId: 'draft-1', profileTabId: 'profile-1', tabId: 7, confirmed: true })).ok, false);
  assert.equal(app.captures.length, 0);
  const restarted = setup(app.local, app.session);
  await restarted.retry();
  assert.equal(JSON.parse(restarted.uploads[0].options.body).fields[0].answer, 'Keep this answer');
  assert.equal((await restarted.list()).items[0].captureError, null);
});

test('rejects unarmed tabs, stale profile tokens, and observations after confirmation', async () => {
  const app = setup();
  assert.equal((await record(app, 'unknown', formStep('Step 1', 'No'))).ok, false);
  const token = await armDraft(app);
  assert.equal((await app.send({ type: 'APPLICATION_FORM_CAPTURE', token, step: formStep('Step 1', 'No') }, { ...formSender, tab: { id: 8 } })).ok, false);
  const nextToken = await armDraft(app, 'draft-2');
  assert.notEqual(token, nextToken);
  assert.equal((await record(app, token, formStep('Step 1', 'Wrong profile'))).ok, false);
  await app.send({ type: 'APPLICATION_FORM_SUBMITTED' }, formSender);
  assert.equal((await record(app, nextToken, formStep('Step 1', 'After submission', Date.now() + 1000))).ok, false);
  assert.equal(app.uploads.length, 0);
});

test('persists a final observation queued before confirmation and syncs before adding the application', async () => {
  const app = setup();
  const token = await armDraft(app);
  const observed = formStep('Final step', 'Final bidder answer', Date.now() - 1);
  await app.send({ type: 'APPLICATION_FORM_SUBMITTED' }, formSender);
  assert.equal((await app.send({ type: 'GET_FORM_CAPTURE_CONTEXT' }, formSender)).token, null);
  assert.equal((await record(app, token, observed)).ok, true);
  assert.equal((await app.send({ type: 'CAPTURE_APPLICATION_SCREENSHOT', applicationId: 'draft-1', profileTabId: 'profile-1', tabId: 7, confirmed: true })).ok, true);
  assert.match(app.uploads[0].url, /form-capture$/);
  assert.equal(JSON.parse(app.uploads[0].options.body).fields[0].answer, 'Final bidder answer');
  assert.match(app.uploads.at(-1).url, /drafts\/draft-1\/submit$/);
});

test('starting a different job retains unsaved steps for retry without capturing into the old job', async () => {
  const app = setup();
  const token = await armDraft(app);
  app.setUploadStatus(503);
  await record(app, token, formStep('Questions', 'Retain across jobs'));
  await app.drain();
  await armDraft(app, 'next-job');
  const old = (await app.list()).items.find((item) => item.draftId === 'draft-1');
  assert.equal(old.captureActive, false);
  assert.equal(old.captureSteps[0].fields[0].answer, 'Retain across jobs');
  app.setUploadStatus(200);
  await app.retry();
  assert.equal((await app.list()).items.find((item) => item.draftId === 'draft-1').captureError, null);
});

test('capture requires confirmation before taking or uploading a screenshot', async () => {
  const app = setup();
  await app.arm('one');
  assert.deepEqual(await app.capture('one', 7, false), {
    ok: false, error: 'Confirm that the application was submitted successfully first.',
  });
  assert.equal(app.captures.length, 0);
  assert.equal(app.uploads.length, 0);
});

test('concurrent registrations retain multiple applications from the same tab', async () => {
  const app = setup();
  await Promise.all([app.arm('one'), app.arm('two')]);
  assert.deepEqual((await app.list()).items.map((item) => item.applicationId).sort(), ['one', 'two']);
});

test('registered applications survive closing and reopening the side panel or service worker', async () => {
  const first = setup();
  await first.arm('one');
  const reopened = setup(first.local, first.session);
  assert.equal((await reopened.list()).items[0].applicationId, 'one');
  assert.equal((await reopened.capture('one')).ok, true);
});

test('older tab-keyed records migrate and recent applications remain for eight days', async () => {
  const app = setup({ [key]: {
    7: { applicationId: 'old-format', createdAt: Date.now() - 2 * day, submitted: false },
    8: { applicationId: 'expired', createdAt: Date.now() - 9 * day },
  } });
  const { items } = await app.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].tabId, 7);
  assert.equal(items[0].applicationId, 'old-format');
  await app.arm('new');
  assert.ok(app.local[key]['old-format']);
  assert.equal(app.local[key].expired, undefined);
});

test('capture uploads to the selected application and removes it from pending jobs after reopening', async () => {
  const app = setup();
  await app.arm('one');
  assert.equal((await app.capture('one')).ok, true);
  assert.equal(app.uploads[0].url, 'https://api.example.com/api/applications/one/screenshot');
  assert.equal(app.uploads[0].options.headers.Authorization, 'Bearer test-token');
  assert.ok(app.uploads[0].options.body.get('screenshot'));
  assert.deepEqual((await app.list()).items, []);
  const reopened = setup(app.local, app.session);
  assert.deepEqual((await reopened.list()).items, []);
  assert.equal((await reopened.capture('one')).ok, false);
  assert.equal(reopened.uploads.length, 0);
});

test('failed uploads leave the application available for retry', async () => {
  const app = setup();
  await app.arm('one');
  app.setUploadStatus(503);
  assert.deepEqual(await app.capture('one'), { ok: false, error: 'Upload unavailable' });
  assert.equal((await app.list()).items[0].capturedAt, undefined);
  app.setUploadStatus(200);
  assert.equal((await app.capture('one')).ok, true);
  assert.equal(app.captures.length, 2);
});

test('browser restart retains application choices but blocks capture using a stale tab ID', async () => {
  const app = setup();
  await app.arm('one');
  const restarted = setup(app.local, {});
  assert.equal((await restarted.list()).items.length, 1);
  const result = await restarted.capture('one');
  assert.equal(result.ok, false);
  assert.match(result.error, /Load Last Job/);
  assert.equal(restarted.captures.length, 0);
  await restarted.arm('one', 8);
  assert.equal((await restarted.capture('one', 8)).ok, true);
});

test('a closed tab gives an actionable error and reloading the application rebinds capture', async () => {
  const app = setup();
  await app.arm('one');
  app.tabs.delete(7);
  assert.match((await app.capture('one')).error, /original application tab is closed/);
  await app.arm('one', 8);
  assert.equal((await app.list()).items.length, 1);
  assert.equal((await app.capture('one', 8)).ok, true);
  assert.equal((await app.list()).items.length, 0);
});

test('a mismatched application and tab cannot capture another page', async () => {
  const app = setup();
  await app.arm('one');
  assert.equal((await app.capture('one', 8)).ok, false);
  assert.equal(app.captures.length, 0);
  assert.equal((await app.capture('missing')).ok, false);
});
