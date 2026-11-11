const fs = require('node:fs');
const path = require('node:path');

// Next caches manifests in memory. Rebuilding the directory it serves deletes
// chunks still referenced by those manifests, producing 400s and ChunkLoadErrors.
// Each production process serves its own copy; builds continue to target .next.
function createProductionSnapshot(frontendRoot) {
  const source = path.join(frontendRoot, '.next');
  const runtimeRoot = path.join(frontendRoot, '.next-runtime');
  const readBuildId = () => fs.readFileSync(path.join(source, 'BUILD_ID'), 'utf8').trim();
  let buildId;
  try {
    buildId = readBuildId();
    if (!buildId) throw new Error('Empty BUILD_ID');
  } catch {
    throw new Error('No completed frontend build. Run npm run build before npm start.');
  }

  fs.mkdirSync(runtimeRoot, { recursive: true });
  // Abrupt termination cannot run the exit hook. Remove only snapshots whose
  // owning process no longer exists, leaving other frontend instances alone.
  for (const entry of fs.readdirSync(runtimeRoot, { withFileTypes: true })) {
    const owner = /^server-(\d+)-[a-zA-Z0-9]+$/.exec(entry.name);
    if (!entry.isDirectory() || !owner) continue;
    try {
      process.kill(Number(owner[1]), 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        fs.rmSync(path.join(runtimeRoot, entry.name), { recursive: true, force: true });
      }
    }
  }

  const snapshot = fs.mkdtempSync(path.join(runtimeRoot, `server-${process.pid}-`));
  const cleanup = () => fs.rmSync(snapshot, { recursive: true, force: true });
  try {
    fs.cpSync(source, snapshot, {
      recursive: true,
      // Compiler caches are large and are not used to serve a production build.
      filter: (file) => file !== path.join(source, 'cache'),
    });
    if (readBuildId() !== buildId) throw new Error('Build changed while copying');
  } catch (error) {
    cleanup();
    throw new Error('Could not snapshot the frontend build. Wait for npm run build to finish, then restart.', { cause: error });
  }

  return { distDir: path.relative(frontendRoot, snapshot), cleanup };
}

module.exports = { createProductionSnapshot };
