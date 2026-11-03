// Real DOM/navigation fixtures; no ATS account or application submission needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
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
const formHtml = (body) => `<!doctype html><html><body>${body}</body></html>`;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/frame') return res.end(formHtml('<main><h2>ADP Screening</h2><label>Available date<input type="date" value="2026-12-01"></label></main>'));
  res.end(formHtml(personal));
});
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
async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
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
    onMessage: { addListener: (fn) => window.extensionListeners.push(fn) },
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
  const origin = `http://127.0.0.1:${server.address().port}`;
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
  console.log('PASS: actual values, Next before DOM removal, repeated fields, selections, blanks/deletions, Back, reload, iframe and login exclusion');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  cdp?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise((resolve) => browser.once('exit', resolve));
    browser.kill();
    await Promise.race([exited, pause(3000)]);
  }
  server.close();
  // Only delete the isolated directory created by this test, within .tmp.
  if (path.dirname(profile) === profileRoot && path.basename(profile).startsWith('form-capture-browser-')) {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
