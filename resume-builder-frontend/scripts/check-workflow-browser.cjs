const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
process.chdir(path.resolve(__dirname, '../..'));
const profilePath = path.resolve('.tmp/workflow-browser');
const browserPath = process.env.CHROME_BIN || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');
const chrome = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9333', `--user-data-dir=${profilePath}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.id) {
    const promise = pending.get(message.id); pending.delete(message.id);
    if (message.error) promise.reject(Error(message.error.message)); else promise.resolve(message.result);
  } };
  return { send: (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  }), close: () => socket.close() };
}
function fixture() {
  const previous = JSON.parse(sessionStorage.getItem('workflow-fixture') || 'null');
  if (!previous) localStorage.clear();
  const state = window.workflowTest = previous?.state || { requests: [], tableRows: 0, answers: [], pending: {}, errors: [], failNextUpload: true, uploadWaiting: false, browserTabId: 73, added: [], captures: [], latestDraft: 'd1' };
  const jobs = [
    { id: 'd1', browserTabId: 73, company: 'Acme', salary: '$150,000', url: 'https://jobs.example.test/123' },
    { id: 'd2', browserTabId: 74, company: 'Beta', salary: '$180,000', url: 'https://jobs.example.test/456' },
  ];
  const jd = (job) => `Job Information\nTitle: Engineer\nCompany: ${job.company}\n\nJob Description\nRemote US role for an engineer.`;
  const personal = { fullName: 'Test Candidate', title: 'Engineer', email: 'candidate@example.test', location: 'Chicago, IL' };
  const rawResume = (job) => ({ summary: `${job.company} summary`, skills: ['TypeScript'], workexperience: [], annual_salary: job.salary, hourly_rate: '$72.12', rate_in_jd: false });
  const snapshot = (job) => ({ personalInfo: personal, education: [], certifications: [], summary: rawResume(job).summary, skills: [{ category: 'Technical Skills', items: ['TypeScript'] }], workexperience: [], annualSalary: job.salary, hourlyRate: '$72.12', rateInJd: false });
  const updated = (job) => jd(job) + `\n\nExpected Rate (estimated)\nAnnual: ${job.salary}\nHourly: $72.12`;
  const store = previous?.store || { resume_ai_access_token: 'fixture-token', resume_ai_api_url: 'https://workflow.test/api',
    resume_ai_pending_screenshots: { old: { applicationId: 'old', tabId: 73, companyName: 'Already saved', createdAt: Date.now(), capturedAt: Date.now() } },
  };
  const sessions = previous?.sessions || {};
  state.pending = store.resume_ai_pending_screenshots;
  window.addEventListener('beforeunload', () => sessionStorage.setItem('workflow-fixture', JSON.stringify({ state, store, sessions })));
  Object.defineProperty(window, 'activeProfileWorkspace', { get: () => [...document.querySelectorAll('[data-profile-tab-id]')].find((element) => element.getClientRects().length) });
  const storageListeners = [];
  const messageListeners = [];
  window.chrome = {
    sidePanel: { setPanelBehavior: async () => {} }, action: { onClicked: { addListener() {} } },
    storage: { local: {
      get: async () => store,
      set: async (items) => { Object.assign(store, items); state.pending = store.resume_ai_pending_screenshots || {}; storageListeners.forEach((listener) => listener(items, 'local')); },
      remove: async (key) => { delete store[key]; },
    }, session: { get: async () => sessions, set: async (items) => Object.assign(sessions, items) },
    onChanged: { addListener: (fn) => storageListeners.push(fn), removeListener: (fn) => { const index = storageListeners.indexOf(fn); if (index >= 0) storageListeners.splice(index, 1); } } },
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener: (fn) => messageListeners.push(fn) },
      sendMessage: (message) => new Promise((resolve, reject) => { try { messageListeners[0](message, {}, resolve); } catch (error) { reject(error); } }),
    },
    tabs: { query: async () => [{ id: state.browserTabId, windowId: 1, url: jobs.find((job) => job.browserTabId === state.browserTabId).url }], get: async (id) => ({ id, windowId: 1 }), update: async (id) => { state.browserTabId = id; },
      captureVisibleTab: async () => { state.captures.push(state.browserTabId); return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='; },
      sendMessage: async (id, message) => { const job = jobs.find((job) => job.browserTabId === id); return { url: job.url, title: 'Engineer', jobTitle: 'Engineer', jobDescription: jd(job), jobDescriptionSource: 'fixture', questions: message.includeQuestions ? [{ question: 'Why this role?', fieldType: 'text', options: [], sensitive: false }] : [] }; },
    }, webNavigation: { getAllFrames: async () => [{ frameId: 0 }] },
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    if (!String(url).startsWith('https://workflow.test/api')) return originalFetch(url, init);
    const endpoint = String(url).slice('https://workflow.test/api'.length);
    state.requests.push(endpoint);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (endpoint === '/auth/me') return json({ id: 'u1', username: 'Bidder', role: 'bidder', is_active: true });
    if (endpoint === '/workspaces/profiles/assigned') return json([{ id: 'p1', workspace_id: 'w1', name: 'Candidate', personal_info: personal, education: [], certifications: [], auto_download: false }]);
    if (endpoint === '/applications/generate') {
      const input = JSON.parse(init.body);
      const job = jobs.find((job) => job.url === input.url);
      if (!job || input.job_description !== jd(job)) throw Error('Wrong JD was sent');
      state.latestDraft = job.id;
      return json({ success: true, eligible: true, draft: { id: job.id, url: job.url, company_name: job.company, job_title: 'Engineer' }, resume: rawResume(job), conversation_id: job.id + '-conversation', job_description: updated(job) });
    }
    if (endpoint === '/resume/answers') { state.answers = [{ question: 'Why this role?', answer: 'It fits my experience.' }]; return json({ answers: state.answers }); }
    if (endpoint.startsWith('/applications/drafts/latest')) {
      const job = jobs.find((job) => job.id === state.latestDraft);
      return json({ id: job.id, draft_id: job.id, submitted_at: state.added.includes(job.id) ? new Date().toISOString() : null, url: job.url, company_name: job.company, job_title: 'Engineer', resume: snapshot(job), template: 'classic', job_description: updated(job), conversation_id: job.id + '-conversation', questions: state.answers.map((answer) => ({ question: answer.question, options: [] })), answers: state.answers });
    }
    if (/^\/applications\/drafts\/d[12]\/submit$/.test(endpoint)) {
      const draftId = endpoint.split('/')[3];
      if (!(init.body instanceof FormData) || init.body.get('submitted') !== 'true' || !init.body.get('screenshot')?.size) throw Error('Missing screenshot or submission confirmation');
      if (state.failNextUpload) {
        state.failNextUpload = false;
        return new Response(JSON.stringify({ message: 'Upload failed. Please retry.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      if (draftId === 'd1') {
        state.uploadWaiting = true;
        await new Promise((resolve) => { state.releaseUpload = resolve; });
      }
      if (!state.added.includes(draftId)) state.added.push(draftId);
      state.tableRows = state.added.length;
      return json({ saved: true, application: { id: 'a-' + draftId, application_status: 'Applied' } });
    }
    throw Error('Unexpected endpoint: ' + endpoint);
  };
  window.addEventListener('error', (event) => state.errors.push(event.message));
}
(async () => {
  let browser;
  let page;
  try {
    let version;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { version = await fetch('http://127.0.0.1:9333/json/version').then((response) => response.json()); break; } catch { await pause(250); }
    }
    assert.ok(version, 'Chrome started');
    browser = await connect(version.webSocketDebuggerUrl);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const targets = await fetch('http://127.0.0.1:9333/json/list').then((response) => response.json());
    page = await connect(targets.find((target) => target.id === targetId).webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    const worker = fs.readFileSync('resume-builder-frontend/src/renderer/public/background.js', 'utf8');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${fixture.toString()})();\n(function(){${worker}\n})();` });
    await page.send('Page.navigate', { url: 'http://127.0.0.1:5173' });
    const evaluate = async (expression) => {
      const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
      return result.result.value;
    };
    const waitFor = async (expression) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        try { if (await evaluate(expression)) return; } catch {}
        await pause(100);
      }
      throw Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText') + '\n' + JSON.stringify(await evaluate('workflowTest')));
    };
    const clickSelector = async (selector) => {
      const box = await evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.getClientRects().length);if(!el)throw Error('Missing control '+${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...box });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...box });
    };
    const click = async (text) => {
      const selector = ['Resume', 'Questions'].includes(text) ? '[role="tab"]' : 'button';
      const box = await evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.getClientRects().length&&el.textContent.includes(${JSON.stringify(text)}));if(!el)throw Error('Missing control '+${JSON.stringify(text)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...box });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...box });
    };
    await waitFor("[...document.querySelectorAll('button')].some(el=>el.textContent.includes('Generate Resume'))");
    assert.deepEqual(await evaluate("chrome.runtime.sendMessage({ type: 'GET_SCREENSHOT_APPLICATIONS' }).then(result => result.items)"), []);
    assert.equal(await evaluate("document.querySelector('select[aria-label=\"Application to screenshot\"]')"), null);
    const firstTabId = await evaluate("activeProfileWorkspace.dataset.profileTabId");
    await click('Scan Current Page');
    await waitFor("activeProfileWorkspace.querySelector('textarea').value.includes('Company: Acme')");
    await click('Generate Resume');
    await waitFor("activeProfileWorkspace.querySelector('textarea').value === '' && activeProfileWorkspace.innerText.includes('Prepared job: Acme')");
    assert.equal(await evaluate('workflowTest.tableRows'), 0);
    assert.equal(await evaluate("activeProfileWorkspace.querySelector('pre').textContent.includes('Expected Rate')"), true);
    assert.equal(await evaluate("activeProfileWorkspace.querySelector('[data-submission-screenshot] button').disabled"), true);
    await evaluate("document.querySelector('[toast-close]')?.click()");
    await click('Questions');
    await waitFor("[...document.querySelectorAll('button')].some(el=>el.textContent.includes('Generate Answers'))");
    await click('Scan Questions');
    await waitFor("activeProfileWorkspace.querySelector('textarea').value === 'Why this role?'");
    await click('Generate Answers');
    await waitFor("workflowTest.answers.length === 1 && [...document.querySelectorAll('textarea')].some(el=>el.value === 'It fits my experience.')");
    await click('Load Last Job');
    await waitFor("workflowTest.requests.some(path=>path.startsWith('/applications/drafts/latest')) && document.body.innerText.includes('Last application loaded')");
    await click('Resume');
    await waitFor("activeProfileWorkspace.querySelector('textarea')?.value === ''");

    // A second tab for the same profile starts empty and prepares a different job independently.
    await clickSelector('button[aria-label="Open profile tab"]');
    await clickSelector('[role="menuitem"]');
    await waitFor("document.querySelectorAll('[data-profile-tab-id]').length === 2 && !activeProfileWorkspace.innerText.includes('Prepared job: Acme')");
    const secondTabId = await evaluate('activeProfileWorkspace.dataset.profileTabId');
    assert.notEqual(firstTabId, secondTabId);
    assert.equal(await evaluate("activeProfileWorkspace.querySelector('[data-submission-screenshot] button').disabled"), true);
    await evaluate('workflowTest.browserTabId = 74');
    await click('Scan Current Page');
    await waitFor("activeProfileWorkspace.querySelector('textarea').value.includes('Company: Beta')");
    await click('Generate Resume');
    await waitFor("activeProfileWorkspace.querySelector('textarea').value === '' && activeProfileWorkspace.innerText.includes('Prepared job: Beta')");
    assert.equal(await evaluate("activeProfileWorkspace.innerText.includes('$180,000')"), true);
    assert.equal(await evaluate("document.querySelector('select[aria-label=\"Application to screenshot\"]')"), null);
    assert.equal(await evaluate('Object.values(workflowTest.pending).length'), 2);

    // Neither a scoped read nor a capture can use the other tab's draft.
    assert.equal(await evaluate(`chrome.runtime.sendMessage({ type: 'GET_TAB_SCREENSHOT_APPLICATION', profileTabId: ${JSON.stringify(firstTabId)}, applicationId: 'd2' }).then(result => result.item)`), null);
    assert.equal(await evaluate(`chrome.runtime.sendMessage({ type: 'CAPTURE_APPLICATION_SCREENSHOT', profileTabId: ${JSON.stringify(firstTabId)}, applicationId: 'd2', tabId: 74, confirmed: true }).then(result => result.ok)`), false);
    assert.equal(await evaluate('workflowTest.tableRows'), 0);
    await click('Candidate');
    await waitFor(`activeProfileWorkspace.dataset.profileTabId === ${JSON.stringify(firstTabId)}`);
    assert.equal(await evaluate("activeProfileWorkspace.innerText.includes('Prepared job: Acme') && activeProfileWorkspace.innerText.includes('$150,000')"), true);
    await click('Questions');
    await waitFor("[...activeProfileWorkspace.querySelectorAll('textarea')].some(el => el.value === 'It fits my experience.')");
    await click('Resume');
    await evaluate('workflowTest.browserTabId = 73');
    await page.send('Page.reload');
    await waitFor("document.querySelectorAll('[data-profile-tab-id]').length === 2 && activeProfileWorkspace.innerText.includes('Prepared job: Acme')");
    assert.equal(await evaluate('activeProfileWorkspace.dataset.profileTabId'), firstTabId);
    assert.equal(await evaluate("activeProfileWorkspace.querySelector('textarea').value"), '');
    await click('Questions');
    await waitFor("[...activeProfileWorkspace.querySelectorAll('textarea')].some(el => el.value === 'It fits my experience.')");
    await click('Resume');
    assert.equal(await evaluate("workflowTest.requests.filter(path => path.startsWith('/applications/drafts/latest')).length"), 1);

    await evaluate("activeProfileWorkspace.querySelector('input[type=checkbox]').click()");
    await waitFor("!activeProfileWorkspace.querySelector('[data-submission-screenshot] button').disabled");
    await click('Take screenshot');
    await waitFor("activeProfileWorkspace.querySelector('[data-submission-screenshot]').innerText.includes('Upload failed. Please retry.')");
    assert.equal(await evaluate('workflowTest.tableRows'), 0);
    assert.equal(await evaluate("Object.values(workflowTest.pending).some(entry => entry.applicationId === 'd1') && !activeProfileWorkspace.querySelector('[data-submission-screenshot] button').disabled"), true);
    await click('Take screenshot');
    await waitFor('workflowTest.uploadWaiting');
    assert.equal(await evaluate('workflowTest.tableRows'), 0);
    assert.equal(await evaluate("Object.values(workflowTest.pending).some(entry => entry.applicationId === 'd1')"), true);
    assert.equal(await evaluate("[...activeProfileWorkspace.querySelectorAll('button')].find(el=>el.textContent.includes('Generate Resume')).disabled"), true);
    await click('Candidate - 2');
    await waitFor(`activeProfileWorkspace.dataset.profileTabId === ${JSON.stringify(secondTabId)}`);
    assert.equal(await evaluate("activeProfileWorkspace.innerText.includes('Prepared job: Beta') && !activeProfileWorkspace.querySelector('input[type=checkbox]').checked"), true);
    await evaluate('workflowTest.releaseUpload()');
    await waitFor("workflowTest.tableRows === 1 && document.body.innerText.includes('Added to the application table') && !Object.values(workflowTest.pending).some(entry => entry.applicationId === 'd1')");
    assert.equal(await evaluate("activeProfileWorkspace.innerText.includes('Prepared job: Beta')"), true);
    assert.equal(await evaluate("activeProfileWorkspace.querySelector('[data-submission-screenshot]').innerText.includes('Added to the application table')"), false);
    assert.equal(await evaluate("[...document.querySelectorAll('[data-state=\"open\"]')].some(el => el.innerText?.includes('Added to the application table. Screenshot saved for 8 days.'))"), true);
    assert.equal(await evaluate("activeProfileWorkspace.querySelector('[data-submission-screenshot] button').disabled"), true);
    assert.deepEqual(await evaluate("chrome.runtime.sendMessage({ type: 'GET_SCREENSHOT_APPLICATIONS' }).then(result => result.items.map(item => item.applicationId))"), ['d2']);
    assert.equal(await evaluate('Boolean(workflowTest.pending.old)'), false);
    assert.deepEqual(await evaluate('workflowTest.added'), ['d1']);
    assert.deepEqual(await evaluate('workflowTest.captures'), [73, 73]);
    await click('Candidate');
    await waitFor("activeProfileWorkspace.querySelector('[data-submission-screenshot] button').disabled && !activeProfileWorkspace.querySelector('[data-submission-screenshot] input')");
    await evaluate('workflowTest.browserTabId = 73');
    await page.send('Page.reload');
    await waitFor("document.querySelectorAll('[data-profile-tab-id]').length === 2 && activeProfileWorkspace.innerText.includes('Prepared job: Acme')");
    assert.equal(await evaluate("activeProfileWorkspace.querySelector('[data-submission-screenshot] button').disabled"), true);
    assert.equal(await evaluate("activeProfileWorkspace.querySelector('[data-submission-screenshot] input')"), null);
    await click('Candidate - 2');
    await waitFor("activeProfileWorkspace.querySelector('[data-submission-screenshot] input') && activeProfileWorkspace.innerText.includes('Prepared job: Beta')");
    await evaluate("activeProfileWorkspace.querySelector('input[type=checkbox]').click()");
    await click('Take screenshot');
    await waitFor('workflowTest.tableRows === 2 && Object.values(workflowTest.pending).length === 0');
    await waitFor("activeProfileWorkspace.querySelector('[data-submission-screenshot] button').disabled");
    assert.deepEqual(await evaluate('workflowTest.added'), ['d1', 'd2']);
    assert.deepEqual(await evaluate('workflowTest.captures'), [73, 73, 74]);
    assert.equal(await evaluate("workflowTest.requests.includes('/applications/generated')"), false);
    assert.deepEqual(await evaluate('workflowTest.errors'), []);
    const capture = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('.tmp/application-workflow-verified.png', Buffer.from(capture.data, 'base64'));
    console.log('PASS: independent jobs in two tabs for the same profile, tab state/answers restored after reload, scoped draft capture, original browser screenshot, failed-save retry, tab switching during upload, success toast, and completed tab stays disabled');
  } finally {
    if (page) page.close();
    if (browser) { await browser.send('Browser.close').catch(() => {}); browser.close(); }
    chrome.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
