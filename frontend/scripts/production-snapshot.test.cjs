const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createProductionSnapshot } = require('./production-snapshot.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bidtracker-snapshot-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    const target = path.join(root, '.next', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  write('BUILD_ID', 'first-build');
  write('server/app/workspaces.html', '<script src="/old-chunk.js"></script>');
  write('static/chunks/app/(app)/old-chunk.js', 'old JavaScript');
  write('cache/webpack/compiler-cache', 'not needed at runtime');
  return { root, write };
}

test('a running snapshot keeps its HTML and chunks when a build deletes and replaces .next', (t) => {
  const { root, write } = fixture(t);
  const first = createProductionSnapshot(root);
  const firstDir = path.join(root, first.distDir);
  fs.rmSync(path.join(root, '.next'), { recursive: true });
  write('BUILD_ID', 'second-build');
  write('server/app/workspaces.html', '<script src="/new-chunk.js"></script>');
  write('static/chunks/app/(app)/new-chunk.js', 'new JavaScript');

  assert.match(fs.readFileSync(path.join(firstDir, 'server/app/workspaces.html'), 'utf8'), /old-chunk/);
  assert.equal(fs.readFileSync(path.join(firstDir, 'static/chunks/app/(app)/old-chunk.js'), 'utf8'), 'old JavaScript');
  assert.equal(fs.existsSync(path.join(firstDir, 'cache')), false);

  const second = createProductionSnapshot(root);
  const secondDir = path.join(root, second.distDir);
  assert.notEqual(first.distDir, second.distDir);
  assert.match(fs.readFileSync(path.join(secondDir, 'server/app/workspaces.html'), 'utf8'), /new-chunk/);
  assert.equal(fs.readFileSync(path.join(secondDir, 'static/chunks/app/(app)/new-chunk.js'), 'utf8'), 'new JavaScript');
  assert.equal(fs.existsSync(path.join(secondDir, 'static/chunks/app/(app)/old-chunk.js')), false);
  first.cleanup();
  first.cleanup();
  assert.equal(fs.existsSync(firstDir), false);
  assert.equal(fs.existsSync(secondDir), true);
  assert.equal(fs.readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8'), 'second-build');
  second.cleanup();
});

test('startup refuses an incomplete build', (t) => {
  const { root, write } = fixture(t);
  fs.unlinkSync(path.join(root, '.next/BUILD_ID'));
  assert.throws(() => createProductionSnapshot(root), /No completed frontend build/);
  write('BUILD_ID', '');
  assert.throws(() => createProductionSnapshot(root), /No completed frontend build/);
});

test('startup preserves snapshots belonging to a live process and unrelated files', (t) => {
  const { root } = fixture(t);
  const first = createProductionSnapshot(root);
  const unrelated = path.join(root, '.next-runtime/keep-me');
  fs.mkdirSync(unrelated);
  const second = createProductionSnapshot(root);
  assert.equal(fs.existsSync(path.join(root, first.distDir)), true);
  assert.equal(fs.existsSync(unrelated), true);
  second.cleanup();
  first.cleanup();
});
