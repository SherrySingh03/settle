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
async function open({ online = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
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
  assert.deepEqual(rowsOnPage, ['Screensaver', 'Wallpaper', 'Recommendations', 'Back up to this PC', 'Restore from this PC', 'Diagnostics']);
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
