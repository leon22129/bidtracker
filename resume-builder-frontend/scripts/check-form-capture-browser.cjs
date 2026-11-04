// Real DOM/navigation fixtures; no ATS account or application submission needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { ashby, greenhouse } = require('../tests/fixtures/ats-forms.cjs');
const portalFields = require('../tests/fixtures/portal-fields.cjs');
const root = path.resolve(__dirname, '../..');
const profileRoot = path.join(root, '.tmp');
fs.mkdirSync(profileRoot, { recursive: true });
const profile = fs.mkdtempSync(path.join(profileRoot, 'form-capture-browser-'));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scripts = ['content-script.js', 'application-capture.js'].map((name) =>
  fs.readFileSync(path.join(__dirname, '../src/renderer/public', name), 'utf8'));
const personal = `<main><h2>My Information</h2><form>
  <label>First name<input name="firstName" value="Candidate"></label>
  <label>Email<input type="email" value="candidate@example.test"></label>
  <label>Country<button type="button" aria-haspopup="listbox">United States</button></label>
  <input type="hidden" value="must not capture"><button type="button" id="next">Next</button>
  </form></main>`;
const experience = `<main><h2>My Experience</h2><form>
  <fieldset><legend>Employment 1</legend><label>Company name<input value="First company"></label></fieldset>
  <fieldset id="second"><legend>Employment 2</legend><label>Company name<input value="Second company"></label></fieldset>
  <fieldset><legend>Work authorization</legend><label><input type="radio" name="authorized" value="Y" checked>Yes</label>
  <label><input type="radio" name="authorized" value="N">No</label></fieldset>
  <label>Skills<select multiple><option value="ts" selected>TypeScript</option><option value="sql" selected>SQL</option></select></label>
  <label><input type="checkbox" checked>I confirm this information</label>
  <label>Why this role?<textarea>My actual answer\nSecond line</textarea></label>
  <button type="button" id="back">Back</button></form></main>`;
const recruiterQuestion = 'Have you spoken with a talent acquisition partner at Rapid7 in the past?';
const customSelections = `<main><h2>Application Questions</h2><form>
  <div data-automation-id="formField-recruiter">
    <label id="recruiter-label" data-automation-id="formLabel">${recruiterQuestion}</label>
    <div id="recruiter" role="combobox" aria-labelledby="recruiter-label recruiter-value recruiter-required" aria-expanded="false" aria-valuetext="">
      <span id="recruiter-value">Select One</span>
      <input aria-labelledby="recruiter-label recruiter-value recruiter-required" placeholder="Select One" readonly value="">
      <span hidden>Hidden stale answer</span>
    </div><span id="recruiter-required">Required</span>
  </div>
  <div data-automation-id="formField-relocate">
    <label id="relocate-label" data-automation-id="formLabel">Can you relocate?</label>
    <button id="relocate" type="button" class="inputGroupEligible" aria-haspopup="true"
      aria-labelledby="relocate-label relocate relocate-required">No</button><span id="relocate-required">Required</span>
  </div>
  <label for="aria-answer">Available for travel?</label>
  <input id="aria-answer" role="combobox" aria-valuetext="No" value="">
  <label for="linked-answer">Previously employed here?</label>
  <input id="linked-answer" role="combobox" aria-controls="employment-options" aria-activedescendant="employment-yes" value="">
  <div id="employment-options" role="listbox">
    <div id="employment-yes" role="option" aria-selected="false">Yes</div>
    <div id="employment-no" role="option" aria-selected="true">No</div>
  </div>
  <div class="form-control">
  <label for="search-answer">Preferred office</label>
  <div class="test-control"><div class="test-singleValue">Boston</div>
    <input id="search-answer" role="combobox" value="" placeholder="Select..."></div>
  <label for="empty-answer">Unanswered dropdown</label>
  <input id="empty-answer" role="combobox" aria-controls="empty-options" aria-activedescendant="empty-yes" value="">
  <div id="empty-options" role="listbox"><div id="empty-yes" role="option" aria-selected="false">Yes</div></div>
  </div>
  <span id="aria-label">Have you applied before?</span>
  <div id="aria-choice" role="combobox" aria-labelledby="aria-label aria-choice aria-required">No</div>
  <span id="aria-required">Required</span>
  <label>Native zero value<select id="native-zero"><option value="">Select One</option><option value="0" selected>No</option></select></label>
  <label>Native empty value<select><option value="" selected>No</option><option value="yes">Yes</option></select></label>
  <label>Native placeholder<select><option value="placeholder" selected>Select One</option><option value="no">No</option></select></label>
  <button id="questions-next" type="button">Next</button>
  </form></main>`;
const formHtml = (body) => `<!doctype html><html><body>${body}</body></html>`;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/frame') return res.end(formHtml('<main><h2>ADP Screening</h2><label>Available date<input type="date" value="2026-12-01"></label></main>'));
  if (req.url === '/greenhouse') return res.end(formHtml(greenhouse));
  res.end(formHtml(personal));
});
const frameServer = http.createServer((req, res) => server.emit('request', req, res));
let browser;
let cdp;
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const pending = new Map();
  const exceptions = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (!message.id) return;
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result);
  };
  return { exceptions, close: () => socket.close(), send: (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Chrome timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }) };
}
async function evaluate(expression, contextId) {
  const result = await cdp.send('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(50); }
  throw Error(`Timed out: ${expression}`);
}
function mockExtension() {
  window.observations = JSON.parse(sessionStorage.getItem('observations') || '[]');
  window.captureToken = null;
  window.extensionListeners = [];
  window.chrome = { runtime: {
    onMessage: { addListener: (fn) => window.extensionListeners.push(fn),
      removeListener: (fn) => { const index = window.extensionListeners.indexOf(fn); if (index >= 0) window.extensionListeners.splice(index, 1); } },
    sendMessage: async (message) => {
      if (message.type === 'GET_FORM_CAPTURE_CONTEXT') return { ok: true, token: window.captureToken };
      if (message.type === 'APPLICATION_FORM_CAPTURE') {
        window.observations.push(message.step);
        sessionStorage.setItem('observations', JSON.stringify(window.observations));
      }
      return { ok: true };
    },
  } };
  window.flushCapture = () => new Promise((resolve) => {
    window.extensionListeners.forEach((fn) => fn({ type: 'APPLICATION_CAPTURE_FLUSH' }, {}, resolve));
  });
  window.armCapture = () => {
    window.captureToken = 'test-application';
    return new Promise((resolve) => window.extensionListeners.forEach((fn) => fn({ type: 'APPLICATION_CAPTURE_START' }, {}, resolve)));
  };
}
async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => frameServer.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const frameOrigin = `http://127.0.0.1:${frameServer.address().port}`;
  browser = spawn(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let launchError;
  browser.on('error', (error) => { launchError = error; });
  let port;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch {}
    await pause(100);
  }
  if (!port) throw Error('Chrome did not start');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json());
  cdp = await connect(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${mockExtension.toString()})();` });
  await cdp.send('Page.navigate', { url: `${origin}/apply` });
  await until('Boolean(document.querySelector("#next"))');
  for (const source of scripts) await evaluate(source);
  await evaluate('flushCapture()');
  assert.equal((await evaluate('observations')).length, 0, 'unarmed page must not capture');
  await evaluate('armCapture()');
  let observations = await evaluate('observations');
  assert.equal(observations.at(-1).fields.find((field) => field.question === 'First name').answer, 'Candidate');
  assert.equal(observations.at(-1).fields.find((field) => field.question === 'Country').answer, 'United States');
  assert.equal(observations.at(-1).fields.length, 3);

  // The ATS replaces the old DOM synchronously in its Next handler.
  await evaluate(`document.querySelector('#next').onclick = () => { document.body.innerHTML = ${JSON.stringify(experience)}; };
    document.querySelector('input').value = 'Last second edit'; document.querySelector('#next').click();`);
  await until('observations.some(item => item.step === "My Experience")');
  observations = await evaluate('observations');
  assert.equal(observations.filter((step) => step.step === 'My Information').at(-1).fields[0].answer, 'Last second edit');
  let captured = observations.at(-1).fields;
  assert.deepEqual(captured.filter((field) => field.question === 'Company name').map((field) => field.answer), ['First company', 'Second company']);
  assert.equal(captured.find((field) => field.question === 'Work authorization').answer, 'Yes');
  assert.equal(captured.find((field) => field.question === 'Skills').answer, 'TypeScript\nSQL');
  assert.equal(captured.find((field) => field.question === 'Why this role?').answer, 'My actual answer\nSecond line');

  await evaluate(`document.querySelector('#second').remove(); document.querySelector('textarea').value = ''; flushCapture();`);
  await until('observations.at(-1).fields.filter(field => field.question === "Company name").length === 1');
  captured = (await evaluate('observations')).at(-1).fields;
  assert.equal(captured.find((field) => field.question === 'Why this role?').answer, '');
  await evaluate(`document.body.innerHTML = ${JSON.stringify(personal)}; document.querySelector('input').value = 'Corrected name'; flushCapture();`);
  await until('observations.at(-1).fields[0].answer === "Corrected name"');
  observations = await evaluate('observations');
  assert.equal(observations[0].key, observations.at(-1).key, 'Back must identify the same step');

  // Custom dropdowns can keep the committed value outside an empty search input.
  await evaluate(`document.body.innerHTML = ${JSON.stringify(customSelections)};
    document.querySelector('#recruiter-value').firstChild.data = 'No'; flushCapture();`);
  captured = (await evaluate('observations')).at(-1).fields;
  assert.equal(captured.find((field) => field.question === recruiterQuestion)?.answer, 'No', 'capture the visible selection, not the empty inner input');
  assert.equal(captured.length, 10, 'one record per dropdown, without search inputs or popup options');
  assert.equal(captured.find((field) => field.question === 'Can you relocate?').answer, 'No');
  assert.equal(captured.find((field) => field.question === 'Available for travel?').answer, 'No');
  assert.equal(captured.find((field) => field.question === 'Previously employed here?').answer, 'No', 'highlighted option must not replace the selected option');
  assert.equal(captured.find((field) => field.question === 'Preferred office').answer, 'Boston');
  assert.equal(captured.find((field) => field.question === 'Unanswered dropdown').answer, '', 'do not borrow a neighboring dropdown selection or a highlighted option');
  assert.equal(captured.find((field) => field.question === 'Have you applied before?').answer, 'No', 'exclude value and required text from ARIA question references');
  assert.equal(captured.find((field) => field.question === 'Native zero value').answer, 'No');
  assert.equal(captured.find((field) => field.question === 'Native empty value').answer, 'No');
  assert.equal(captured.find((field) => field.question === 'Native placeholder').answer, '');
  const questionStep = (await evaluate('observations')).at(-1);
  const recruiterId = captured.find((field) => field.question === recruiterQuestion).id;

  // Text-node updates are common in custom widgets and may emit no input event.
  await evaluate(`document.querySelector('#recruiter-value').firstChild.data = 'Yes';`);
  await until(`observations.at(-1).fields.find(field => field.question === ${JSON.stringify(recruiterQuestion)})?.answer === 'Yes'`);
  const editedStep = (await evaluate('observations')).at(-1);
  assert.equal(editedStep.key, questionStep.key, 'answers must not change the step identity');
  assert.equal(editedStep.fields.find((field) => field.question === recruiterQuestion).id, recruiterId);
  await evaluate(`document.querySelector('#recruiter-value').firstChild.data = 'Select One'; flushCapture();`);
  assert.equal((await evaluate('observations')).at(-1).fields.find((field) => field.question === recruiterQuestion).answer, '', 'clearing a dropdown must clear its saved answer');
  await evaluate(`document.querySelector('#employment-no').setAttribute('aria-selected', 'false');
    document.querySelector('.test-singleValue').remove(); flushCapture();`);
  captured = (await evaluate('observations')).at(-1).fields;
  assert.equal(captured.find((field) => field.question === 'Previously employed here?').answer, '');
  assert.equal(captured.find((field) => field.question === 'Preferred office').answer, '');

  // The final selection must survive a Next handler that immediately removes it.
  await evaluate(`document.querySelector('#questions-next').onclick = () => { document.body.innerHTML = ${JSON.stringify(personal)}; };
    document.querySelector('#recruiter-value').firstChild.data = 'No'; document.querySelector('#questions-next').click();`);
  await until('observations.at(-1).step === "My Information"');
  const finalQuestions = (await evaluate('observations')).filter((step) => step.step === 'Application Questions').at(-1);
  assert.equal(finalQuestions.fields.find((field) => field.question === recruiterQuestion).answer, 'No');

  // Ashby opens its application in the existing document, without a page reload.
  await evaluate(`history.pushState({}, '', '/ashby/application'); document.body.innerHTML = ${JSON.stringify(ashby)}; flushCapture();`);
  captured = (await evaluate('observations')).at(-1).fields;
  assert.equal(captured.find((field) => field.question === 'Have you applied before?')?.answer, 'No');
  assert.equal(captured.find((field) => field.question === 'Can you relocate?')?.answer, '', 'unanswered Yes/No must not become No');
  assert.equal(captured.find((field) => field.question === 'Preferred work schedule')?.answer, 'Full time');
  assert.equal(captured.find((field) => field.question === 'Preferred offices')?.answer, 'London\nRemote');
  assert.equal(captured.length, 6, 'grouped questions must not be duplicated as hidden checkboxes or option labels');
  await evaluate(`document.querySelector('#ashby-yesno [data-option="no"]').setAttribute('aria-pressed', 'false');
    document.querySelector('#ashby-yesno [data-option="yes"]').setAttribute('aria-pressed', 'true');`);
  await until(`observations.at(-1).fields.some(field => field.question === 'Have you applied before?' && field.answer === 'Yes')`);
  // Reinjecting the recorder must leave only one live listener/observer.
  const listenerCount = await evaluate('extensionListeners.length');
  await evaluate(scripts[1]);
  assert.equal(await evaluate('extensionListeners.length'), listenerCount);
  await evaluate(`document.querySelector('#ashby-yesno [aria-pressed="true"]').setAttribute('aria-pressed', 'false'); flushCapture();`);
  assert.equal((await evaluate('observations')).at(-1).fields.find((field) => field.question === 'Have you applied before?').answer, '');

  // Greenhouse can live in a cross-origin iframe on the company's careers page.
  await evaluate(`document.body.innerHTML = '<iframe src="${frameOrigin}/greenhouse"></iframe>';`);
  let greenhouseFrame;
  for (let i = 0; i < 100; i++) {
    greenhouseFrame = (await cdp.send('Page.getFrameTree')).frameTree.childFrames?.find(({ frame }) => frame.url.endsWith('/greenhouse'))?.frame;
    if (greenhouseFrame) break;
    await pause(50);
  }
  assert.ok(greenhouseFrame, 'cross-origin application frame loaded');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: greenhouseFrame.id, worldName: 'capture-test' });
  await evaluate(`(${mockExtension.toString()})();`, executionContextId);
  for (const source of scripts) await evaluate(source, executionContextId);
  await evaluate('armCapture()', executionContextId);
  captured = (await evaluate('observations', executionContextId)).at(-1).fields;
  assert.equal(captured.length, 4);
  assert.equal(captured.find((field) => field.question === 'Have you applied before?').answer, 'No');
  assert.equal(captured.find((field) => field.question === 'Preferred teams').answer, 'Platform');
  await evaluate(`document.querySelector('textarea').value = 'Final Greenhouse answer';
    document.querySelector('form').onsubmit = event => { event.preventDefault(); document.body.innerHTML = '<h1>Thank you for applying</h1>'; };
    document.querySelector('button[type="submit"]').click();`, executionContextId);
  await evaluate('flushCapture()', executionContextId);
  assert.equal((await evaluate('observations', executionContextId)).at(-1).fields.find((field) => field.question === 'Why this role?').answer, 'Final Greenhouse answer');

  for (const portal of portalFields) {
    await evaluate(`document.body.innerHTML = ${JSON.stringify(portal.html)};
      for (const id of ${JSON.stringify(portal.files || [])}) {
        const files = new DataTransfer(); files.items.add(new File(['fixture'], 'candidate.pdf', { type: 'application/pdf' }));
        document.getElementById(id).files = files.files;
      }
      flushCapture();`);
    captured = (await evaluate('observations')).at(-1).fields;
    assert.deepEqual(Object.fromEntries(captured.map(field => [field.question, field.answer])), portal.expected, portal.name);
    assert.equal(captured.length, Object.keys(portal.expected).length, `${portal.name}: no duplicate proxy inputs`);
  }

  // A full page load starts a new content script and rejoins the same session.
  await cdp.send('Page.navigate', { url: `${origin}/apply?step=2` });
  await until('Boolean(document.querySelector("#next"))');
  for (const source of scripts) await evaluate(source);
  await evaluate('armCapture()');
  assert.ok((await evaluate('observations')).some((item) => item.step === 'My Experience'));
  // Same-origin fixture supplies a separate frame document, as all_frames does.
  await evaluate(`document.body.innerHTML = '<iframe src="/frame"></iframe>';`);
  await until('Boolean(document.querySelector("iframe")?.contentDocument.querySelector("input"))');
  await evaluate(`document.querySelector('iframe').contentWindow.eval(${JSON.stringify(`(${mockExtension.toString()})();\n${scripts.join('\n')}`)});`);
  await evaluate(`document.querySelector('iframe').contentWindow.armCapture()`);
  const framed = await evaluate(`document.querySelector('iframe').contentWindow.observations.at(-1)`);
  assert.equal(framed.step, 'ADP Screening');
  assert.equal(framed.fields[0].answer, '2026-12-01');
  assert.equal(framed.url, `${origin}/frame`);

  await evaluate(`document.body.innerHTML = '<form><label>Password<input type="password" value="secret"></label><label>Email<input value="secret@example.test"></label></form>';`);
  const count = (await evaluate('observations')).length;
  await evaluate('flushCapture()');
  assert.equal((await evaluate('observations')).length, count, 'login screens must not be recorded');
  assert.deepEqual(cdp.exceptions, []);
  console.log('PASS: actual values, native/custom selections, Ashby groups, Greenhouse iframe, Paylocity/Lever/Workable/Rippling fields, enhanced selects, reinjection, clears, navigation and login exclusion');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  cdp?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise((resolve) => browser.once('exit', resolve));
    browser.kill();
    await Promise.race([exited, pause(3000)]);
  }
  server.close();
  frameServer.close();
  // Only delete the isolated directory created by this test, within .tmp.
  if (path.dirname(profile) === profileRoot && path.basename(profile).startsWith('form-capture-browser-')) {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
