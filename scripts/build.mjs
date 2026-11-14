// Packages src/ into dist/settle.wgt (unsigned; sign/install with your usual Tizen tooling).
//   node scripts/build.mjs              -> dist/settle.wgt
//   node scripts/build.mjs --fonttest   -> dist/settle-fonttest.wgt (only the font-stretch test page)
// Zero dependencies: a minimal zip writer (deflate, forward-slash paths, config.xml first).
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join, resolve, relative, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..'), src = join(root, 'src'), dist = join(root, 'dist');
const fonttest = process.argv.includes('--fonttest');

if (!existsSync(join(src, 'icon.png'))) await import('./make-icon.mjs');

// Not shipped: preview-only mocks, the example config, the font test page, preview art.
const EXCLUDE = new Set(['js/mock.js', 'js/config.local.example.js', 'fonttest.html', 'brandsheet.html', 'img/preview-icon.svg']);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = new Map();                                      // zip path -> Buffer
if (fonttest) {
  files.set('config.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="http://settle.tv/fonttest" version="0.1.0" viewmodes="maximized">
    <tizen:application id="SettleFnt1.FontTest" package="SettleFnt1" required_version="3.0"/>
    <content src="index.html"/>
    <icon src="icon.png"/>
    <name>Settle Font Test</name>
    <feature name="http://tizen.org/feature/screen.size.normal.1080.1920"/>
    <tizen:profile name="tv-samsung"/>
    <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
`));
  files.set('index.html', readFileSync(join(src, 'fonttest.html')));
  files.set('fonts/archivo.woff2', readFileSync(join(src, 'fonts', 'archivo.woff2')));
  files.set('icon.png', readFileSync(join(src, 'icon.png')));
} else {
  for (const p of walk(src)) {
    const rel = relative(src, p).split(sep).join('/');
    if (EXCLUDE.has(rel) || rel.startsWith('img/preview') || rel.split('/').some((s) => s.startsWith('.'))) continue;
    files.set(rel, readFileSync(p));
  }
  // index.html loads js/mock.js in the preview only; drop that tag so the TV never requests it.
  files.set('index.html', Buffer.from(files.get('index.html').toString('utf8').replace(/\s*<script src="js\/mock\.js"><\/script>/, '')));
  // which build is on the TV: shown in Diagnostics and in captures
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  files.set('js/build-info.js', Buffer.from("window.SETTLE_BUILD = '" + stamp + "';\n"));
  // config.local.js carries your keys into the package (it is gitignored); never ship without the file index.html expects.
  if (!files.has('js/config.local.js')) files.set('js/config.local.js', Buffer.from('window.LAUNCHER_LOCAL = {};\n'));
}

// ---- minify the shipped JS (terser is a dev-only tool: it never goes into the package) ----
let rawJs = 0, minJs = 0;
if (!fonttest) {
  let minify = null;
  try { ({ minify } = await import('terser')); } catch { console.log('terser is not installed: shipping the JS as written'); }
  for (const [name, buf] of files) {
    if (!name.endsWith('.js')) continue;
    rawJs += buf.length;
    if (minify) {
      const r = await minify(buf.toString('utf8'), { compress: { passes: 2 }, mangle: true, format: { comments: false } });
      if (r.code) files.set(name, Buffer.from(r.code));
    }
    minJs += files.get(name).length;
  }
}

// ---- minimal zip ----
const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const DOS_TIME = 0, DOS_DATE = (46 << 9) | (1 << 5) | 1;       // fixed 2026-01-01: reproducible output

const names = [...files.keys()].sort((a, b) => (a === 'config.xml' ? -1 : b === 'config.xml' ? 1 : a.localeCompare(b)));
const parts = [], central = [];
let offset = 0;
for (const name of names) {
  const data = files.get(name), nm = Buffer.from(name), crc = crc32(data);
  const def = deflateRawSync(data, { level: 9 }), useDef = def.length < data.length;
  const body = useDef ? def : data, method = useDef ? 8 : 0;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
  parts.push(lh, nm, body);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
  central.push(ch, nm);
  offset += 30 + nm.length + body.length;
}
const cd = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);

mkdirSync(dist, { recursive: true });
const out = join(dist, fonttest ? 'settle-fonttest.wgt' : 'settle.wgt');
writeFileSync(out, Buffer.concat([...parts, cd, end]));

const js = names.filter((n) => n.endsWith('.js')).reduce((s, n) => s + files.get(n).length, 0);
console.log(`${relative(root, out)}  ${(statSync(out).size / 1024).toFixed(0)} KB, ${names.length} files, JS ${(js / 1024).toFixed(1)} KB${rawJs && rawJs !== js ? ' (source ' + (rawJs / 1024).toFixed(1) + ' KB)' : ''}`);
if (!fonttest && files.get('js/config.local.js').toString().includes('keys')) {
  console.log('NOTE: this package contains the API keys from js/config.local.js. Keep the .wgt private.');
}
