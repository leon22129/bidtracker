// Exercise real extension messages across SPA routes, which mocked senders miss.
// All forms, API calls and submissions are local fixtures in an isolated profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const profileRoot = path.resolve(__dirname, '../../.tmp');
fs.mkdirSync(profileRoot, { recursive: true });
const profile = fs.mkdtempSync(path.join(profileRoot, 'capture-navigation-'));
const extension = path.join(profile, 'extension');
fs.mkdirSync(extension);
const publicRoot = path.resolve(__dirname, '../src/renderer/public');
for (const file of ['background.js', 'content-script.js', 'application-capture.js']) {
  fs.copyFileSync(path.join(publicRoot, file), path.join(extension, file));
}
const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'manifest.json')));
delete manifest.icons;
delete manifest.action.default_icon;
fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
fs.writeFileSync(path.join(extension, 'index.html'), '<!doctype html><title>Capture fixture</title>');
const uploads = [];
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    uploads.push({ url: req.url, body: Buffer.concat(chunks).toString() });
    res.setHeader('Content-Type', 'application/json');
    return res.end('{}');
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><html><body><main><h1>Job posting</h1></main></body></html>');
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
let nextId = 0;
let buffer = '';
const requests = new Map();
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { requests.delete(id); reject(Error(`Chrome timed out: ${method}`)); }, 15000);
    requests.set(id, { resolve, reject, timer, method });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}
async function evaluate(sessionId, expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(read, label) {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (value) return value;
    await pause(100);
  }
  throw Error(`Timed out: ${label}`);
}
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(process.env.CHROME_BIN || (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome'), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  browser.on('error', error => {
    for (const request of requests.values()) { clearTimeout(request.timer); request.reject(error); }
    requests.clear();
  });
  browser.stdio[4].setEncoding('utf8');
  browser.stdio[4].on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      const request = requests.get(message.id);
      if (!request) continue;
      clearTimeout(request.timer); requests.delete(message.id);
      message.error ? request.reject(Error(`${request.method}: ${message.error.message}`)) : request.resolve(message.result);
    }
  });
  const { id } = await send('Extensions.loadUnpacked', { path: extension });
  const { targetId: panelId } = await send('Target.createTarget', { url: `chrome-extension://${id}/index.html` });
  const { sessionId: panel } = await send('Target.attachToTarget', { targetId: panelId, flatten: true });
  await until(() => evaluate(panel, 'Boolean(globalThis.chrome?.storage)'), 'extension page');
  await evaluate(panel, `chrome.storage.local.set({ resume_ai_access_token: 'fixture', resume_ai_api_url: '${origin}/api' })`);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: page } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.navigate', { url: `${origin}/posting` }, page);
  await until(() => evaluate(page, 'Boolean(document.querySelector("h1"))'), 'job posting');
  const armed = await evaluate(panel, `(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === '${origin}/posting');
    globalThis.applicationTab = tab.id;
    return chrome.runtime.sendMessage({ type: 'ARM_APPLICATION_SCREENSHOT', applicationId: 'navigation',
      draftId: 'navigation', profileTabId: 'fixture', tabId: tab.id, url: tab.url });
  })()`);
  assert.equal(armed.ok, true, armed.error);
  const pending = () => evaluate(panel, `(async () => (await chrome.storage.local.get('resume_ai_pending_screenshots')).resume_ai_pending_screenshots['fixture:navigation'])()`);
  await evaluate(page, `history.pushState({}, '', '/posting/application');
    document.body.innerHTML = '<main><h1>Application</h1><form><label>Why this role?<textarea>Initial answer</textarea></label><button type="submit">Submit application</button></form></main>'`);
  await until(async () => (await pending())?.captureSteps?.length, 'capture after pushState');
  assert.equal((await pending()).captureError, null);
  assert.equal((await pending()).captureWarning, undefined);
  assert.equal((await pending()).captureSteps[0].url, `${origin}/posting/application`);
  await evaluate(page, `document.querySelector('textarea').value = 'Final answer';
    document.querySelector('form').onsubmit = event => {
      event.preventDefault(); history.replaceState({}, '', '/posting/confirmation');
    };
    document.querySelector('button').click()`);
  // Flush while the old form is still mounted, as a portal can leave it during
  // the transition. This avoids depending on background-tab timer throttling.
  await evaluate(panel, `chrome.tabs.sendMessage(applicationTab, { type: 'APPLICATION_CAPTURE_FLUSH' })`);
  await evaluate(page, `document.body.innerHTML = '<h1>Thank you for applying</h1>'`);
  await until(async () => (await pending())?.submitted, 'submission confirmation');
  const entry = await pending();
  assert.equal(entry.captureError, null);
  assert.equal(entry.captureWarning, undefined);
  assert.equal(entry.captureSteps.find(step => step.url.endsWith('/application')).fields[0].answer, 'Final answer');
  assert.ok(entry.captureSteps.some(step => step.url.endsWith('/confirmation')), 'capture a replaced route before its form unmounts');
  const result = await evaluate(panel, `chrome.runtime.sendMessage({ type: 'CAPTURE_APPLICATION_SCREENSHOT',
    applicationId: 'navigation', profileTabId: 'fixture', tabId: applicationTab, confirmed: true })`);
  assert.equal(result.ok, true, result.error);
  assert.equal(uploads.at(-1).url, '/api/applications/drafts/navigation/submit');
  assert.match(uploads.at(-1).body, /filename="application-submitted.png"/);
  assert.ok(uploads.filter(item => item.url.endsWith('/form-capture')).some(item =>
    JSON.parse(item.body).fields[0].answer === 'Final answer'));
  assert.equal(await pending(), undefined);
  console.log('PASS: real extension transport, pushState, replaceState, final answers, confirmation and screenshot submission');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser && browser.exitCode === null) {
    const exited = new Promise(resolve => browser.once('exit', resolve));
    try { await send('Browser.close'); } catch {}
    browser.kill();
    await Promise.race([exited, pause(3000)]);
  }
  server.close();
  if (path.dirname(profile) === profileRoot && path.basename(profile).startsWith('capture-navigation-')) {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
