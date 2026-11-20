// Interactive setup: asks for your API keys and TV details and writes src/js/config.local.js (gitignored).
//   npm run setup
// Run it again any time: what you entered before is offered as the default (press Enter to keep it).
// Nothing is sent anywhere; the file stays on this computer and is packed into the .wgt you build.
import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { stdin, stdout } from 'node:process';

const root = resolve(import.meta.dirname, '..');
const target = join(root, 'src', 'js', 'config.local.js');

// What is there already (the file is plain JS that sets window.LAUNCHER_LOCAL).
let old = {};
if (existsSync(target)) {
  try { const w = {}; runInNewContext(readFileSync(target, 'utf8'), { window: w }); old = w.LAUNCHER_LOCAL || {}; }
  catch { console.log('Could not read the existing config.local.js; starting from blank values.'); }
}
const ok = old.keys || {}, occ = old.controlCenter || {}, owx = old.weather || {};

// This computer's LAN address, for the Diagnostics log receiver.
const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(i.address));

// Lines are queued as they arrive, so answers piped in (or typed ahead) are never lost.
const rl = createInterface({ input: stdin, terminal: false });
const lines = [], waiting = [];
let ended = false;
rl.on('line', (l) => { if (waiting.length) waiting.shift()(l); else lines.push(l); });
rl.on('close', () => { ended = true; while (waiting.length) waiting.shift()(''); });
function nextLine() { return lines.length ? Promise.resolve(lines.shift()) : ended ? Promise.resolve('') : new Promise((r) => waiting.push(r)); }
async function ask(q, def, help) {
  if (help) console.log('\n  ' + help.split('\n').join('\n  '));
  const shown = def ? (/key|secret|id/i.test(q) && def.length > 8 ? def.slice(0, 4) + '…' : def) : '';
  stdout.write(`${q}${shown ? ` [${shown}]` : ''}: `);
  const a = (await nextLine()).trim();
  return a === '-' ? '' : (a || def || '');
}

console.log(`
Settle setup
============
Press Enter to keep the value in brackets, type - to clear it. Every key is optional:
Settle works without them and simply leaves that feature out.`);

const tmdb = await ask('TMDB API key (v3)', ok.tmdb,
  'Recommendations, posters, where to watch. Free: https://www.themoviedb.org/settings/api');
const traktClientId = await ask('Trakt client id', ok.traktClientId,
  'Personal picks, watchlist, "Watched", "Not interested". Free: https://trakt.tv/oauth/applications\n' +
  '(create an app; Redirect URI: urn:ietf:wg:oauth:2.0:oob)');
const traktClientSecret = traktClientId ? await ask('Trakt client secret (optional)', ok.traktClientSecret, 'Only if your Trakt app has one; device login works without it.') : '';
const omdb = await ask('OMDb API key', ok.omdb,
  'IMDb ratings in the movie panel. Free: https://www.omdbapi.com/apikey.aspx (activate it from the email first)');
const unsplash = await ask('Unsplash access key', ok.unsplash,
  'A new wallpaper every day. Free: https://unsplash.com/developers (without it a bundled wallpaper is used)');

const region = await ask('Region (2-letter country code)', old.region || 'IN', 'Where-to-watch data and age ratings follow this country.');
const locale = await ask('Locale (date format)', old.locale || 'en-GB');

const vetroHost = await ask('TV LAN address, for Vetro (optional)', occ.vetroHost,
  'The Control Center (picture, sound, inputs, Bluetooth) talks to Vetro on the TV. Some TVs refuse\n' +
  "loopback to apps, so enter the TV's own address (TV: Settings > General > Network > Network Status).");
const logUrl = await ask('Diagnostics log receiver (optional)', occ.logUrl || (lan ? `http://${lan.address}:8787/` : ''),
  'Diagnostics (Yellow key) > OK sends a report here. Start the receiver with: npm run logs');

const pin = await ask('Pin a weather location? (y/N)', owx.latitude != null ? 'y' : 'n');
let weather = null;
if (/^y/i.test(pin)) {
  const latitude = +(await ask('  Latitude', owx.latitude != null ? String(owx.latitude) : ''));
  const longitude = +(await ask('  Longitude', owx.longitude != null ? String(owx.longitude) : ''));
  const label = await ask('  Label shown on screen', owx.label || '');
  if (isFinite(latitude) && isFinite(longitude)) weather = { latitude, longitude, label };
}
rl.close();

const out = { ...old };                                          // anything else you added by hand is kept
out.keys = { ...ok, tmdb, traktClientId, traktClientSecret, omdb, unsplash };
for (const k of Object.keys(out.keys)) if (!out.keys[k]) delete out.keys[k];
out.region = region; out.locale = locale;
out.controlCenter = { ...occ, vetroHost, logUrl };
if (weather) out.weather = weather; else delete out.weather;

writeFileSync(target, `/* Local overrides + secrets. Gitignored: never commit this file. Written by npm run setup. */
window.LAUNCHER_LOCAL = ${JSON.stringify(out, null, 2)};
`);
console.log(`
Saved ${target}

Next:
  npm run preview     try it in a desktop browser (http://localhost:8080)
  npm run build       make dist/Settle-<version>-local.wgt, then install it with Apps2Samsung (see docs/SETUP.md)
The .wgt contains these keys: keep it private.`);
