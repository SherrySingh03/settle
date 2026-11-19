// Packages src/ into dist/settle.wgt (unsigned; sign/install with your usual Tizen tooling).
//   node scripts/build.mjs              -> dist/settle.wgt
//   node scripts/build.mjs --fonttest   -> dist/settle-fonttest.wgt (only the font-stretch test page)
//   node scripts/build.mjs --public     -> dist/Settle-<version>.wgt for a GitHub release and the Apps2Samsung catalogue:
//                                          none of your keys or addresses, the settings file Apps2Samsung fills in on install
// Zero dependencies: a minimal zip writer (deflate, forward-slash paths, config.xml first).
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join, resolve, relative, sep } from 'node:path';
import { joinApp } from './app-bundle.mjs';

const root = resolve(import.meta.dirname, '..'), src = join(root, 'src'), dist = join(root, 'dist');
const fonttest = process.argv.includes('--fonttest'), pub = process.argv.includes('--public');
const PUBLIC_CONFIG = join(root, 'packaging', 'apps2samsung', 'config.local.js');

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
    if (EXCLUDE.has(rel) || rel.startsWith('img/preview') || rel.startsWith('js/app/') || rel.split('/').some((s) => s.startsWith('.'))) continue;
    files.set(rel, readFileSync(p));
  }
  files.set('js/app.js', Buffer.from(joinApp(src)));           // the pieces in src/js/app/, joined into the one file the TV loads
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

// ---- minify the shipped CSS: comments and whitespace only (no rule is rewritten) ----
let rawCss = 0, minCss = 0;
for (const [name, buf] of files) {
  if (!name.endsWith('.css')) continue;
  const src = buf.toString('utf8');
  rawCss += buf.length;
  const min = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/;}/g, '}').trim();
  files.set(name, Buffer.from(min));
  minCss += Buffer.byteLength(min);
}

// ---- public build: the catalogue's settings file in place of yours, as written (its "find" lines must survive) ----
if (pub) {
  files.set('js/config.local.js', readFileSync(PUBLIC_CONFIG));
  // Nothing of yours may ride along: every quoted value of 6+ characters in your config.local.js, and any private IPv4 address.
  let mine = [];
  try { mine = [...readFileSync(join(src, 'js', 'config.local.js'), 'utf8').matchAll(/['"]([^'"\s]{6,})['"]/g)].map((m) => m[1]); } catch { /* no local file */ }
  const leaks = [];
  for (const [name, buf] of files) {
    if (/\.(png|jpe?g|woff2?|gif|webp)$/.test(name)) continue;
    const text = buf.toString('utf8');
    for (const v of mine) if (text.includes(v)) leaks.push(name + ': a value from your config.local.js');
    for (const m of text.matchAll(/\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/g)) {
      if (m[0].split('.').length === 4) leaks.push(name + ': the address ' + m[0].replace(/\.\d+$/, '.x'));
    }
  }
  if (leaks.length) { console.error('Public build stopped, this would be published:\n  ' + [...new Set(leaks)].join('\n  ')); process.exit(1); }
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
const version = (readFileSync(join(src, 'config.xml'), 'utf8').match(/<widget[^>]*\sversion="([^"]+)"/) || [])[1] || '0';
const out = join(dist, fonttest ? 'settle-fonttest.wgt' : pub ? 'Settle-' + version + '.wgt' : 'settle.wgt');
writeFileSync(out, Buffer.concat([...parts, cd, end]));

const js = names.filter((n) => n.endsWith('.js')).reduce((s, n) => s + files.get(n).length, 0);
// The budget counts what loads at start (the <script> tags in index.html); Diagnostics, the Control Center and the
// trailer cast load on first use.
const bootNames = fonttest ? [] : [...files.get('index.html').toString('utf8').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((n) => files.has(n));
const bootJs = bootNames.reduce((s, n) => s + files.get(n).length, 0);
console.log(`${relative(root, out)}  ${(statSync(out).size / 1024).toFixed(0)} KB, ${names.length} files, JS ${(bootJs / 1024).toFixed(1)} KB at start + ${((js - bootJs) / 1024).toFixed(1)} KB on demand${rawJs && rawJs !== js ? ' (source ' + (rawJs / 1024).toFixed(1) + ' KB)' : ''}, CSS ${(minCss / 1024).toFixed(1)} KB (source ${(rawCss / 1024).toFixed(1)} KB)`);
if (pub) console.log('Public build: no keys inside. Apps2Samsung writes each user\'s own into it on install (packaging/apps2samsung).');
else if (!fonttest && files.get('js/config.local.js').toString().includes('keys')) {
  console.log('NOTE: this package contains the API keys from js/config.local.js. Keep the .wgt private.');
}
