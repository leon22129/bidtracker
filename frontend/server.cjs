const { createServer } = require('node:http');
const next = require('next');
const { GENERATION_SOCKET_PATH, proxyGenerationSocket } = require('./scripts/generation-socket-proxy.cjs');
const { createProductionSnapshot } = require('./scripts/production-snapshot.cjs');

const dev = process.argv.includes('--dev');
process.env.NODE_ENV ||= dev ? 'development' : 'production';
const portIndex = process.argv.findIndex((arg) => arg === '-p' || arg === '--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 3000);
const hostname = process.env.HOSTNAME_BIND || '0.0.0.0';
if (!dev) {
  try {
    const snapshot = createProductionSnapshot(__dirname);
    process.env.BIDTRACKER_RUNTIME_DIST_DIR = snapshot.distDir;
    process.on('exit', snapshot.cleanup);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
// Next installs its own upgrade listener for development HMR. Give it a separate HTTP server
// object so it only sees upgrades we explicitly forward, never the API's WebSocket frames.
const nextUpgrades = createServer();
const app = next({ dev, dir: __dirname, hostname, port, httpServer: nextUpgrades });

async function start() {
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url === GENERATION_SOCKET_PATH) {
      proxyGenerationSocket(req, socket, head, process.env.BACKEND_URL || 'http://127.0.0.1:3001');
    } else if (!nextUpgrades.emit('upgrade', req, socket, head)) {
      socket.destroy();
    }
  });
  server.listen(port, hostname, () => console.log(`Frontend listening on http://${hostname}:${server.address().port}`));
  server.on('error', (error) => { console.error(error.message); process.exit(1); });
}

start().catch((error) => { console.error(error); process.exit(1); });
