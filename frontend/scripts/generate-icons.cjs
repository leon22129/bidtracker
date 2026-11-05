// Render the SVG master with Chrome; no extra image packages are required.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const publicRoot = path.resolve(__dirname, '../public');
const svg = fs.readFileSync(path.join(publicRoot, 'icon.svg'), 'utf8');
const profileRoot = path.resolve(os.tmpdir());
const profile = fs.mkdtempSync(path.join(profileRoot, 'bidtracker-icons-'));
const chrome = spawn(process.env.CHROME_BIN || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome'), [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
const pending = new Map();
let buffer = '';
let nextId = 0;
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Chrome timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}
chrome.on('error', error => {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
  pending.clear();
});
chrome.stdio[4].setEncoding('utf8');
chrome.stdio[4].on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\0')) !== -1) {
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    const item = pending.get(message.id);
    if (!item) continue;
    pending.delete(message.id);
    clearTimeout(item.timer);
    message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result);
  }
});

async function main() {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  const { frameTree } = await send('Page.getFrameTree', {}, sessionId);
  await send('Page.setDocumentContent', {
    frameId: frameTree.frame.id,
    html: `<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style>${svg}`,
  }, sessionId);
  const images = new Map();
  for (const size of [16, 32, 48, 180, 192, 512]) {
    await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Emulation.setDefaultBackgroundColorOverride', {
      color: size === 180 ? { r: 16, g: 40, b: 63, a: 1 } : { r: 0, g: 0, b: 0, a: 0 },
    }, sessionId);
    await send('Runtime.evaluate', { expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', awaitPromise: true }, sessionId);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } }, sessionId);
    const png = Buffer.from(data, 'base64');
    if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw Error(`Unexpected PNG dimensions: ${size}`);
    images.set(size, png);
    if (size >= 180) {
      const filename = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
      fs.writeFileSync(path.join(publicRoot, filename), png);
      console.log(`Generated ${filename} (${size}x${size})`);
    }
  }
  const sizes = [16, 32, 48];
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size;
    directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images.get(size).length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images.get(size).length;
  });
  fs.writeFileSync(path.join(publicRoot, 'favicon.ico'), Buffer.concat([directory, ...sizes.map(size => images.get(size))]));
  console.log('Generated favicon.ico (16, 32, 48px)');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve));
    try { await send('Browser.close'); } catch { chrome.kill(); }
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  // Only remove the fresh, generated profile in the intended temporary directory.
  if (path.dirname(path.resolve(profile)) === profileRoot && path.basename(profile).startsWith('bidtracker-icons-')) {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
