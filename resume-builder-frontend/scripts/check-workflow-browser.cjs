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
  const state = window.workflowTest = { requests: [], tableRows: 0, answers: [], pending: {}, errors: [] };
  const jd = 'Job Information\nTitle: Engineer\nCompany: Acme\n\nJob Description\nRemote US role for an engineer.';
  const personal = { fullName: 'Test Candidate', title: 'Engineer', email: 'candidate@example.test', location: 'Chicago, IL' };
  const rawResume = { summary: 'Generated summary', skills: ['TypeScript'], workexperience: [], annual_salary: '$150,000', hourly_rate: '$72.12', rate_in_jd: false };
  const snapshot = { personalInfo: personal, education: [], certifications: [], summary: rawResume.summary, skills: [{ category: 'Technical Skills', items: ['TypeScript'] }], workexperience: [], annualSalary: '$150,000', hourlyRate: '$72.12', rateInJd: false };
  const updated = jd + '\n\nExpected Rate (estimated)\nAnnual: $150,000\nHourly: $72.12';
  const store = { resume_ai_access_token: 'fixture-token', resume_ai_api_url: 'https://workflow.test/api' };
  const sessions = {};
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
    tabs: { query: async () => [{ id: 73, windowId: 1, url: 'https://jobs.example.test/123' }], get: async () => ({ id: 73, windowId: 1 }), update: async () => {},
      captureVisibleTab: async () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      sendMessage: async (_id, message) => ({ url: 'https://jobs.example.test/123', title: 'Engineer', jobTitle: 'Engineer', jobDescription: jd, jobDescriptionSource: 'fixture', questions: message.includeQuestions ? [{ question: 'Why this role?', fieldType: 'text', options: [], sensitive: false }] : [] }),
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
      if (JSON.parse(init.body).job_description !== jd) throw Error('Wrong JD was sent');
      return json({ success: true, eligible: true, draft: { id: 'd1', url: 'https://jobs.example.test/123', company_name: 'Acme', job_title: 'Engineer' }, resume: rawResume, conversation_id: 'c1', job_description: updated });
    }
    if (endpoint === '/resume/answers') { state.answers = [{ question: 'Why this role?', answer: 'It fits my experience.' }]; return json({ answers: state.answers }); }
    if (endpoint.startsWith('/applications/drafts/latest')) return json({ id: 'd1', draft_id: 'd1', url: 'https://jobs.example.test/123', company_name: 'Acme', job_title: 'Engineer', resume: snapshot, template: 'classic', job_description: updated, conversation_id: 'c1', questions: state.answers.map((answer) => ({ question: answer.question, options: [] })), answers: state.answers });
    if (endpoint === '/applications/drafts/d1/submit') {
      if (!(init.body instanceof FormData) || init.body.get('submitted') !== 'true' || !init.body.get('screenshot')?.size) throw Error('Missing screenshot or submission confirmation');
      state.tableRows = 1; return json({ saved: true, application: { id: 'a1', application_status: 'Applied' } });
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
    const click = async (text) => {
      const selector = ['Resume', 'Questions'].includes(text) ? '[role="tab"]' : 'button';
      const box = await evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.includes(${JSON.stringify(text)}));if(!el)throw Error('Missing control '+${JSON.stringify(text)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...box });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...box });
    };
    await waitFor("[...document.querySelectorAll('button')].some(el=>el.textContent.includes('Generate Resume'))");
    await click('Scan Current Page');
    await waitFor("document.querySelector('textarea').value.includes('Company: Acme')");
    await click('Generate Resume');
    await waitFor("document.querySelector('textarea').value === '' && document.body.innerText.includes('Prepared job: Acme')");
    assert.equal(await evaluate('workflowTest.tableRows'), 0);
    assert.equal(await evaluate("document.querySelector('pre').textContent.includes('Expected Rate')"), true);
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(el=>el.textContent.includes('Take screenshot')).disabled"), true);
    await evaluate("document.querySelector('[toast-close]')?.click()");
    await click('Questions');
    await waitFor("[...document.querySelectorAll('button')].some(el=>el.textContent.includes('Generate Answers'))");
    await click('Scan Questions');
    await waitFor("document.querySelector('textarea').value === 'Why this role?'");
    await click('Generate Answers');
    await waitFor("workflowTest.answers.length === 1 && [...document.querySelectorAll('textarea')].some(el=>el.value === 'It fits my experience.')");
    await click('Load Last Job');
    await waitFor("workflowTest.requests.some(path=>path.startsWith('/applications/drafts/latest')) && document.body.innerText.includes('Last application loaded')");
    await click('Resume');
    await waitFor("document.querySelector('textarea')?.value === ''");
    assert.equal(await evaluate("document.querySelector('textarea').value"), '');
    await evaluate("document.querySelector('input[type=checkbox]').click()");
    await waitFor("![...document.querySelectorAll('button')].find(el=>el.textContent.includes('Take screenshot')).disabled");
    await click('Take screenshot');
    await waitFor("workflowTest.tableRows === 1 && document.body.innerText.includes('Added to the application table')");
    assert.equal(await evaluate("workflowTest.requests.includes('/applications/generated')"), false);
    assert.deepEqual(await evaluate('workflowTest.errors'), []);
    const capture = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('.tmp/application-workflow-verified.png', Buffer.from(capture.data, 'base64'));
    console.log('PASS: real browser scan, draft generation, cleared JD input, separate saved JD/rate, answer generation, draft restore, confirmation requirement, and actual extension worker screenshot submission endpoint');
  } finally {
    if (page) page.close();
    if (browser) { await browser.send('Browser.close').catch(() => {}); browser.close(); }
    chrome.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
