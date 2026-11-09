const http = require('node:http');
const https = require('node:https');

const GENERATION_SOCKET_PATH = '/api/resume/jobs/events';

/** Forward just this upgrade route; ordinary requests still use the existing Next API proxy. */
function proxyGenerationSocket(req, socket, head, backendUrl) {
  const target = new URL(GENERATION_SOCKET_PATH, backendUrl);
  const transport = target.protocol === 'https:' ? https : http;
  let upstreamSocket;
  const upstream = transport.request(target, {
    method: 'GET', headers: { ...req.headers, host: target.host },
  });
  const timer = setTimeout(() => { upstream.destroy(); socket.destroy(); }, 10_000);
  const fail = () => {
    clearTimeout(timer);
    if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  };
  socket.on('error', () => { upstream.destroy(); upstreamSocket?.destroy(); });
  socket.on('close', () => { clearTimeout(timer); upstream.destroy(); upstreamSocket?.destroy(); });
  upstream.on('error', fail);
  upstream.on('response', (response) => {
    clearTimeout(timer);
    socket.end(`HTTP/1.1 ${response.statusCode || 502} Upgrade rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    response.resume();
  });
  upstream.on('upgrade', (response, peer, upstreamHead) => {
    clearTimeout(timer);
    upstreamSocket = peer;
    if (socket.destroyed) { peer.destroy(); return; }
    socket.setTimeout(0);
    peer.setTimeout(0);
    peer.on('error', () => socket.destroy());
    peer.on('close', () => socket.destroy());
    const headers = response.rawHeaders.reduce((lines, value, index, all) =>
      index % 2 ? lines : [...lines, `${value}: ${all[index + 1]}`], []);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join('\r\n')}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) peer.write(head);
    peer.pipe(socket).pipe(peer);
  });
  upstream.end();
}

module.exports = { GENERATION_SOCKET_PATH, proxyGenerationSocket };
