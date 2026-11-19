// The browser demo for GitHub Pages: the preview (stand-in TV, apps and Vetro from src/js/mock.js) as a static site,
// with no keys of anyone's. Without a TMDB key the rows show the built-in sample titles, and without an Unsplash key
// the wallpaper is the bundled one. The weather is pinned to one city, so visitors' addresses are never looked up.
//   node scripts/build-demo.mjs   -> site/
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, relative, sep, dirname } from 'node:path';
import { joinApp } from './app-bundle.mjs';

const root = resolve(import.meta.dirname, '..'), src = join(root, 'src'), out = join(root, 'site');
const SKIP = new Set(['js/config.local.js', 'js/config.local.example.js', 'fonttest.html', 'brandsheet.html']);
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

const files = new Map();
for (const p of walk(src)) {
  const rel = relative(src, p).split(sep).join('/');
  if (SKIP.has(rel) || rel.startsWith('js/app/') || rel.split('/').some((s) => s.startsWith('.'))) continue;
  files.set(rel, readFileSync(p));
}
files.set('js/app.js', Buffer.from(joinApp(src)));
files.set('js/config.local.js', Buffer.from(`/* The web demo: no keys. Sample titles stand in for TMDB, the bundled wallpaper for Unsplash. */
window.LAUNCHER_LOCAL = { weather: { latitude: 51.51, longitude: -0.13, label: 'London' } };
`));
files.set('js/build-info.js', Buffer.from("window.SETTLE_BUILD = 'web demo " + new Date().toISOString().slice(0, 10) + "';\n"));
// A line under the screen saying how to drive it, outside the TV stage so the layout is the TV's.
const note = `<div id="demo-note" style="position:fixed;left:0;right:0;bottom:0;z-index:9;padding:6px 12px;font:14px/1.4 system-ui,sans-serif;color:#cfd3da;background:rgba(10,11,13,.82);text-align:center">
Settle web demo, with sample apps and titles. Arrow keys move, Enter is OK, Esc is Back, <b>c</b> opens the Control Center, <b>g</b> the app switcher.
<a href="https://github.com/SherrySingh03/settle" style="color:#F5C518">Get it for your Samsung TV</a></div>`;
files.set('index.html', Buffer.from(files.get('index.html').toString('utf8').replace('</body>', note + '\n</body>').replace(/<title>[^<]*<\/title>/, '<title>Settle web demo</title>')));

// Nothing private: no value from your own config.local.js, no private IPv4 address.
let mine = [];
try { mine = [...readFileSync(join(src, 'js', 'config.local.js'), 'utf8').matchAll(/['"]([^'"\s]{6,})['"]/g)].map((m) => m[1]); } catch { /* none */ }
const leaks = [];
for (const [name, buf] of files) {
  if (/\.(png|jpe?g|woff2?|gif|webp)$/.test(name)) continue;
  const text = buf.toString('utf8');
  for (const v of mine) if (text.includes(v)) leaks.push(name + ': a value from your config.local.js');
  for (const m of text.matchAll(/\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/g)) if (m[0].split('.').length === 4) leaks.push(name + ': ' + m[0].replace(/\.\d+$/, '.x'));
}
if (leaks.length) { console.error('Demo build stopped, this would be published:\n  ' + [...new Set(leaks)].join('\n  ')); process.exit(1); }

rmSync(out, { recursive: true, force: true });
for (const [name, buf] of files) { const p = join(out, ...name.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); }
writeFileSync(join(out, '.nojekyll'), '');
console.log(`site/  ${files.size} files: the web demo (no keys)`);
