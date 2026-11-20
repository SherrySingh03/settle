// Smoke tests: the preview (scripts/serve.mjs, with the stand-in apps and Vetro from src/js/mock.js) driven with the
// remote's keys in a real browser. Every request off this machine is blocked, so the results don't depend on
// TMDB, Trakt or the weather; where a test needs rows or Trakt, it puts clearly fake test data in place.
//
//   npm test                         uses Microsoft Edge (installed on Windows)
//   SETTLE_BROWSER=chrome npm test   any Playwright channel: chrome, msedge, chromium
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const PORT = 8180 + Math.floor(Math.random() * 300);
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server, browser;

before(async () => {
  server = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(URL); break; } catch { await sleep(100); } }
  browser = await chromium.launch({ channel: process.env.SETTLE_BROWSER || 'msedge' });
});
after(async () => { await browser?.close(); server?.kill(); });

// A fresh page with everything outside localhost blocked. online: false also tells the page it is offline.
async function open({ online = true, init = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  if (init) await ctx.addInitScript(init);
  await ctx.route((u) => !/^http:\/\/localhost/.test(String(u)), (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (!online) await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await page.goto(URL);
  await page.waitForFunction(() => window.Settle && window.Settle.state.zone);
  await sleep(1200);
  const key = async (k, ms = 300) => { await page.keyboard.press(k); await sleep(ms); };
  const zone = () => page.evaluate(() => window.Settle.state.zone);
  const dom = () => page.evaluate(() => document.getElementsByTagName('*').length);
  return { page, ctx, key, zone, dom, errors };
}
// A made-up show for the Up next row: enough to move around in without any network.
const FAKE_SHOW = (n) => ({ id: 'tvtest' + n, tmdb: 900000 + n, type: 'tv', title: 'Test show ' + n, art: '', bg: '#333', provider: 'Netflix', streaming: true, trakt: 70 + n,
  next: { season: 1, number: 2, title: 'Test two', trakt: 7002 + n * 10, code: 'S1 E2' }, prov: 'S1 E2', meta: 'Next: S1 E2 · Test two', desc: 'Test.' });

test('starts on the dock with no errors and under 600 elements', async () => {
  const t = await open();
  assert.equal(await t.zone(), 'dock');
  assert.ok(await t.dom() < 600, 'elements at rest: ' + await t.dom());
  assert.deepEqual(t.errors, []);
  await t.ctx.close();
});

test('App switcher lists the open apps, the last one opened from Settle first', async () => {
  const t = await open();
  await t.page.evaluate(() => localStorage.setItem('settle.launchedat.v1', JSON.stringify({ 'mock.YouTube': 1000, 'mock.Spotify': 2000 })));
  await t.key('g', 1200);
  const cards = await t.page.evaluate(() => [...document.getElementById('sw-row').children].map((c) => c.textContent.trim()));
  assert.ok(cards.length >= 3, 'cards: ' + JSON.stringify(cards));
  assert.match(cards[0], /Spotify/);
  assert.match(cards[1], /YouTube/);
  assert.deepEqual(t.errors, []);
  await t.ctx.close();
});

test('Up twice opens Search; Back closes it', async () => {
  const t = await open();
  await t.key('ArrowUp', 500); assert.equal(await t.zone(), 'full');
  await t.key('ArrowUp', 600); assert.equal(await t.zone(), 'srch');
  await t.page.evaluate(() => document.getElementById('sr-in').blur());
  await t.key('Escape', 500); assert.equal(await t.zone(), 'dock');
  await t.ctx.close();
});

test('Search finds installed apps by name', async () => {
  const t = await open();
  await t.key('ArrowUp', 500); await t.key('ArrowUp', 600);
  await t.page.evaluate(() => { const i = document.getElementById('sr-in'); i.value = 'net'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(300);
  assert.ok(await t.page.evaluate(() => document.querySelectorAll('#sr-row .srapp').length) >= 1, 'an app result for "net"');
  await t.ctx.close();
});

test('Control Center: ten tiles, Settle page, under 600 elements', async () => {
  const t = await open();
  await t.key('c', 1200);
  assert.equal(await t.zone(), 'cc');
  const tiles = await t.page.evaluate(() => [...document.querySelectorAll('.cct .cl')].map((x) => x.textContent));
  assert.equal(tiles.length, 10, tiles.join(', '));
  assert.ok(tiles.includes('Settle') && tiles.includes('Performance'));
  assert.ok(await t.dom() < 600, 'elements with the panel open: ' + await t.dom());
  assert.ok(!(await t.page.evaluate(() => [...document.querySelectorAll('.cct .cv')].some((x) => x.textContent === '—'))), 'no bare dashes');
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']) await t.key(k, 120);
  await t.key('Enter', 700);
  const rowsOnPage = await t.page.evaluate(() => [...document.querySelectorAll('.cc-row .rl')].map((x) => x.textContent));
  assert.deepEqual(rowsOnPage, ['Screensaver', 'Wallpaper', 'Recommendations', 'Open in Nuvio', 'Back up to this PC', 'Restore from this PC', 'Diagnostics']);
  await t.ctx.close();
});

test('Performance mode asks first, and Cancel changes nothing', async () => {
  const t = await open();
  await t.page.evaluate(() => {
    window.__writes = [];
    const orig = window.MOCK.vetro;
    window.Vetro.setBackend(async (cmd) => {
      if (/echo (performance|interactive) > \S*scaling_governor/.test(cmd)) window.__writes.push(cmd);
      return orig(cmd);
    });
  });
  await t.key('c', 1200); await t.key('ArrowDown', 200); await t.key('Enter', 900);
  assert.equal(await t.zone(), 'ask');
  assert.equal(await t.page.evaluate(() => document.querySelector('#ask-row .btn.on').id), 'ask-no', 'Cancel is focused first');
  await t.key('Enter', 400);
  assert.deepEqual(await t.page.evaluate(() => window.__writes), []);
  await t.ctx.close();
});

test('rails: Down from the dock, OK opens details, Back returns', async () => {
  const t = await open();
  await t.page.evaluate((x) => window.Settle.setUpNext(x), [FAKE_SHOW(1), FAKE_SHOW(2)]);
  await t.key('ArrowDown', 800); assert.equal(await t.zone(), 'rail');
  await t.key('ArrowRight', 300);
  await t.key('Enter', 900); assert.equal(await t.zone(), 'dt');
  await t.key('Escape', 600); assert.equal(await t.zone(), 'rail');
  await t.ctx.close();
});

test('Up next: shown first, and marking an episode moves the card on', async () => {
  const t = await open();
  await t.page.evaluate(() => {
    window.__calls = [];
    window.Trakt.connected = () => true;
    window.Trakt.markEpisode = (id) => { window.__calls.push('mark ' + id); return Promise.resolve({}); };
    window.Trakt.nextEpisode = () => Promise.resolve({ season: 1, number: 3, title: 'Test three', trakt: 7003 });
  });
  await t.page.evaluate((x) => window.Settle.setUpNext(x), [FAKE_SHOW(0)]);
  await t.key('ArrowDown', 900);
  assert.equal(await t.page.evaluate(() => window.Settle.state.row), 3, 'Up next is the first row');
  await t.key('ArrowUp', 400);
  while (!/Mark S1 E2/.test(await t.page.evaluate(() => document.getElementById('a-cap').textContent))) {
    if ((await t.page.evaluate(() => window.Settle.state.ai)) > 6) break;
    await t.key('ArrowRight', 200);
  }
  await t.key('Enter', 800);
  assert.deepEqual(await t.page.evaluate(() => window.__calls), ['mark 7002']);
  assert.equal(await t.page.evaluate(() => window.Settle.upNext()[0].next.code), 'S1 E3');
  await t.ctx.close();
});

test('Up next refresh: no change leaves the cards alone and asks TMDB nothing', async () => {
  const t = await open();
  // Two shows saved on this TV, fetched an hour ago: the page starts with them
  await t.page.evaluate((x) => localStorage.setItem('settle.upnext.v1', JSON.stringify({ at: Date.now() - 3600e3, items: x })), [FAKE_SHOW(1), FAKE_SHOW(2)]);
  await t.page.reload();
  await t.page.waitForFunction(() => window.Settle && window.Settle.state.zone && document.querySelector('#rtrack4 .pcell'));
  await t.page.evaluate(() => {
    window.__items = 0;
    window.Trakt.connected = () => true;
    window.Recs.item = () => { window.__items++; return Promise.resolve(null); };
  });
  // The same two shows at the same episodes, as Trakt would answer
  await t.page.evaluate(() => {
    const now = window.Settle.upNext();
    window.Trakt.upNext = () => Promise.resolve(now.map((r) => ({ tmdb: r.tmdb, trakt: r.trakt, next: { season: r.next.season, number: r.next.number, title: r.next.title, trakt: r.next.trakt } })));
    document.querySelector('#rtrack4 .pcell').__mark = 1;
  });
  // The page's own refresh at start (1.5 s after load) may still be running: wait for it to finish first.
  await sleep(1800);
  await t.page.evaluate(() => window.Settle.refreshUpNext());
  await sleep(500);
  assert.equal(await t.page.evaluate(() => document.querySelector('#rtrack4 .pcell').__mark), 1, 'the Up next cards were not rebuilt');
  assert.equal(await t.page.evaluate(() => window.__items), 0, 'no TMDB calls for shows already known');
  // A show moves on an episode: the Up next row is rebuilt, nothing asked of TMDB for a known show
  await t.page.evaluate(() => {
    const f = window.Trakt.upNext;
    window.Trakt.upNext = () => f().then((l) => { l[0].next = { season: 1, number: 3, title: 'Test three', trakt: 9999 }; return l; });
  });
  await t.page.evaluate(() => window.Settle.refreshUpNext());
  await sleep(500);
  assert.equal(await t.page.evaluate(() => window.Settle.upNext()[0].next.code), 'S1 E3');
  assert.equal(await t.page.evaluate(() => document.querySelector('#rtrack4 .pcell').__mark), undefined, 'the Up next row was rebuilt');
  assert.deepEqual(t.errors, []);
  await t.ctx.close();
});

test('offline: no lone weather icon, a plain message, no Connect Trakt card', async () => {
  const t = await open({ online: false });
  assert.ok(await t.page.evaluate(() => document.getElementById('stage').classList.contains('no-wx')));
  assert.ok(await t.page.evaluate(() => document.getElementById('stage').classList.contains('offline')));
  assert.ok(!(await t.page.evaluate(() => window.Settle.rows()[0].some((r) => r.connect))));
  assert.match(await t.page.evaluate(() => document.getElementById('rempty').textContent), /No internet/);
  await t.ctx.close();
});

test('Sleep timer: In 30 minutes starts one; Cancel stops it', async () => {
  const t = await open();
  await t.page.evaluate(() => {
    window.__cmds = [];
    const orig = window.MOCK.vetro;
    window.Vetro.setBackend(async (cmd) => {
      window.__cmds.push(cmd);
      if (/XF86PowerOff\) .* & echo PID/.test(cmd)) return { ok: true, output: 'PID 4321\n' };
      if (/^kill 4321/.test(cmd)) return { ok: true, output: '' };
      return orig(cmd);
    });
  });
  await t.key('c', 1200); await t.key('Enter', 700);                 // Sleep: the list of choices
  await t.key('ArrowDown', 150); await t.key('Enter', 1200);          // In 30 minutes
  assert.ok(await t.page.evaluate(() => window.__cmds.some((c) => /^\(sleep 1800; /.test(c))), 'the timer command was sent');
  assert.match(await t.page.evaluate(() => document.querySelector('.cct-sleep .cv').textContent), /Turns off at|Turns off/);
  await t.key('Enter', 700);
  const opts = await t.page.evaluate(() => [...document.querySelectorAll('.cc-row .rl')].map((x) => x.textContent));
  assert.ok(opts.some((o) => /^Cancel the timer/.test(o)), opts.join(', '));
  for (let i = 0; i < opts.length - 1; i++) await t.key('ArrowDown', 100);
  await t.key('Enter', 1200);
  assert.ok(await t.page.evaluate(() => window.__cmds.some((c) => /^kill 4321/.test(c))), 'the timer was cancelled');
  assert.equal(await t.page.evaluate(() => localStorage.getItem('settle.sleep.v1')), null);
  await t.ctx.close();
});

test('Nuvio: Legacy first when both are installed, and a film or show gets its link', async () => {
  const t = await open();
  const logs = [];
  t.page.on('console', (m) => logs.push(m.text()));
  assert.equal(await t.page.evaluate(() => window.Platform.hasNuvio()), true);
  assert.equal(await t.page.evaluate(() => window.Platform.nuvioApp()), 'NuvioTV002.Nuvio');
  assert.equal(await t.page.evaluate(() => window.Platform.nuvioLink('movie', 603)), 'nuvio-legacy://meta/movie/603');
  assert.equal(await t.page.evaluate(() => window.Platform.nuvioLink('tv', 1399)), 'nuvio-legacy://meta/series/1399');
  await t.page.evaluate(() => window.Platform.launchNuvio('tv', 1399));
  assert.ok(logs.some((l) => l.includes('[nuvio] nuvio-legacy://meta/series/1399')), logs.join(' | '));
  const all = await t.page.evaluate(() => window.Platform.allInstalled().map((a) => a.label || a.name));
  assert.equal(all.filter((n) => n === 'Nuvio').length, 1, all.join(', '));
  assert.equal(all.filter((n) => n === 'Nuvio Legacy').length, 1, all.join(', '));
  assert.deepEqual(t.errors, []);
  await t.ctx.close();
});

test('All apps: Samsung\'s ArtApp is listed, though its id looks like a system part', async () => {
  const t = await open();
  const all = await t.page.evaluate(() => window.Platform.allInstalled().map((a) => a.id + ' ' + (a.label || a.name)));
  assert.ok(all.includes('org.tizen.art-app ArtApp'), all.join(', '));
  assert.deepEqual(t.errors, []);
  await t.ctx.close();
});

test('Nuvio: whichever one is installed, with its own link', async () => {
  const t = await open({ init: () => { window.__nuvio = 'official'; } });
  assert.equal(await t.page.evaluate(() => window.Platform.nuvioApp()), 'NuvioTV001.NuvioTV');
  assert.equal(await t.page.evaluate(() => window.Platform.nuvioLink('movie', 603)), 'nuvio://tmdb/movie/603');
  assert.equal(await t.page.evaluate(() => window.Platform.nuvioLink('tv', 1399)), 'nuvio://tmdb/series/1399');
  assert.deepEqual(t.errors, []);
  await t.ctx.close();
  const t2 = await open({ init: () => { window.__nuvio = 'legacy'; } });
  assert.equal(await t2.page.evaluate(() => window.Platform.nuvioApp()), 'NuvioTV002.Nuvio');
  assert.equal(await t2.page.evaluate(() => window.Platform.nuvioLink('movie', 603)), 'nuvio-legacy://meta/movie/603');
  await t2.ctx.close();
  const t3 = await open({ init: () => { window.__noNuvio = 1; } });
  assert.equal(await t3.page.evaluate(() => window.Platform.hasNuvio()), false);
  assert.equal(await t3.page.evaluate(() => window.Platform.nuvioApp()), null);
  await t3.ctx.close();
});

async function settlePage(t) {
  await t.key('c', 1200);
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']) await t.key(k, 120);
  await t.key('Enter', 700);
  return t.page.evaluate(() => [...document.querySelectorAll('.cc-row')].map((x) => [x.querySelector('.rl').textContent, x.querySelector('.rv').textContent]));
}

test('Open in Nuvio: off until turned on, and hidden without the app', async () => {
  const t = await open();
  let rows = await settlePage(t);
  const i = rows.findIndex((r) => r[0] === 'Open in Nuvio');
  assert.ok(i >= 0, JSON.stringify(rows));
  assert.equal(rows[i][1], 'Off');
  for (let k = 0; k < i; k++) await t.key('ArrowDown', 120);
  await t.key('Enter', 3200);
  rows = await t.page.evaluate(() => [...document.querySelectorAll('.cc-row')].map((x) => [x.querySelector('.rl').textContent, x.querySelector('.rv').textContent]));
  assert.equal(rows[i][1], 'On');
  assert.equal(await t.page.evaluate(() => localStorage.getItem('settle.nuvio.v1')), '1');
  let posted = null;
  await t.ctx.route('**/backup', (r) => { posted = r.request().postData(); r.fulfill({ status: 204 }); });
  await t.page.evaluate(() => { window.LAUNCHER_CONFIG.controlCenter.logUrl = 'http://localhost:1'; return window.LauncherControls.compose(window.Vetro.adapter).act('backup'); });
  assert.ok(posted && JSON.parse(posted).keys['settle.nuvio.v1'] === '1', String(posted));
  assert.deepEqual(t.errors, []);
  await t.ctx.close();

  const t2 = await open({ init: () => { window.__noNuvio = 1; } });
  assert.deepEqual((await settlePage(t2)).map((r) => r[0]), ['Screensaver', 'Wallpaper', 'Recommendations', 'Back up to this PC', 'Restore from this PC', 'Diagnostics']);
  await t2.ctx.close();
});

const NUVIO_ON = () => localStorage.setItem('settle.nuvio.v1', '1');
const shownLabels = (sel) => [...document.querySelectorAll(sel + ' .btn')].filter((b) => b.offsetParent && getComputedStyle(b).display !== 'none').map((b) => b.lastChild.textContent);
const FIRST_FILM = () => window.Settle.recs().find((r) => !r.connect);
async function seedFilms(t) { await t.page.evaluate(() => window.Settle.setRecs(window.MOCK.recs.map((r) => Object.assign({}, r)))); await sleep(300); }
async function toFirstFilm(t) {
  await t.key('ArrowDown', 800); assert.equal(await t.zone(), 'rail');
  const n = await t.page.evaluate(() => window.Settle.recs().findIndex((r) => !r.connect));
  for (let i = 0; i < n; i++) await t.key('ArrowRight', 300);
}
async function firstFilmDetails(t) {
  await toFirstFilm(t);
  await t.key('Enter', 900); assert.equal(await t.zone(), 'dt');
  return t.page.evaluate(shownLabels, '#dt-acts');
}
function consoleLog(t) { const logs = []; t.page.on('console', (m) => logs.push(m.text())); return logs; }

test('Nuvio off: Details unchanged', async () => {
  const t = await open();
  await seedFilms(t);
  const labels = await firstFilmDetails(t);
  assert.ok(!labels.some((l) => /Nuvio/.test(l)), labels.join(', '));
  assert.deepEqual(t.errors, []);
  await t.ctx.close();
});

test('Nuvio follows your service', async () => {
  const t = await open({ init: NUVIO_ON });
  await seedFilms(t);
  const logs = consoleLog(t);
  const r0 = await t.page.evaluate(FIRST_FILM);
  let labels = await firstFilmDetails(t);
  assert.equal(labels[0], 'Open in ' + r0.provider);
  assert.equal(labels[1], 'Open in Nuvio', labels.join(', '));
  assert.ok(!(await t.page.evaluate(() => document.getElementById('dt-tr').classList.contains('ic') || document.getElementById('dt-wl').classList.contains('ic'))), 'no icons with three buttons');
  await t.key('Escape', 600);
  await t.page.evaluate(() => {                       // the widest case: a second service and a trailer (five buttons)
    window.Settle.recs().find((x) => !x.connect).provider = 'JioHotstar';
    window.Recs = window.Recs || {};
    window.Recs.details = () => Promise.resolve({ like: [], trailer: 'abc', stream: [{ name: 'JioHotstar', onTv: true }, { name: 'Prime Video', onTv: true }], rent: [], directors: [], cast: [], genres: [], tagline: '', overview: '', released: '', language: '', runtime: '' });
  });
  await t.key('Enter', 900); assert.equal(await t.zone(), 'dt');
  labels = await t.page.evaluate(shownLabels, '#dt-acts');
  assert.equal(labels.length, 5, labels.join(', '));
  assert.equal(labels[2], 'Open in Nuvio', labels.join(', '));
  assert.ok(await t.dom() < 600, 'elements: ' + await t.dom());
  const fits = await t.page.evaluate(() => {
    // the widest case: a second service with a long name, and a trailer (five buttons)
    if (!document.getElementById('dt-tr').classList.contains('ic') || !document.getElementById('dt-wl').classList.contains('ic')) return 'Trailer and Watchlist not icons';
    const bs = [...document.querySelectorAll('#dt-acts .btn')].filter((b) => b.offsetParent);
    if (bs.length !== 5) return 'buttons: ' + bs.length;
    const p = document.getElementById('dt-panel').getBoundingClientRect();
    return bs.every((b) => Math.abs(b.getBoundingClientRect().top - bs[0].getBoundingClientRect().top) < 20) && bs[bs.length - 1].getBoundingClientRect().right <= p.right;
  });
  assert.equal(fits, true, 'the Details buttons fit on one line: ' + JSON.stringify(await t.page.evaluate(() => ({ p: document.getElementById('dt-panel').getBoundingClientRect().right, b: [...document.querySelectorAll('#dt-acts .btn')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return [b.id, r.top, r.right]; }) }))));
  await t.key('ArrowRight', 200); await t.key('ArrowRight', 200); await t.key('ArrowRight', 200);   // to Trailer: named in the hint
  assert.match(await t.page.evaluate(() => document.getElementById('dt-hint').textContent), /^Trailer · /);
  await t.key('ArrowLeft', 200); await t.key('Enter', 1200);                                         // Open in Nuvio
  assert.ok(logs.some((l) => l.includes('[nuvio] nuvio-legacy://meta/movie/' + r0.tmdb)), logs.join(' | '));
  assert.deepEqual(t.errors, []);
  await t.ctx.close();
});

test('main button falls back to Nuvio', async () => {
  const t = await open({ init: NUVIO_ON });
  await seedFilms(t);
  const logs = consoleLog(t);
  const r0 = await t.page.evaluate(() => { const r = window.Settle.recs().find((x) => !x.connect); r.streaming = false; return r; });
  await toFirstFilm(t);
  await t.key('ArrowUp', 400); assert.equal(await t.zone(), 'act');
  assert.equal(await t.page.evaluate(() => document.getElementById('a1').lastChild.textContent), 'Open in Nuvio');
  await t.key('Enter', 1200);
  assert.ok(logs.some((l) => l.includes('[nuvio] nuvio-legacy://meta/movie/' + r0.tmdb)), logs.join(' | '));
  assert.ok(!(await t.page.evaluate(() => /streaming here yet/.test(document.body.textContent))), 'no toast');
  await t.key('ArrowDown', 400); assert.equal(await t.zone(), 'rail');      // back to the same poster
  await t.key('Enter', 900); assert.equal(await t.zone(), 'dt');
  const labels = await t.page.evaluate(shownLabels, '#dt-acts');
  assert.equal(labels[0], 'Open in Nuvio');
  assert.equal(labels.filter((l) => l === 'Open in Nuvio').length, 1, labels.join(', '));
  assert.deepEqual(t.errors, []);
  await t.ctx.close();
});

test('no tmdb, no Nuvio', async () => {
  const t = await open({ init: NUVIO_ON });
  await seedFilms(t);
  const r0 = await t.page.evaluate(() => { const r = window.Settle.recs().find((x) => !x.connect); delete r.tmdb; return r; });
  const labels = await firstFilmDetails(t);
  assert.ok(!labels.some((l) => /Nuvio/.test(l)), labels.join(', '));
  assert.equal(labels[0], 'Open in ' + r0.provider);
  assert.deepEqual(t.errors, []);
  await t.ctx.close();
});

test('a service you don\'t have: the main button opens Nuvio; Nuvio uninstalled: no button', async () => {
  const t = await open({ init: NUVIO_ON });
  await seedFilms(t);
  await t.page.evaluate(() => { window.Settle.recs().find((x) => !x.connect).provider = 'Paramount Plus'; });
  let labels = await firstFilmDetails(t);
  assert.equal(labels[0], 'Open in Nuvio', labels.join(', '));
  await t.ctx.close();
  const t2 = await open({ init: () => { localStorage.setItem('settle.nuvio.v1', '1'); window.__noNuvio = 1; } });
  await seedFilms(t2);
  labels = await firstFilmDetails(t2);
  assert.ok(!labels.some((l) => /Nuvio/.test(l)), labels.join(', '));
  assert.deepEqual(t2.errors, []);
  await t2.ctx.close();
});

test('a title still loading has no Nuvio button yet', async () => {
  const t = await open({ init: NUVIO_ON });
  await seedFilms(t);
  await t.page.evaluate(() => { window.Settle.recs().find((x) => !x.connect).loading = true; });
  const labels = await firstFilmDetails(t);
  assert.ok(!labels.some((l) => /Nuvio/.test(l)), labels.join(', '));
  assert.deepEqual(t.errors, []);
  await t.ctx.close();
});

test('Nuvio off: Details keeps its text buttons, even when they are wide', async () => {
  const t = await open();
  await seedFilms(t);
  await t.page.evaluate(() => {
    window.Settle.recs().find((x) => !x.connect).provider = 'Amazon Prime Video';
    window.Recs = window.Recs || {};
    window.Recs.details = () => Promise.resolve({ like: [], trailer: 'abc', stream: [{ name: 'Amazon Prime Video', onTv: true }, { name: 'JioHotstar', onTv: true }], rent: [], directors: [], cast: [], genres: [], tagline: '', overview: '', released: '', language: '', runtime: '' });
  });
  const labels = await firstFilmDetails(t);
  assert.equal(labels.length, 4, labels.join(', '));
  assert.ok(!(await t.page.evaluate(() => document.getElementById('dt-tr').classList.contains('ic') || document.getElementById('dt-wl').classList.contains('ic'))), 'unchanged from before Nuvio');
  await t.ctx.close();
});

test('Open in Nuvio turned off is kept as off, so a restore can turn it off', async () => {
  const t = await open();
  await settlePage(t);
  const rows = await t.page.evaluate(() => [...document.querySelectorAll('.cc-row .rl')].map((x) => x.textContent));
  const i = rows.indexOf('Open in Nuvio');
  for (let k = 0; k < i; k++) await t.key('ArrowDown', 120);
  await t.key('Enter', 3200); await t.key('Enter', 3200);              // on, then off
  assert.equal(await t.page.evaluate(() => localStorage.getItem('settle.nuvio.v1')), '0');
  await t.ctx.close();
});
