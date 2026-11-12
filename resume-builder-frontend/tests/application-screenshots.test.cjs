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
  let formResponse;
  const captures = [];
  const uploads = [];
  const injections = [];
  const frames = structuredClone(frameStates);
  const tabs = new Map([[7, { id: 7, windowId: 1, url: 'https://www.linkedin.com/jobs/' }], [8, { id: 8, windowId: 1, url: 'https://jobs.example.test/confirmation' }]]);
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
    console, Date, URL, Response, FormData, AbortSignal, crypto: { randomUUID },
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
        query: async ({ windowId }) => [...tabs.values()].filter((tab) => tab.id === activeTabId && (windowId === undefined || tab.windowId === windowId)),
        captureVisibleTab: async (windowId) => {
          captures.push(windowId);
          return 'data:image/png;base64,iVBORw0KGgo=';
        },
      },
    },
    fetch: async (url, options) => {
      if (url.startsWith('data:')) return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      uploads.push({ url, options });
      if (url.endsWith('/form-capture') && formResponse) return formResponse(JSON.parse(options.body), options);
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
    setActiveTab: (value) => { activeTabId = value; },
    setFormResponse: (value) => { formResponse = value; },
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

const manualCapture = (app, confirmed = true) => app.send({
  type: 'CAPTURE_MANUAL_APPLICATION_SCREENSHOT', applicationId: 'manual-1', profileTabId: 'profile-1', confirmed,
});

test('manual capture uses the active confirmation page without arming or replacing the linked draft', async () => {
  const app = setup();
  await app.send({ type: 'ARM_APPLICATION_SCREENSHOT', applicationId: 'linked', draftId: 'linked', profileTabId: 'profile-1', tabId: 7 });
  const before = (await app.list()).items;
  app.setActiveTab(8);
  assert.equal((await manualCapture(app)).ok, true);
  assert.deepEqual((await app.list()).items, before);
  assert.equal(app.uploads.length, 1);
  assert.match(app.uploads[0].url, /drafts\/manual-1\/submit$/);
  assert.equal(app.uploads[0].options.body.get('submission_url'), 'https://jobs.example.test/confirmation');
  assert.equal(app.uploads[0].options.body.get('submitted'), 'true');
  assert.ok(app.uploads[0].options.body.get('screenshot').size);
});

test('manual capture requires confirmation and a readable application page', async () => {
  const app = setup();
  assert.match((await manualCapture(app, false)).error, /Confirm/);
  app.tabs.get(7).url = 'chrome://newtab';
  assert.match((await manualCapture(app)).error, /confirmation page/);
  assert.equal(app.captures.length, 0);
  assert.equal(app.uploads.length, 0);
});

test('manual upload can retry the same draft after failure or a worker restart', async () => {
  const app = setup();
  app.setUploadStatus(503);
  assert.match((await manualCapture(app)).error, /Upload unavailable/);
  const restarted = setup(app.local, {});
  assert.equal((await manualCapture(restarted)).ok, true);
  assert.equal(app.uploads[0].url, restarted.uploads[0].url);
  assert.equal(restarted.uploads[0].options.body.get('submission_url'), 'https://www.linkedin.com/jobs/');
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

test('allows screenshot submission when no frame allows answer capture', async () => {
  const app = setup({}, {}, [{ frameId: 0, restricted: true }]);
  const result = await app.send({ type: 'ARM_APPLICATION_SCREENSHOT', applicationId: 'draft', draftId: 'draft', profileTabId: 'profile', tabId: 7 });
  assert.equal(result.ok, true);
  assert.match(result.captureWarning, /Some form answers/);
  const captured = await app.send({ type: 'CAPTURE_APPLICATION_SCREENSHOT', applicationId: 'draft', profileTabId: 'profile', tabId: 7, confirmed: true });
  assert.equal(captured.ok, true);
  assert.match(captured.captureWarning, /Some form answers/);
  assert.match(app.uploads[0].url, /drafts\/draft\/submit$/);
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

test('failed answer sync survives worker restart and retries before submission', async () => {
  const app = setup();
  const token = await armDraft(app);
  app.setUploadStatus(503);
  await record(app, token, formStep('Step 1', 'Keep this answer'));
  await app.drain();
  assert.match((await app.list()).items[0].captureError, /Upload unavailable/);
  const restarted = setup(app.local, app.session);
  await restarted.retry();
  assert.equal(JSON.parse(restarted.uploads[0].options.body).fields[0].answer, 'Keep this answer');
  assert.equal((await restarted.list()).items[0].captureError, null);
});

for (const status of [400, 413, 503, 'network', 'timeout']) {
  test(`form capture failure (${status}) does not block adding the application after a worker restart`, async () => {
    const rejectForm = () => {
      if (status === 'network') throw new TypeError('Failed to fetch');
      if (status === 'timeout') throw new DOMException('Form capture timed out', 'TimeoutError');
      return new Response(JSON.stringify({ message: 'Invalid application form capture' }), { status });
    };
    const app = setup();
    const token = await armDraft(app);
    app.setFormResponse(rejectForm);
    await record(app, token, formStep('ADP Screening', 'Answer'));
    await app.drain();
    assert.ok((await app.list()).items[0].captureError);

    const restarted = setup(app.local, app.session);
    restarted.setFormResponse(rejectForm);
    const result = await restarted.send({ type: 'CAPTURE_APPLICATION_SCREENSHOT', applicationId: 'draft-1',
      profileTabId: 'profile-1', tabId: 7, confirmed: true });
    assert.equal(result.ok, true);
    assert.match(result.captureWarning, /Some form answers/);
    assert.equal(restarted.captures.length, 1);
    const submitted = restarted.uploads.at(-1);
    assert.match(submitted.url, /drafts\/draft-1\/submit$/);
    assert.equal(submitted.options.body.get('submitted'), 'true');
    assert.ok(submitted.options.body.get('screenshot').size);
    assert.deepEqual((await restarted.list()).items, []);
  });
}

test('a rejected form step does not discard saved answers or prevent other steps from syncing', async () => {
  const app = setup();
  const token = await armDraft(app);
  await record(app, token, formStep('Personal details', 'Previously saved answer'));
  await app.drain();
  app.setUploadStatus(503);
  await record(app, token, formStep('ADP Screening', 'Rejected answer'));
  await app.drain();
  await record(app, token, formStep('Experience', 'Valid answer'));
  await app.drain();

  const restarted = setup(app.local, app.session);
  restarted.setFormResponse((step) => new Response(JSON.stringify(step.step === 'ADP Screening'
    ? { message: 'Invalid application form capture' } : { saved: true }), {
    status: step.step === 'ADP Screening' ? 400 : 200,
  }));
  const result = await restarted.send({ type: 'CAPTURE_APPLICATION_SCREENSHOT', applicationId: 'draft-1',
    profileTabId: 'profile-1', tabId: 7, confirmed: true });
  assert.equal(result.ok, true);
  assert.match(result.captureWarning, /Some form answers/);
  assert.deepEqual(restarted.uploads.filter(({ url }) => url.endsWith('/form-capture'))
    .map(({ options }) => JSON.parse(options.body).step), ['ADP Screening', 'Experience']);
  assert.match(restarted.uploads.at(-1).url, /submit$/);
  assert.deepEqual((await restarted.list()).items, []);
});

test('an old form validation error without pending steps does not block submission', async () => {
  const app = setup();
  await armDraft(app);
  app.local[key]['profile-1:draft-1'].captureError = 'Invalid application form capture';
  const result = await app.send({ type: 'CAPTURE_APPLICATION_SCREENSHOT', applicationId: 'draft-1',
    profileTabId: 'profile-1', tabId: 7, confirmed: true });
  assert.equal(result.ok, true);
  assert.match(result.captureWarning, /Some form answers/);
  assert.match(app.uploads[0].url, /submit$/);
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

test('captures same-document Ashby routes when Chrome reports the original sender URL', async () => {
  const app = setup();
  const token = await armDraft(app);
  const posting = 'https://jobs.ashbyhq.com/spruceid/c06e4344-c7b0-4c1b-beb8-a9646594ff7c';
  const sender = { tab: { id: 7 }, frameId: 0, url: posting };
  const step = { ...formStep('Application', 'Final answer'), url: `${posting}/application` };
  assert.equal((await app.send({ type: 'APPLICATION_FORM_CAPTURE', token, step }, sender)).ok, true);
  await app.drain();
  assert.equal(JSON.parse(app.uploads[0].options.body).url, step.url);
  assert.equal((await app.list()).items[0].captureError, null);
  await app.send({ type: 'APPLICATION_FORM_SUBMITTED' }, sender);
  const result = await app.send({ type: 'CAPTURE_APPLICATION_SCREENSHOT', applicationId: 'draft-1',
    profileTabId: 'profile-1', tabId: 7, confirmed: true });
  assert.equal(result.ok, true);
  assert.match(app.uploads.at(-1).url, /drafts\/draft-1\/submit$/);
});

test('retains the form URL on an observation queued before the confirmation route', async () => {
  const app = setup();
  const token = await armDraft(app);
  const step = formStep('Application', 'Last edit', Date.now() - 1);
  const sender = { ...formSender, url: `${formSender.url}/confirmation` };
  await app.send({ type: 'APPLICATION_FORM_SUBMITTED' }, sender);
  assert.equal((await app.send({ type: 'APPLICATION_FORM_CAPTURE', token, step }, sender)).ok, true);
  await app.drain();
  assert.equal(JSON.parse(app.uploads[0].options.body).url, formSender.url);
  assert.equal(JSON.parse(app.uploads[0].options.body).fields[0].answer, 'Last edit');
});

test('route tolerance still rejects other origins, non-HTTP senders and unsanitized URLs', async () => {
  const app = setup();
  const token = await armDraft(app);
  for (const [url, senderUrl] of [
    ['https://other.example.test/apply', formSender.url],
    ['http://jobs.example.test/apply', formSender.url],
    ['https://jobs.example.test:444/apply', formSender.url],
    [`${formSender.url}?token=secret`, formSender.url],
    [`${formSender.url}#private`, formSender.url],
    ['https://name:secret@jobs.example.test/apply', formSender.url],
    ['data:text/html,form', 'data:text/html,form'],
    ['file:///application.html', 'file:///application.html'],
    ['/apply', formSender.url],
    [formSender.url, 'invalid'],
  ]) {
    const result = await app.send({ type: 'APPLICATION_FORM_CAPTURE', token,
      step: { ...formStep('Application', 'Do not save'), url } }, { ...formSender, url: senderUrl });
    assert.equal(result.ok, false, `${url} from ${senderUrl}`);
  }
  assert.equal(app.uploads.length, 0);
  assert.equal((await app.list()).items[0].captureSteps, undefined);
});

test('an already-submitted draft with the old capture error can save its screenshot and recorded answers', async () => {
  const app = setup();
  const token = await armDraft(app);
  await record(app, token, formStep('Application', 'Previously saved answer'));
  await app.drain();
  await app.send({ type: 'APPLICATION_FORM_SUBMITTED' }, formSender);
  app.local[key]['profile-1:draft-1'].captureError = 'This form step could not be captured.';
  const restarted = setup(app.local, {});
  await armDraft(restarted); // Load Last Job rebinds the page after an extension reload.
  const entry = (await restarted.list()).items[0];
  assert.equal(entry.captureError, null);
  assert.match(entry.captureWarning, /Some form answers could not be recorded/);
  assert.equal(entry.captureSteps[0].fields[0].answer, 'Previously saved answer');
  const result = await restarted.send({ type: 'CAPTURE_APPLICATION_SCREENSHOT', applicationId: 'draft-1',
    profileTabId: 'profile-1', tabId: 7, confirmed: true });
  assert.equal(result.ok, true);
  assert.equal(result.captureWarning, entry.captureWarning);
  assert.match(restarted.uploads[0].url, /drafts\/draft-1\/submit$/);
  assert.deepEqual((await restarted.list()).items, []);
});

test('form capture failures allow the screenshot attempt while a failed submit remains retryable', async () => {
  const app = setup();
  const token = await armDraft(app);
  app.setUploadStatus(503);
  await record(app, token, formStep('Application', 'Keep for retry'));
  await app.drain();
  app.local[key]['profile-1:draft-1'].captureError = 'This form step could not be captured.';
  const message = { type: 'CAPTURE_APPLICATION_SCREENSHOT', applicationId: 'draft-1',
    profileTabId: 'profile-1', tabId: 7, confirmed: true };
  assert.equal((await app.send(message)).ok, false);
  assert.equal(app.captures.length, 1);
  assert.match(app.uploads.at(-1).url, /submit$/);
  assert.equal((await app.list()).items[0].captureSteps[0].fields[0].answer, 'Keep for retry');
  app.setUploadStatus(200);
  const result = await app.send(message);
  assert.equal(result.ok, true);
  assert.match(result.captureWarning, /Some form answers/);
  assert.match(app.uploads.at(-2).url, /form-capture$/);
  assert.match(app.uploads.at(-1).url, /submit$/);
  assert.equal(app.captures.length, 2);
});

test('rejected observations warn about missing answers until those steps are captured successfully', async () => {
  const app = setup();
  const token = await armDraft(app);
  for (const name of ['First', 'Second']) {
    assert.equal((await record(app, token, { ...formStep(name, 'Answer'), url: 'https://other.example.test' })).ok, false);
  }
  await record(app, token, formStep('First', 'First answer'));
  await app.drain();
  assert.match((await app.list()).items[0].captureWarning, /Some form answers/);
  await record(app, token, formStep('Second', 'Second answer'));
  await app.drain();
  assert.equal((await app.list()).items[0].captureWarning, null);
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
