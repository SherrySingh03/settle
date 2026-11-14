// Receives the Diagnostics capture from the TV and saves it as captures/<time>.txt.
//   node scripts/logserver.mjs [port]      (default 8787)
// Local network only; it writes the text it is sent to a file and does nothing else.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const port = +process.argv[2] || 8787, dir = resolve(import.meta.dirname, '..', 'captures');
mkdirSync(dir, { recursive: true });
createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  if (req.method !== 'POST') return res.writeHead(200).end('settle log receiver');
  const parts = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n < 2e6) parts.push(c); });
  req.on('end', () => {
    const f = join(dir, new Date().toISOString().replace(/[:.]/g, '-') + '.txt');
    writeFileSync(f, Buffer.concat(parts));
    console.log(`saved ${f} (${n} bytes) from ${req.socket.remoteAddress}`);
    res.writeHead(204).end();
  });
}).listen(port, '0.0.0.0', () => console.log(`waiting on port ${port}; captures go to ${dir}`));
