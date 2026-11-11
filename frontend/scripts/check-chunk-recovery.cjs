const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const frontend = path.resolve(__dirname, '..');
const base = process.argv.find(arg => /^https?:/.test(arg)) || 'http://127.0.0.1:3100';
const pending = new Map();
const scenarios = new Map();
const errors = [];
let browser, server, nextId = 0, buffer = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(fn, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if (await fn()) return; } catch {}
    await pause(100);
  }
  throw Error(`Timed out: ${label}; ${errors.join('; ')}`);
}

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 15000);
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
  localStorage.setItem('bidtracker_token', 'recovery-fixture');
  const originalFetch = window.fetch.bind(window);
  const user = { id: 'recovery-user', username: 'Recovery Tester', email: 'recovery@example.test', role: 'bidder', is_active: true };
  const workspace = { id: 'recovery-workspace', name: 'Recovery verification workspace', owner_user_id: user.id,
    owner: user, is_archived: false, can_edit: true, application_count: 0, applied_today_by_user: [], profile: null };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
    const result = url.pathname === '/api/auth/me' ? user : url.pathname === '/api/workspaces' ? [workspace] : [];
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  };
}

async function intercept(message) {
  const state = scenarios.get(message.sessionId);
  const { requestId, request, resourceType } = message.params;
  const url = new URL(request.url);
  let fail = false;
  if (/\/_next\/static\/chunks\/258-.*\.js$/.test(url.pathname)) {
    state.chunks++;
    fail = state.mode === 'always' || state.mode === 'once' && state.chunks === 1;
  } else if (resourceType !== 'Document' && url.searchParams.has('_bt_reload')) {
    state.probes++;
    fail = state.failFirstProbe && state.probes === 1;
  }
  if (fail) {
    // Reproduce the reported MIME failure: an HTML error document at a JS URL.
    await send('Fetch.fulfillRequest', { requestId, responseCode: url.pathname === '/workspaces' ? 530 : 400,
      responsePhrase: url.pathname === '/workspaces' ? 'Origin Error' : 'Bad Request',
      responseHeaders: [{ name: 'Content-Type', value: 'text/html' }, { name: 'Cache-Control', value: 'no-store' }],
      body: Buffer.from('<!doctype html><title>Temporary upstream error</title>').toString('base64'),
    }, message.sessionId);
  } else {
    await send('Fetch.continueRequest', { requestId }, message.sessionId);
  }
}

async function page(options) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const state = { mode: 'once', chunks: 0, documents: 0, probes: 0, ...options };
  scenarios.set(sessionId, state);
  for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable']) await send(method, {}, sessionId);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${fixture.toString()})();${state.blockStorage ? "Object.defineProperty(window, 'sessionStorage', { get() { throw Error('Storage unavailable'); } });" : ''}` }, sessionId);
  await send('Fetch.enable', { patterns: [
    { urlPattern: '*://*/_next/static/chunks/258-*.js*' },
    { urlPattern: '*://*/workspaces*' },
  ] }, sessionId);
  await send('Page.navigate', { url: base + '/workspaces?from=recovery-test#detail' }, sessionId);
  return { sessionId, state, read: expression => evaluate(sessionId, expression) };
}

async function main() {
  if (process.argv.includes('--start') && !process.argv.includes('--no-start')) {
    server = spawn(process.execPath, ['server.cjs', '-p', new URL(base).port], {
      cwd: frontend, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOSTNAME_BIND: '127.0.0.1' },
    });
    server.stdout.on('data', chunk => process.stdout.write(chunk));
    server.stderr.on('data', chunk => process.stderr.write(chunk));
    server.on('error', error => errors.push(error.message));
    await until(async () => (await fetch(base + '/login', { signal: AbortSignal.timeout(3000) })).ok, 'test server');
  }
  const response = await fetch(base + '/workspaces');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const html = await response.text();
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]*\/_next\/static\/[^" ]+\.js[^" ]*)"/g)].map(x => new URL(x[1], base));
  assert.ok(scripts.length > 5);
  const deploymentIds = new Set(scripts.map(url => url.searchParams.get('dpl')));
  assert.equal(deploymentIds.size, 1);
  assert.ok(!deploymentIds.has(null), 'every script uses the deployment cache key');
  console.log('PASS: fresh page documents and consistent deployment keys on scripts');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bidtracker-recovery-browser-'));
  browser = spawn(process.env.CHROME_BIN || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome'), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank',
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
      if (message.method === 'Fetch.requestPaused') void intercept(message).catch(error => errors.push(error.message));
      if (message.method === 'Network.requestWillBeSent' && message.params.type === 'Document') scenarios.get(message.sessionId).documents++;
    }
  });

  const once = await page({ mode: 'once' });
  await until(() => once.read("document.body.innerText.includes('Recovery verification workspace')"), 'recovery after HTML chunk response');
  assert.equal(once.state.documents, 2);
  assert.equal(once.state.chunks, 2);
  assert.equal(await once.read("new URL(location.href).searchParams.get('from')"), 'recovery-test');
  assert.equal(await once.read('location.hash'), '#detail');
  assert.equal(await once.read("!!document.getElementById('bidtracker-load-recovery')"), false);
  console.log('PASS: HTML returned for chunk 258 triggers one reload and the workspace recovers');

  const outage = await page({ mode: 'once', failFirstProbe: true });
  await until(() => outage.read("document.body.innerText.includes('Recovery verification workspace')"), 'recovery after temporary tunnel error');
  assert.equal(outage.state.documents, 2);
  assert.ok(outage.state.probes >= 2, JSON.stringify(outage.state));
  console.log('PASS: a tunnel error delays reload until a fresh app document is available');

  const persistent = await page({ mode: 'always', blockStorage: true });
  await until(() => persistent.state.documents === 2 && persistent.read("!!document.querySelector('#bidtracker-load-recovery button')"), 'persistent failure fallback');
  await pause(3500);
  assert.equal(persistent.state.documents, 2, 'no reload loop even when sessionStorage is unavailable');
  assert.equal(persistent.state.chunks, 2);
  assert.ok(await persistent.read("document.getElementById('bidtracker-load-recovery').innerText.includes('Reload page')"));
  console.log('PASS: persistent chunk failures show a reload button without an automatic reload loop');

  const edited = await page({ mode: 'none' });
  await until(() => edited.read("document.body.innerText.includes('Recovery verification workspace')"), 'healthy workspace');
  edited.state.mode = 'always';
  await edited.read(`(() => {
    const input = document.createElement('input'); input.id = 'unsaved-input'; input.value = 'keep my draft';
    document.body.appendChild(input); input.dispatchEvent(new Event('input', { bubbles: true }));
    const script = document.createElement('script'); script.src = '/_next/static/chunks/258-fault-fixture.js'; document.head.appendChild(script);
  })()`);
  await until(() => edited.read("!!document.querySelector('#bidtracker-load-recovery button')"), 'manual recovery with unsaved input');
  await pause(1000);
  assert.equal(edited.state.documents, 1);
  assert.equal(await edited.read("document.getElementById('unsaved-input').value"), 'keep my draft');
  assert.deepEqual(errors, []);
  console.log('PASS: unsaved form input is preserved; automatic reload is disabled after editing');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) { try { await send('Browser.close'); } catch {} browser.kill(); }
  if (server) server.kill();
});
