import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tscPath = require.resolve('typescript/bin/tsc');
const children = new Set();
let stopping = false;

function startNode(args) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(exitCode), 250).unref();
}

process.once('SIGINT', () => shutdown(130));
process.once('SIGTERM', () => shutdown(143));

// Compile once before starting the server so watch mode also works on a clean checkout.
const initialBuild = startNode([tscPath, '-p', 'tsconfig.build.json']);
const initialResult = await waitForExit(initialBuild);
if (initialResult.code !== 0) process.exit(initialResult.code ?? 1);

const compiler = startNode([
  tscPath,
  '-p',
  'tsconfig.build.json',
  '--watch',
  '--preserveWatchOutput',
]);
const server = startNode([
  '--watch',
  '--watch-preserve-output',
  'dist/main.js',
]);

for (const child of [compiler, server]) {
  child.once('error', (error) => {
    console.error(error);
    shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`Development process stopped unexpectedly (${signal ?? code ?? 'unknown'}).`);
      shutdown(code ?? 1);
    }
  });
}
