// Launch assets and the numbers behind them, captured from the TV through Vetro. Run it from a computer on the TV's network.
//
//   node scripts/launch-kit.mjs probe                     one test frame: capture time, size, resolution, transparency, free space
//   node scripts/launch-kit.mjs still <name>              the screen as it is now -> still-<name>.png (navigate with the remote first)
//   node scripts/launch-kit.mjs hero [--seconds 16] [--keys "Right@2,Right@5.5,Right@9,Right@12.5"]
//                                                         a burst of frames while the script presses the keys (seconds from the
//                                                         start); -> hero.mp4, hero.gif and the measured frame rate
//   node scripts/launch-kit.mjs claims [--samples 6] [--write-test]
//                                                         every launch-post number, measured, with the exact command and its raw output
//   all take [--host <tv-ip>] (default: vetroHost in src/js/config.local.js) and [--chunk <bytes>] (transfer chunk, 262144)
//
// Output goes to captures/launch/ (gitignored: the claims report holds device details).
// Frames: enlightenment_info -dump_screen on the TV, read back as hex (dd | od), checked with sha256sum on both ends, then
// composited onto black (the dump has an alpha channel; transparent areas are A=0). Vetro mangles backslashes, so no TV
// command contains one, and /exec stops at ~30 s, so the burst runs in the background on the TV and is collected afterwards.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const host = opt('--host', localHost());
let CHUNK = +opt('--chunk', 262144);
const OUT = join(root, 'captures', 'launch');
const TVDIR = '/tmp/settle-kit';
const AVOC = 'busctl --system call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl';
const SETTLE = 'SettleTv01.Settle', ART = 'org.tizen.art-app';
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!['probe', 'still', 'hero', 'claims'].includes(cmd)) { console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 11).join('\n')); process.exit(1); }
if (!host) { console.error('No TV address: set vetroHost in src/js/config.local.js (npm run setup) or pass --host <tv-ip>'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

function localHost() {
  try { const m = /vetroHost\s*:\s*'([0-9.]+)'/.exec(readFileSync(join(root, 'src', 'js', 'config.local.js'), 'utf8')); return m && m[1]; } catch { return null; }
}

/* ---------- Vetro ---------- */
async function tv(c, ms = 28000) {
  if (c.includes('\\')) throw new Error('TV command contains a backslash (Vetro mangles them): ' + c);
  const r = await fetch('http://' + host + ':8099/exec', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ cmd: c }), signal: AbortSignal.timeout(ms) });
  if (r.status === 401) throw new Error('Vetro answered 401: this computer is not paired with Vetro');
  const j = await r.json();
  return { out: String(j.output || ''), err: String(j.stderr || ''), exit: j.exit_code };
}
const uptime = (s) => parseFloat(String(s).trim().split(/\s+/)[0]);

/* ---------- file transfer: hex over /exec, verified ---------- */
const sha = (b) => createHash('sha256').update(b).digest('hex');
async function pull(remote, local) {
  const m = await tv(`wc -c < ${remote}; sha256sum ${remote}`);
  const [sizeLine, shaLine] = m.out.trim().split('\n');
  const size = parseInt(sizeLine, 10), want = (shaLine || '').split(/\s+/)[0];
  if (!(size > 0) || !/^[0-9a-f]{64}$/.test(want)) throw new Error(`cannot read ${remote} on the TV: ${m.out} ${m.err}`);
  const parts = [];
  for (let off = 0; off < size;) {
    const n = Math.min(CHUNK, size - off);
    if (off % CHUNK) throw new Error('chunk misaligned');               // dd skip= counts in blocks of CHUNK
    let buf = null;
    for (let tries = 0; tries < 4 && !buf; tries++) {
      try {
        const r = await tv(`dd if=${remote} bs=${CHUNK} skip=${off / CHUNK} count=1 2>/dev/null | od -An -tx1 -v`);
        const b = Buffer.from(r.out.replace(/[^0-9a-f]/g, ''), 'hex');
        if (b.length === n) buf = b;
        else if (tries === 1 && CHUNK > 32768 && off === 0) { CHUNK /= 2; console.log(`  short read (${b.length}/${n} bytes): chunk now ${CHUNK}`); break; }
      } catch (e) { if (tries === 3) throw e; }
    }
    if (!buf) { if (off === 0 && parts.length === 0) return pull(remote, local); throw new Error(`chunk at ${off} of ${remote} kept arriving short`); }
    parts.push(buf); off += n;
  }
  const data = Buffer.concat(parts), got = sha(data);
  if (got !== want) throw new Error(`sha256 mismatch for ${remote}: TV ${want}, here ${got}`);
  writeFileSync(local, data);
  return { size, sha256: got };
}

/* ---------- images ---------- */
function probeImg(file) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
  let clear = 0; for (let i = 3; i < raw.length; i += 4) if (raw[i] === 0) clear++;
  return { w, h, transparentPct: +(100 * clear / (w * h)).toFixed(1) };
}
function onBlack(src, dst, w, h) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-filter_complex', `color=c=black:s=${w}x${h}[bg];[bg][0:v]overlay=shortest=1,format=rgb24`, '-frames:v', '1', dst]);
}
async function dumpOne(name) {                      // one frame on the TV; returns its path there and how long the dump took
  const r = await tv(`mkdir -p ${TVDIR}; rm -f ${TVDIR}/${name}.png; a=$(cut -d' ' -f1 /proc/uptime); enlightenment_info -dump_screen -p ${TVDIR}/ -n ${name}.png >/dev/null 2>&1; b=$(cut -d' ' -f1 /proc/uptime); echo "$a $b"; ls ${TVDIR}/${name}.png`);
  const [a, b] = r.out.trim().split('\n')[0].split(' ').map(Number);
  if (!/\.png/.test(r.out)) throw new Error('enlightenment_info wrote no file: ' + r.out + r.err);
  return { remote: `${TVDIR}/${name}.png`, dumpS: +(b - a).toFixed(3) };
}

/* ---------- probe / still ---------- */
async function probe() {
  const t0 = Date.now(); const info = await tv('uname -a; cut -d" " -f1 /proc/uptime; df -k /tmp | tail -n 1'); const rtt = Date.now() - t0;
  console.log(info.out.trim(), `\nround trip ${rtt} ms`);
  const d = await dumpOne('probe'); const t1 = Date.now(); const p = await pull(d.remote, join(OUT, 'probe-raw.png')); const pullS = (Date.now() - t1) / 1000;
  const img = probeImg(join(OUT, 'probe-raw.png')); onBlack(join(OUT, 'probe-raw.png'), join(OUT, 'probe.png'), img.w, img.h);
  console.log(`dump took ${d.dumpS} s on the TV -> at most ~${(1 / d.dumpS).toFixed(1)} frames/s in a burst`);
  console.log(`frame ${img.w}x${img.h}, ${(p.size / 1048576).toFixed(2)} MiB, ${img.transparentPct}% of pixels A=0; transfer ${pullS.toFixed(1)} s (sha256 verified)`);
  await tv(`rm -rf ${TVDIR}`);
}
async function still(name) {
  if (!/^[a-z0-9-]+$/i.test(name || '')) throw new Error('still needs a name: letters, digits, dashes');
  const d = await dumpOne('still'); const raw = join(OUT, `still-${name}-raw.png`), png = join(OUT, `still-${name}.png`);
  const p = await pull(d.remote, raw); const img = probeImg(raw); onBlack(raw, png, img.w, img.h);
  await tv(`rm -rf ${TVDIR}`);
  console.log(`${png}  ${img.w}x${img.h}, sha256 ${p.sha256.slice(0, 16)}… verified, ${img.transparentPct}% transparent before compositing`);
}

/* ---------- hero burst ---------- */
async function hero() {
  const secs = +opt('--seconds', 16);
  const keys = opt('--keys', 'Right@2,Right@5.5,Right@9,Right@12.5').split(',').map((s) => { const [k, t] = s.split('@'); if (!/^[A-Za-z0-9_]+$/.test(k)) throw new Error('bad key ' + k); return { k, t: +t }; });
  const dir = join(OUT, 'hero-' + stamp()), fr = join(dir, 'frames'); mkdirSync(fr, { recursive: true });
  const B = `${TVDIR}/burst`;
  const free = parseInt((await tv(`mkdir -p ${TVDIR}; df -k ${TVDIR} | tail -n 1 | awk '{print $4}'`)).out, 10);
  const test = await dumpOne('size'); const sz = parseInt((await tv(`wc -c < ${test.remote}`)).out, 10);
  const max = Math.max(5, Math.floor((free * 1024 * 0.6) / sz));             // keep 40% of /tmp free
  console.log(`one frame ${(sz / 1048576).toFixed(2)} MiB, dump ${test.dumpS} s; /tmp has room for ${max} frames`);
  console.log('Focus the first dock provider on the TV now. Starting in 3 s…'); await sleep(3000);
  const start = await tv(`rm -rf ${B}; mkdir -p ${B}; (i=0; end=$(( $(cut -d. -f1 /proc/uptime) + ${Math.ceil(secs)} )); while [ $(cut -d. -f1 /proc/uptime) -lt $end ] && [ $i -lt ${max} ]; do i=$((i+1)); n=$(printf %04d $i); a=$(cut -d' ' -f1 /proc/uptime); enlightenment_info -dump_screen -p ${B}/ -n f$n.png >/dev/null 2>&1; echo "$n $a $(cut -d' ' -f1 /proc/uptime)" >> ${B}/log; done; echo done >> ${B}/log) </dev/null >/dev/null 2>&1 & cut -d' ' -f1 /proc/uptime`);
  const tv0 = uptime(start.out), t0 = Date.now(), pressed = [];
  for (const { k, t } of keys) {
    const wait = t * 1000 - (Date.now() - t0); if (wait > 0) await sleep(wait);
    const r = await tv(`input_keyevent ${k} >/dev/null 2>&1; cut -d' ' -f1 /proc/uptime`); pressed.push({ k, at: +(uptime(r.out) - tv0).toFixed(2) });
    console.log(`  ${k} at ${pressed.at(-1).at} s`);
  }
  for (let i = 0; i < 120; i++) { const r = await tv(`tail -n 1 ${B}/log 2>/dev/null`); if (r.out.trim() === 'done') break; await sleep(1000); }
  const log = (await tv(`grep -v done ${B}/log`)).out.trim().split('\n').filter(Boolean).map((l) => { const [n, a, b] = l.split(' '); return { n, t: (+a + +b) / 2 - tv0, dump: +b - +a }; });
  console.log(`${log.length} frames captured; pulling them (sha256-checked)…`);
  let w, h;
  for (const [i, f] of log.entries()) {
    const raw = join(fr, `raw-${f.n}.png`); f.sha = (await pull(`${B}/f${f.n}.png`, raw)).sha256;
    if (!w) ({ w, h } = probeImg(raw)); onBlack(raw, join(fr, `f${f.n}.png`), w, h);
    process.stdout.write(`\r  ${i + 1}/${log.length}`);
  }
  console.log(); await tv(`rm -rf ${TVDIR}`);
  // Each frame is shown for the real time until the next one, so the clip plays back at the TV's own speed.
  const list = log.map((f, i) => `file 'frames/f${f.n}.png'\nduration ${((log[i + 1] ? log[i + 1].t : f.t + f.dump) - f.t).toFixed(3)}`).join('\n') + `\nfile 'frames/f${log.at(-1).n}.png'\n`;
  writeFileSync(join(dir, 'frames.txt'), list);
  const cat = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt')];
  execFileSync('ffmpeg', [...cat, '-vf', 'scale=1920:-2:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', join(dir, 'hero.mp4')]);
  execFileSync('ffmpeg', [...cat, '-vf', 'fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a', '-loop', '0', join(dir, 'hero.gif')]);
  const gaps = log.slice(1).map((f, i) => f.t - log[i].t).sort((a, b) => a - b);
  const span = log.at(-1).t - log[0].t, fps = (log.length - 1) / span, dupes = log.length - new Set(log.map((f) => f.sha)).size;
  const verdict = fps >= 24 ? 'smooth' : fps >= 10 ? 'watchable, but motion (focus slide, row fade) visibly steps' : 'a slideshow: film the panel instead';
  const rep = [`hero burst ${new Date().toISOString()} (host ${host})`, `frames ${log.length} over ${span.toFixed(2)} s = ${fps.toFixed(2)} frames/s (${verdict})`,
    `gap between frames: median ${gaps[gaps.length >> 1]?.toFixed(3)} s, worst ${gaps.at(-1)?.toFixed(3)} s; dump time median ${log.map((f) => f.dump).sort((a, b) => a - b)[log.length >> 1].toFixed(3)} s`,
    `identical consecutive-or-not frames (same sha256): ${dupes}`, `frame size ${w}x${h}`, `keys (s from burst start, TV clock): ${pressed.map((p) => p.k + '@' + p.at).join(', ')}`,
    'note: the capture loop shares the CPU with Settle, so rows may resolve a little slower in the clip than without it.'].join('\n');
  writeFileSync(join(dir, 'report.txt'), rep + '\n'); console.log(rep, `\n-> ${dir}/hero.mp4, hero.gif`);
}

/* ---------- claims ---------- */
const procTable = (out) => {                     // grep over /proc/*/status -> { pid: {Name, PPid, Threads, VmRSS, ...} }
  const t = {};
  for (const l of out.split('\n')) { const m = /^\/proc\/(\d+)\/status:(\w+):\s*(\S+)/.exec(l); if (m) (t[m[1]] ||= {})[m[2]] = isNaN(+m[3]) ? m[3] : +m[3]; }
  return t;
};
const STATUS = "grep -E '^(Name|PPid|Threads|VmRSS|RssAnon|RssFile|RssShmem|VmSwap):' /proc/[0-9]*/status 2>/dev/null";
const mib = (kb) => (kb / 1024).toFixed(1);
function family(table, rootPid, cmdlineHits) {    // the app's pid, everything below it, and anything whose command line names it
  const set = new Set([String(rootPid), ...cmdlineHits].filter((p) => table[p]));
  for (let grew = true; grew;) { grew = false; for (const [p, s] of Object.entries(table)) if (!set.has(p) && set.has(String(s.PPid))) { set.add(p); grew = true; } }
  return [...set];
}
async function appMemory(appId, pkg, running, samples) {
  const pid = running[appId];
  if (!pid) return { present: false };
  const hits = (await tv(`grep -l ${pkg} /proc/[0-9]*/cmdline 2>/dev/null; true`)).out.split('\n').map((l) => (/^\/proc\/(\d+)/.exec(l) || [])[1]).filter(Boolean);
  const runs = [];
  let pids = [];
  for (let i = 0; i < samples; i++) {
    const table = procTable((await tv(STATUS)).out); pids = family(table, pid, hits);
    runs.push({ rss: pids.reduce((s, p) => s + (table[p].VmRSS || 0), 0), swap: pids.reduce((s, p) => s + (table[p].VmSwap || 0), 0), threads: pids.reduce((s, p) => s + (table[p].Threads || 0), 0), table });
    if (i < samples - 1) await sleep(5000);
  }
  const pss = (await tv(`grep -H -E '^(Pss|SwapPss):' ${pids.map((p) => `/proc/${p}/smaps_rollup`).join(' ')} 2>/dev/null; true`)).out;
  const pssKb = [...pss.matchAll(/:Pss:\s+(\d+)/g)].reduce((s, m) => s + +m[1], 0);
  const age = (await tv(`H=$(getconf CLK_TCK 2>/dev/null || echo 250); U=$(cut -d' ' -f1 /proc/uptime); echo "$H $U $(sed 's/.*) //' /proc/${pid}/stat | cut -d' ' -f20)"`)).out.trim().split(' ').map(Number);
  const last = runs.at(-1).table, srt = (k) => runs.map((r) => r[k]).sort((a, b) => a - b);
  return { present: true, pid, pids: pids.map((p) => `${p} ${last[p].Name} threads=${last[p].Threads} VmRSS=${mib(last[p].VmRSS || 0)}MiB VmSwap=${mib(last[p].VmSwap || 0)}MiB RssAnon=${mib(last[p].RssAnon || 0)} RssFile=${mib(last[p].RssFile || 0)} RssShmem=${mib(last[p].RssShmem || 0)}`),
    rss: srt('rss'), swap: srt('swap'), threads: srt('threads'), pssKb, ageS: age[1] - age[2] / age[0], uptimeS: age[1], pssRaw: pss };
}
async function claims() {
  const samples = +opt('--samples', 6), md = [`# Settle launch claims, measured ${new Date().toISOString()}`, '', `TV ${host}, through Vetro /exec. Every number below comes from the command printed with it. MiB = 1024² bytes; GB = 10⁹ bytes.`, ''];
  const sec = (title, verdict, command, raw) => md.push(`## ${title}`, '', verdict, '', '```sh', command, '```', '', '<details><summary>raw output</summary>', '', '```', raw.trim(), '```', '</details>', '');
  const run = async (c) => { const r = await tv(c); return r.out + (r.err ? '\n[stderr] ' + r.err : ''); };

  let c = "grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo; cat /proc/swaps; cut -d' ' -f1 /proc/uptime";
  let o = await run(c); const kb = (k) => +(new RegExp('^' + k + ':\\s+(\\d+)', 'm').exec(o) || [])[1];
  const up = +o.trim().split('\n').at(-1), upH = (up / 3600).toFixed(1);
  const memT = kb('MemTotal'), swT = kb('SwapTotal'), swF = kb('SwapFree'), swPct = swT ? 100 * (swT - swF) / swT : NaN;
  sec('Total RAM', `MemTotal ${memT} kB = **${(memT / 1048576).toFixed(2)} GiB** = ${(memT * 1024 / 1e9).toFixed(2)} GB. "1.74 GB" is ${Math.abs(memT / 1048576 - 1.74) < 0.006 ? 'right if you mean GiB (binary)' : Math.abs(memT * 1024 / 1e9 - 1.74) < 0.006 ? 'right in decimal GB' : '**not what this TV reports**'}. MemTotal is what Linux can use, a little under the installed chip size (the kernel and firmware reserve the rest).`, c, o);
  sec('Swap', !swT ? '**No swap is configured** (SwapTotal 0).' : `Swap ${mib(swT - swF)} / ${mib(swT)} MiB used = **${swPct.toFixed(0)}%** at uptime ${upH} h (one sample; type and device in /proc/swaps). ${swPct >= 90 ? 'Near full: the claim holds at this moment.' : 'Not near full right now.'} To claim "in normal use", repeat at several times of day, or use the swap_free_mb column of npm run tvmon.`, c, o);

  c = 'app_launcher -S 2>&1; cut -d" " -f1 /proc/uptime'; o = await run(c);
  const running = {}; for (const l of o.split('\n')) { const m = /^\s*(\S+)\s+\((\d+)\)/.exec(l); if (m) running[m[1]] = +m[2]; }
  const n = Object.keys(running).length;
  sec('Apps running', `**${n} apps** in app_launcher -S at uptime ${upH} h. ${up >= 20 * 3600 ? '' : '**The TV has not been on for a day yet**, so this is not the "after a day" figure: run it again later. '}(Counted: lines of the form "app.id (pid)".)`, c, o);

  c = `${STATUS}   # x${samples}, 5 s apart, summed over the app's process tree; then grep Pss /proc/<pids>/smaps_rollup`;
  const s = await appMemory(SETTLE, 'SettleTv01', running, samples);
  sec('Settle idle', s.present ? `pid ${s.pid}, ${s.pids.length} process(es). VmRSS **${mib(s.rss[s.rss.length >> 1])} MiB** median (range ${mib(s.rss[0])}–${mib(s.rss.at(-1))}), threads **${s.threads[s.threads.length >> 1]}**, swapped out ${mib(s.swap.at(-1))} MiB, Pss ${s.pssKb ? mib(s.pssKb) + ' MiB' : 'not available'}. Valid as "idle" only if Settle was on screen at Home and untouched during the ${samples * 5 - 5} s of sampling.\n\n${s.pids.map((p) => '- ' + p).join('\n')}` : '**Settle is not running**: open it, leave it at Home, run again.', c, s.pssRaw || '');

  const aplId = Object.keys(running).find((id) => /apl/i.test(id));
  if (aplId) { const a = await appMemory(aplId, aplId.split('.')[0], running, samples); sec('APL Launcher', `${aplId}: VmRSS **${mib(a.rss[a.rss.length >> 1])} MiB** median, threads ${a.threads[a.threads.length >> 1]}.\n\n${a.pids.map((p) => '- ' + p).join('\n')}`, c, a.pssRaw); }
  else sec('APL Launcher', '**Cannot be measured on this TV now**: no app id containing "apl" is running. The ~123 MB figure can only be stated as measured if APL is reinstalled and measured the same way as Settle above; otherwise attribute it to where it came from, or drop it.', 'app_launcher -S', o);

  const art = await appMemory(ART, ART, running, Math.min(samples, 3));
  sec('Art app', art.present ? `pid ${art.pid}: VmRSS **${mib(art.rss.at(-1))} MiB** + ${mib(art.swap.at(-1))} MiB swapped out, alive **${(art.ageS / 3600).toFixed(1)} h** of the TV's ${(art.uptimeS / 3600).toFixed(1)} h uptime. ${art.ageS > art.uptimeS - 600 ? 'Started at boot and still resident.' : 'Started after boot (was Art mode opened?).'} "Permanently" is supported only if this also holds after a fresh reboot without opening Art mode.\n\n${art.pids.map((p) => '- ' + p).join('\n')}` : `**${ART} is not running** right now, so "holds it permanently" does not hold at this moment.`, `${STATUS}; sed 's/.*) //' /proc/<pid>/stat | cut -d' ' -f20   # start time in ticks`, art.pssRaw || '');

  // The avoc methods: read from Settle's own source, so the list is what the Control Center calls, not a copy of it.
  const src = readFileSync(join(root, 'src', 'js', 'vetro.js'), 'utf8');
  const used = [...new Set([...src.matchAll(/'((?:Get|Set)[A-Z]\w*)[ ']/g)].map((m) => m[1]))];
  const rows = [...src.matchAll(/^\s*'([\w.]+)':\s*\{\s*label: '([^']+)', kind: 'slider', min: (\d+), max: (\d+), step: (\d+), get: '([^']+)', set: function \(v\) \{ return '([^']+)' \+ v \+ '([^']*)'/gm)]
    .map((m) => ({ id: m[1], label: m[2], min: +m[3], max: +m[4], step: +m[5], get: m[6], set: (v) => m[7] + v + m[8] }));
  c = `busctl --system introspect org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl`; o = await run(c + ' 2>&1');
  const offered = new Set([...o.matchAll(/^\.(\w+)\s+method/gm)].map((m) => m[1]));
  const getters = [...src.matchAll(/get: '((?:Get)[^']+)'/g)].map((m) => m[1]).filter((g, i, a) => a.indexOf(g) === i);
  const gc = getters.map((g) => `echo "${g.split(' ')[0]}: $(${AVOC} ${g} 2>&1)"`).join('; ');
  const go = await run(gc);
  const ans = getters.map((g) => { const name = g.split(' ')[0]; const m = new RegExp('^' + name + ': \\S+ (-?\\d+) (\\d+)', 'm').exec(go); return { name, ok: !!m && m[2] === '0', v: m && m[1] }; });
  sec('Control Center over org.tizen.tv.avoc', `Settle's source (src/js/vetro.js) calls **${used.length} methods** on org.tizen.tv.avoc.AvOutputControl: ${used.join(', ')}. The service on this TV lists ${offered.size} methods; ${used.filter((u) => offered.has(u)).length} of Settle's are among them${used.some((u) => !offered.has(u)) && offered.size ? ' (missing: ' + used.filter((u) => !offered.has(u)).join(', ') + ')' : ''}. Getters answering with status 0 now: **${ans.filter((a) => a.ok).length}/${ans.length}** (${ans.map((a) => a.name + (a.ok ? '=' + a.v : ' FAILED')).join(', ')}). Bluetooth in the Control Center uses a different service (com.samsung.tv.bt.connectionmanager), not avoc.`, c + '\n' + gc, o + '\n' + go);

  if (flag('--write-test')) {                    // change each slider by one step, read it back, put it back
    const lines = [];
    for (const r of rows) {
      const g = async () => +((new RegExp('\\S+ (-?\\d+) 0').exec(await run(`${AVOC} ${r.get} 2>&1`)) || [])[1]);
      const v0 = await g(); if (isNaN(v0)) { lines.push(`${r.label}: getter did not answer, skipped`); continue; }
      const v1 = v0 + r.step <= r.max ? v0 + r.step : v0 - r.step;
      try { await run(`${AVOC} ${r.set(v1)} 2>&1`); const back = await g(); lines.push(`${r.label}: ${v0} -> set ${v1} -> reads ${back} ${back === v1 ? 'OK' : 'NOT APPLIED'}`); }
      finally { await run(`${AVOC} ${r.set(v0)} 2>&1`); const after = await g(); lines.push(`  restored to ${v0}: reads ${after}${after === v0 ? '' : '  (CHECK THIS SETTING)'}`); }
    }
    sec('avoc write round trip', `Each slider set one step away and read back, then restored (${lines.filter((l) => l.endsWith('OK')).length}/${rows.length} applied):`, rows.map((r) => `${AVOC} ${r.set('<v>')}`).join('\n'), lines.join('\n'));
  }
  const file = join(OUT, `claims-${stamp()}.md`); writeFileSync(file, md.join('\n')); console.log(md.filter((l, i) => /^## /.test(l) || /^## /.test(md[i - 2] || '')).join('\n'), `\n-> ${file}`);
}

try { await ({ probe, still: () => still(args[1]), hero, claims })[cmd](); }
catch (e) { console.error('Failed:', e.message); if (/fetch failed|timeout|ECONN/i.test(e.message)) console.error(`Is the TV on and Vetro listening at ${host}:8099? Run this from a computer on the TV's network.`); process.exit(1); }
