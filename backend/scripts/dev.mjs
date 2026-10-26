import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const prismaPath = require.resolve('prisma/build/index.js');
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

function startPipedNode(args) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
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

// Schema changes need a regenerated client even when the database is already migrated.
console.log('Generating Prisma client before compiling the backend...');
const generation = startNode([prismaPath, 'generate', '--schema', 'prisma/schema.prisma']);
const generationResult = await waitForExit(generation);
if (generationResult.code !== 0) process.exit(generationResult.code ?? 1);
if (stopping) process.exit(0);

// Compile once before starting the server so watch mode also works on a clean checkout.
const initialBuild = startNode([tscPath, '-p', 'tsconfig.build.json']);
const initialResult = await waitForExit(initialBuild);
if (initialResult.code !== 0) process.exit(initialResult.code ?? 1);

const compiler = startPipedNode([
  tscPath,
  '-p',
  'tsconfig.build.json',
  '--watch',
  '--preserveWatchOutput',
]);

let server = null;
let restartingServer = false;

function launchServer() {
  if (stopping) return;
  const child = startNode(['dist/main.js']);
  server = child;
  child.once('error', (error) => {
    console.error(error);
    shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (stopping || child !== server) return;
    server = null;
    console.error(`Development server stopped unexpectedly (${signal ?? code ?? 'unknown'}).`);
    shutdown(code ?? 1);
  });
}

function restartServer() {
  if (stopping || restartingServer) return;
  if (!server || server.exitCode !== null) {
    launchServer();
    return;
  }

  restartingServer = true;
  const previous = server;
  server = null;
  previous.once('exit', () => {
    restartingServer = false;
    launchServer();
  });
  previous.kill();
}

// Restart only after TypeScript finishes a successful compilation. Letting `node --watch`
// monitor the whole backend causes restart storms on Windows while tsc emits files one by one.
let compilerOutput = '';
compiler.stdout.on('data', (chunk) => {
  compilerOutput = `${compilerOutput}${chunk}`.slice(-12000);
  if (!/Found 0 errors\. Watching for file changes\./.test(compilerOutput)) return;
  compilerOutput = '';
  restartServer();
});

compiler.once('error', (error) => {
  console.error(error);
  shutdown(1);
});
compiler.once('exit', (code, signal) => {
  if (!stopping) {
    console.error(`TypeScript watch process stopped unexpectedly (${signal ?? code ?? 'unknown'}).`);
    shutdown(code ?? 1);
  }
});
