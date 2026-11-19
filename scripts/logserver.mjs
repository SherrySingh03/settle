// Receives the Diagnostics capture from the TV and saves it as captures/<time>.txt.
// Also keeps Settle's settings backups (Control Center > Settle > Back up to this PC):
//   POST /backup  saves captures/backups/<time>.json and latest.json;  GET /backup  returns latest.json (for Restore).
//   node scripts/logserver.mjs [port]      (default 8787)
// Local network only; it writes what it is sent to files and does nothing else.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const port = +process.argv[2] || 8787, dir = resolve(import.meta.dirname, '..', 'captures'), bdir = join(dir, 'backups');
mkdirSync(bdir, { recursive: true });
createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  const backup = req.url.split('?')[0] === '/backup', latest = join(bdir, 'latest.json');
  if (backup && req.method === 'GET') {
    if (!existsSync(latest)) return res.writeHead(404).end('no backup yet');
    res.setHeader('content-type', 'application/json');
    return res.writeHead(200).end(readFileSync(latest));
  }
  if (req.method !== 'POST') return res.writeHead(200).end('settle log receiver');
  const parts = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n < 2e6) parts.push(c); });
  req.on('end', () => {
    if (backup) {
      const body = Buffer.concat(parts);
      try { JSON.parse(body.toString('utf8')); } catch { return res.writeHead(400).end('not JSON'); }
      const f = join(bdir, new Date().toISOString().replace(/[:.]/g, '-') + '.json');
      writeFileSync(f, body); writeFileSync(latest, body);
      console.log(`backup saved ${f} (${n} bytes) from ${req.socket.remoteAddress}`);
      return res.writeHead(204).end();
    }
    const f = join(dir, new Date().toISOString().replace(/[:.]/g, '-') + '.txt');
    writeFileSync(f, Buffer.concat(parts));
    console.log(`saved ${f} (${n} bytes) from ${req.socket.remoteAddress}`);
    res.writeHead(204).end();
  });
}).listen(port, '0.0.0.0', () => console.log(`waiting on port ${port}; captures go to ${dir}`));
