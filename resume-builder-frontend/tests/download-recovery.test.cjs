const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');

const root = path.resolve(__dirname, '../src/renderer/src/lib');
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const never = () => new Promise(() => {});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness(globals = {}, overrides = {}) {
  let nextTimer = 0;
  const timers = new Map();
  const cache = new Map();
  const context = vm.createContext({
    Blob, Error, DOMException, Uint8Array, queueMicrotask,
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    FileReader: class {
      readAsDataURL() { this.result = 'data:application/pdf;base64,JVBERi0='; queueMicrotask(() => this.onload()); }
      abort() { this.onabort?.(); }
    },
    ...globals,
  });
  context.window = context;
  function load(filename) {
    filename = path.resolve(root, filename);
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    cache.set(filename, exports);
    const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta', '({ env: {} })');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const requireLocal = name => {
      if (name in overrides) return overrides[name];
      return load(path.resolve(path.dirname(filename), name + '.ts'));
    };
    vm.runInContext(`(function(exports, require) { ${compiled}\n})`, context, { filename })(exports, requireLocal);
    return exports;
  }
  return { load, timers, async expire(delay) {
    await flush();
    const matching = [...timers].filter(([, timer]) => timer.delay === delay);
    assert.ok(matching.length, `expected a ${delay}ms deadline`);
    for (const [id, timer] of matching) { timers.delete(id); timer.callback(); }
    await flush();
  } };
}

function stream(listenerApi = 'both') {
  const source = new EventEmitter();
  if (listenerApi === 'off') {
    source.off = EventEmitter.prototype.removeListener;
    source.removeListener = undefined;
    source.destroy = undefined;
  } else {
    if (listenerApi === 'removeListener') source.off = undefined;
    source.destroy = () => { source.destroyed = true; source.emit('close'); };
  }
  source.complete = () => { source.emit('data', new TextEncoder().encode('%PDF-fixture')); source.emit('end'); source.emit('close'); };
  return source;
}

for (const listenerApi of ['both', 'off', 'removeListener']) test(`PDF streams with ${listenerApi} produce a PDF blob and release listeners and timers`, async () => {
  const source = stream(listenerApi);
  const app = harness({}, { '@react-pdf/renderer': { pdf: () => ({ toBuffer: async () => source }) } });
  const result = app.load('render-pdf.ts').renderPdfBlob({});
  await flush(); source.complete();
  const blob = await result;
  assert.equal(blob.type, 'application/pdf');
  assert.equal(await blob.text(), '%PDF-fixture');
  assert.equal(source.eventNames().length, 0);
  assert.equal(app.timers.size, 0);
});

for (const listenerApi of ['both', 'off', 'removeListener']) for (const event of ['error', 'close']) test(`PDF stream ${event} with ${listenerApi} rejects instead of leaving the download pending`, async () => {
  const source = stream(listenerApi);
  const app = harness({}, { '@react-pdf/renderer': { pdf: () => ({ toBuffer: async () => source }) } });
  const rejected = assert.rejects(app.load('render-pdf.ts').renderPdfBlob({}), /Could not prepare the PDF/);
  await flush(); source.emit(event, new Error('broken stream')); await rejected;
  assert.equal(app.timers.size, 0);
});

test('a stalled renderer expires, disposes its late stream, and allows a successful retry', async () => {
  const pending = deferred();
  let render = () => pending.promise;
  const app = harness({}, { '@react-pdf/renderer': { pdf: () => ({ toBuffer: () => render() }) } });
  const { renderPdfBlob } = app.load('render-pdf.ts');
  const rejected = assert.rejects(renderPdfBlob({}), /Preparing the PDF took too long/);
  await app.expire(60_000); await rejected;
  const late = stream(); pending.resolve(late); await flush();
  assert.equal(late.destroyed, true);
  const next = stream(); render = async () => next;
  const retried = renderPdfBlob({}); await flush(); next.complete();
  assert.equal(await (await retried).text(), '%PDF-fixture');
});

test('a stream that never ends is destroyed when the PDF deadline expires', async () => {
  const source = stream();
  const app = harness({}, { '@react-pdf/renderer': { pdf: () => ({ toBuffer: async () => source }) } });
  const rejected = assert.rejects(app.load('render-pdf.ts').renderPdfBlob({}), /took too long/);
  await app.expire(60_000); await rejected;
  assert.equal(source.destroyed, true);
  assert.equal(source.eventNames().length, 0);
});

for (const mode of ['callback', 'promise', 'both']) test(`Chrome download supports its ${mode} completion API`, async () => {
  const chrome = { downloads: { download: (options, callback) => {
    assert.equal(options.filename, 'Resume.pdf');
    if (mode !== 'promise') queueMicrotask(() => callback(7));
    if (mode !== 'callback') return Promise.resolve(7);
  } } };
  await harness({ chrome }).load('chrome-downloads.ts').downloadBlob(new Blob(['%PDF-']), 'Resume.pdf');
});

test('a missing Chrome completion expires and a late download is cancelled', async () => {
  let callback;
  const cancelled = [];
  const chrome = { downloads: { download: (_options, done) => { callback = done; }, cancel: async id => { cancelled.push(id); } } };
  const app = harness({ chrome });
  const rejected = assert.rejects(app.load('chrome-downloads.ts').downloadBlob(new Blob(['%PDF-']), 'Resume.pdf'), /Chrome did not respond/);
  await app.expire(30_000); await rejected;
  callback(12); await flush(); assert.deepEqual(cancelled, [12]);
});

test('a stalled file reader is aborted without starting a Chrome download', async () => {
  let aborted = false;
  let started = false;
  const app = harness({
    FileReader: class { readAsDataURL() {} abort() { aborted = true; this.onabort(); } },
    chrome: { downloads: { download() { started = true; } } },
  });
  const rejected = assert.rejects(app.load('chrome-downloads.ts').downloadBlob(new Blob(['%PDF-']), 'Resume.pdf'), /Preparing the download took too long/);
  await app.expire(30_000); await rejected;
  assert.equal(aborted, true); assert.equal(started, false);
});

test('a stalled native write fails even if abort also hangs, and never closes after timeout', async () => {
  let closed = false;
  let aborted = false;
  const write = deferred();
  const writer = { write: () => write.promise, close: async () => { closed = true; }, abort: () => { aborted = true; return never(); } };
  const parent = { getDirectoryHandle: async () => ({ getFileHandle: async () => ({ createWritable: async () => writer }) }) };
  const app = harness({}, { './extension-storage': { getProfileDirectoryHandle: async () => parent } });
  const save = await app.load('profile-download.ts').createProfileDownload(true, 'job', 'profile');
  const rejected = assert.rejects(save(new Blob(['%PDF-']), 'Resume.pdf'), /Saving the file took too long/);
  await app.expire(30_000); await rejected;
  write.resolve(); await flush();
  assert.equal(aborted, true); assert.equal(closed, false);
});

test('a writer opened after timeout is aborted without writing', async () => {
  const opening = deferred();
  let aborted = false;
  const parent = { getDirectoryHandle: async () => ({ getFileHandle: async () => ({ createWritable: () => opening.promise }) }) };
  const app = harness({}, { './extension-storage': { getProfileDirectoryHandle: async () => parent } });
  const save = await app.load('profile-download.ts').createProfileDownload(true, 'job', 'profile');
  const rejected = assert.rejects(save(new Blob(['%PDF-']), 'Resume.pdf'), /Saving the file took too long/);
  await app.expire(30_000); await rejected;
  opening.resolve({ abort: async () => { aborted = true; }, write() { assert.fail('late write'); } });
  await flush(); assert.equal(aborted, true);
});

test('stalled browser storage does not block download location lookup forever', async () => {
  const app = harness({ chrome: { storage: { local: { get: never } } } });
  const rejected = assert.rejects(app.load('extension-storage.ts').getProfileDownloadPaths(), /reading the download location/);
  await app.expire(10_000); await rejected;
});

for (const reason of ['blocked', 'timeout']) test(`a ${reason} folder database open rejects and closes a late connection`, async () => {
  const request = {};
  let closed = false;
  const app = harness({ indexedDB: { open: () => request } });
  const rejected = assert.rejects(app.load('extension-storage.ts').getProfileDirectoryHandle('profile'), /download folder/);
  if (reason === 'blocked') request.onblocked(); else await app.expire(10_000);
  await rejected;
  request.result = { close() { closed = true; } }; request.onsuccess();
  assert.equal(closed, true);
});

test('a folder lookup transaction abort rejects instead of waiting for request success', async () => {
  const request = {};
  const transaction = { objectStore: () => ({ get: () => ({}) }) };
  let closed = false;
  const app = harness({ indexedDB: { open: () => request } });
  const rejected = assert.rejects(app.load('extension-storage.ts').getProfileDirectoryHandle('profile'), /saved download folder/);
  request.result = { transaction: () => transaction, close() { closed = true; } }; request.onsuccess();
  await flush(); transaction.onabort(); await rejected;
  assert.equal(closed, true);
});
