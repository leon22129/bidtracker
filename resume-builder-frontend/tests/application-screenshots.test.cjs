const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/public/background.js'), 'utf8');
const key = 'resume_ai_pending_screenshots';
const day = 24 * 60 * 60 * 1000;

function setup(local = {}, session = {}) {
  let listener;
  let uploadStatus = 200;
  const captures = [];
  const uploads = [];
  const tabs = new Map([[7, { id: 7, windowId: 1 }], [8, { id: 8, windowId: 1 }]]);
  local.resume_ai_access_token ??= 'test-token';
  local.resume_ai_api_url ??= 'https://api.example.com/api';
  const storage = (data) => ({
    get: async (keys) => structuredClone(Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).map((item) => [item, data[item]]),
    )),
    set: async (values) => Object.assign(data, structuredClone(values)),
  });
  const context = vm.createContext({
    console, Date, Response, FormData, crypto: { randomUUID },
    setTimeout: (callback) => { callback(); return 0; },
    chrome: {
      action: { onClicked: { addListener() {} } },
      sidePanel: { setPanelBehavior() {}, open() {} },
      runtime: {
        onInstalled: { addListener() {} },
        onMessage: { addListener(callback) { listener = callback; } },
      },
      storage: { local: storage(local), session: storage(session) },
      tabs: {
        get: async (id) => {
          if (!tabs.has(id)) throw new Error('No tab with this ID');
          return tabs.get(id);
        },
        update: async (id) => tabs.get(id),
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
    assert.equal(listener(message, sender, resolve), true);
  }).then((result) => JSON.parse(JSON.stringify(result)));
  const arm = (applicationId, tabId = 7) => send({
    type: 'ARM_APPLICATION_SCREENSHOT', applicationId, tabId,
    companyName: `Company ${applicationId}`, jobTitle: 'Engineer',
  });
  return {
    local, session, tabs, captures, uploads, send, arm,
    list: () => send({ type: 'GET_SCREENSHOT_APPLICATIONS' }),
    capture: (applicationId, tabId = 7) => send({ type: 'CAPTURE_APPLICATION_SCREENSHOT', applicationId, tabId }),
    setUploadStatus: (value) => { uploadStatus = value; },
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

test('capture uploads to the selected application and keeps saved status after reopening', async () => {
  const app = setup();
  await app.arm('one');
  assert.equal((await app.capture('one')).ok, true);
  assert.equal(app.uploads[0].url, 'https://api.example.com/api/applications/one/screenshot');
  assert.equal(app.uploads[0].options.headers.Authorization, 'Bearer test-token');
  assert.ok(app.uploads[0].options.body.get('screenshot'));
  assert.ok((await app.list()).items[0].capturedAt);
  const reopened = setup(app.local, app.session);
  assert.ok((await reopened.list()).items[0].capturedAt);
  assert.equal((await reopened.capture('one')).ok, true);
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
  assert.match(result.error, /Load Last Application/);
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
  assert.equal((await app.capture('one', 8)).ok, true);
  assert.equal((await app.list()).items.length, 1);
});

test('a mismatched application and tab cannot capture another page', async () => {
  const app = setup();
  await app.arm('one');
  assert.equal((await app.capture('one', 8)).ok, false);
  assert.equal(app.captures.length, 0);
  assert.equal((await app.capture('missing')).ok, false);
});
