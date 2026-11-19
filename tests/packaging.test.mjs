// The Apps2Samsung catalogue package (packaging/apps2samsung): Apps2Samsung writes each user's values into
// js/config.local.js with plain find/replace before installing, and the install fails if any "find" is missing.
// These tests do what it does, on the file exactly as the public build packs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'packaging/apps2samsung/SherrySingh03__settle.json'), 'utf8'));
const fields = manifest.user_settings.fields;

// One file out of a .wgt (zip): the central directory gives its offset, the local header its data.
function unzipOne(buf, name) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0, n = buf.readUInt16LE(end + 10); i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nlen) === name) {
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), data = buf.subarray(start, start + size);
      return method === 8 ? inflateRawSync(data) : data;
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}
let packed = null;
function packedConfig() {
  if (packed) return packed;
  execFileSync(process.execPath, ['scripts/build.mjs', '--public'], { cwd: root, stdio: 'ignore' });
  const version = readFileSync(resolve(root, 'src/config.xml'), 'utf8').match(/<widget[^>]*\sversion="([^"]+)"/)[1];
  packed = unzipOne(readFileSync(resolve(root, 'dist', `Settle-${version}.wgt`)), 'js/config.local.js').toString('utf8');
  return packed;
}
// What Apps2Samsung does: text values are escaped and put in place of {value}; an empty optional field is left as found.
function install(text, values) {
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined || v === '') { assert.ok(!f.required, f.key + ' is required'); continue; }
    if (f.pattern) assert.match(v, new RegExp(f.pattern), f.key);
    assert.ok(text.includes(f.find), 'missing find for ' + f.key + ': ' + f.find);
    text = text.replace(f.find, f.replace.replace('{value}', v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')));
  }
  const box = { window: {} };
  vm.runInNewContext(text, box);
  return box.window.LAUNCHER_LOCAL;
}

test('the manifest has what the catalogue requires', () => {
  for (const k of ['name', 'description', 'category', 'repo', 'source', 'branch']) assert.ok(manifest[k], k);
  assert.equal(manifest.category, 'home');
  assert.ok(!/[|\n]/.test(manifest.name + manifest.description), 'no | or newlines');
  assert.ok(manifest.assets.every((a) => new RegExp(a.match).test('Settle-1.0.0.wgt')), 'the asset pattern matches the public build');
  assert.equal(new Set(fields.map((f) => f.key)).size, fields.length, 'unique keys');
  for (const f of fields) assert.ok(f.replace.includes('{value}') && /^[a-z][a-z0-9_]*$/.test(f.key), f.key);
});

test('the public package carries the catalogue settings file unchanged, every find once', () => {
  const text = packedConfig();
  assert.equal(text.replace(/\r\n/g, '\n'), readFileSync(resolve(root, 'packaging/apps2samsung/config.local.js'), 'utf8').replace(/\r\n/g, '\n'));
  for (const f of fields) assert.equal(text.split(f.find).length - 1, 1, 'exactly one "' + f.find + '"');
});

test('an install with every value filled in gives Settle those values', () => {
  const L = install(packedConfig(), { region: 'GB', tmdb: 'abc123', trakt: 'def456', omdb: 'a1b2c3d4', unsplash: 'Xy_z-9', youtube: 'AIzaTest_-1', vetro_host: '192.0.2.7', youtube_screen: 'scr-1_x' });
  assert.equal(L.region, 'GB');
  assert.deepEqual({ ...L.keys }, { tmdb: 'abc123', traktClientId: 'def456', omdb: 'a1b2c3d4', unsplash: 'Xy_z-9', youtube: 'AIzaTest_-1' });
  assert.equal(L.controlCenter.vetroHost, '192.0.2.7');
  assert.equal(L.youtube.screenId, 'scr-1_x');
});

test('an install with only the country leaves every key empty, and the file still loads', () => {
  const L = install(packedConfig(), { region: 'US' });
  assert.equal(L.region, 'US');
  assert.ok(Object.values(L.keys).every((v) => v === ''));
});
