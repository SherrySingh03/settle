// TV state during a streaming session, sampled from the PC through Vetro, for comparing against Moonlight's stats.
//
//   node scripts/tvmon.mjs <label> [--seconds N] [--host <tv-ip>]    sample once a second until Ctrl+C (or N s)
//   node scripts/tvmon.mjs compare <run dir> <run dir> ...                  the runs' summaries side by side
//
// Each run goes to captures/tvmon/<time>-<label>/ (captures/ is gitignored):
//   start.txt, end.txt   once: running apps, dmesg tail and OOM lines, picture mode / Game Mode (avoc), CPU policy,
//                        Wi-Fi link
//   samples.csv          once a second, one Vetro call per sample (Vetro's /exec stops at ~30 s, so no loop on the TV)
//   summary.txt          per column: min, average, 95th percentile, max; plus what changed between start and end
//
// Every command is read-only (/proc, /sys, dmesg, app_launcher -S, avoc getters). None contains a backslash: Vetro
// mangles them. Temperature: Samsung TVs have no Linux thermal zones; the SoC driver exposes it in whole degrees at
// /sys/devices/platform/soc/<name>.thermal/temperature (where Vetro's dashboard reads it), next to tmu_state and
// throttle_on, logged raw (their meaning is not documented). The CPU clock against its 1.7 GHz maximum and Samsung's
// freq_limit / freq_lock are logged too.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const label = (args[0] && !args[0].startsWith('--') ? args[0] : 'run').replace(/[^A-Za-z0-9_-]/g, '-');
const host = opt('--host', localHost());
const seconds = +opt('--seconds', 0);
if (!host && args[0] !== 'compare') { console.error('No TV address: set vetroHost in src/js/config.local.js (npm run setup) or pass --host <tv-ip>'); process.exit(1); }
const HZ = 250;                                           // getconf CLK_TCK on the QN70F (not 100)
const dir = join(root, 'captures', 'tvmon', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + label);

function localHost() {                                    // controlCenter.vetroHost from config.local.js, if set
  try { const m = /vetroHost\s*:\s*'([0-9.]+)'/.exec(readFileSync(join(root, 'src', 'js', 'config.local.js'), 'utf8')); return m && m[1]; } catch { return null; }
}

async function tv(cmd, ms = 8000) {
  const t0 = Date.now();
  const r = await fetch('http://' + host + ':8099/exec', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ cmd }), signal: AbortSignal.timeout(ms) });
  const j = await r.json();
  return { out: (j.output || '') + (j.stderr ? '\n[stderr] ' + j.stderr : ''), ms: Date.now() - t0, exit: j.exit_code };
}

/* ---------- once, at start and end ---------- */
const AVOC = 'busctl --system call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl';
const SNAP = [
  ['Picture (avoc getters: the second number is the call status, 0 = answered)',
    ['GetPictureMode i 0', 'CheckGameMode', 'GetGameMode i 0', 'GetCloudGameMode', 'GetAutoMotionPlus i 0', 'GetFilmMode i 0', 'GetCommonPictureMode']
      .map((g) => `echo "${g.split(' ')[0]}: $(${AVOC} ${g} 2>&1)"`).join('; ') + '; true'],
  ['Running apps (app_launcher -S)', 'app_launcher -S 2>&1; true'],
  ['Memory', "grep -E '^(MemTotal|MemFree|MemAvailable|Cached|SwapTotal|SwapFree):' /proc/meminfo; grep -E '^(pswpin|pswpout|pgmajfault|oom_kill) ' /proc/vmstat; true"],
  ['CPU policy', 'echo "governor $(cat /sys/devices/system/cpu/cpufreq/policy0/scaling_governor)"; echo "min/max kHz $(cat /sys/devices/system/cpu/cpufreq/policy0/scaling_min_freq /sys/devices/system/cpu/cpufreq/policy0/scaling_max_freq)"; echo "freq_limit $(cat /sys/devices/system/cpu/cpufreq/freq_limit) freq_lock $(cat /sys/devices/system/cpu/cpufreq/freq_lock)"; echo "load $(cat /proc/loadavg)"; echo "uptime $(cat /proc/uptime)"; true'],
  ['SoC temperature (thermal driver: now, at boot, and its own 60 / 120 / 180 s readings)',
    'T=$(ls -d /sys/devices/platform/soc/*thermal 2>/dev/null | head -1); for f in temperature boot_temp exec_temp after_60sec_temp after_120sec_temp after_180sec_temp tmu_state throttle_on; do echo "$f $(cat $T/$f 2>&1)"; done; true'],
  ['Wi-Fi link', 'cat /proc/net/wireless; grep -E "wlan0|eth0" /proc/net/dev; true'],
  ['Kernel log, OOM / low-memory lines', "dmesg 2>&1 | grep -i -E 'oom|killed process|lowmem|lmk|out of memory' | tail -n 40; true"],
  ['Kernel log, last 80 lines', 'dmesg 2>&1 | tail -n 80; true']
];
async function snapshot(file, title) {
  let txt = `${title} ${new Date().toISOString()} (host ${host})\n`;
  for (const [name, cmd] of SNAP) {
    try { const r = await tv(cmd, 25000); txt += `\n##### ${name}\n${r.out.trim()}\n`; }
    catch (e) { txt += `\n##### ${name}\n(failed: ${e.message})\n`; }
  }
  writeFileSync(join(dir, file), txt);
  return txt;
}

/* ---------- once a second ---------- */
const SAMPLE = [
  'cat /proc/loadavg',
  "grep -E '^(MemAvailable|SwapFree):' /proc/meminfo",
  'echo FREQ $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq /sys/devices/system/cpu/cpu1/cpufreq/scaling_cur_freq /sys/devices/system/cpu/cpu2/cpufreq/scaling_cur_freq /sys/devices/system/cpu/cpu3/cpufreq/scaling_cur_freq 2>/dev/null)',   // unquoted: the values join on one line
  'echo LIMIT $(cat /sys/devices/system/cpu/cpufreq/freq_limit /sys/devices/system/cpu/cpufreq/freq_lock 2>/dev/null)',
  'S=$(app_launcher -S 2>/dev/null)',
  "echo \"APPS $(echo \"$S\" | grep -c '(')\"",
  "P=$(echo \"$S\" | awk '/MoonlightWasm/ {gsub(/[()]/, \"\", $2); print $2; exit}')",
  "[ -n \"$P\" ] && echo \"ML $(sed 's/.*) //' /proc/$P/stat | cut -d' ' -f12,13) $(grep VmRSS /proc/$P/status)\"",
  "grep -E '^(pswpin|pswpout|pgmajfault|oom_kill) ' /proc/vmstat",
  'grep wlan0 /proc/net/dev',
  'grep wlan0 /proc/net/wireless',
  'echo "PSI $(head -1 /proc/pressure/memory) | $(head -1 /proc/pressure/cpu) | $(head -1 /proc/pressure/io)"',
  'T=$(ls -d /sys/devices/platform/soc/*thermal 2>/dev/null | head -1)',
  'echo THERM $(cat $T/temperature $T/tmu_state $T/throttle_on 2>/dev/null)',
  'true'
].join('\n');
if (/\\/.test(SAMPLE) || SNAP.some(([, c]) => /\\/.test(c))) throw new Error('a command contains a backslash');

const COLS = ['t_s', 'time', 'rtt_ms', 'mem_avail_mb', 'swap_free_mb', 'load1', 'load5', 'cpu0_mhz', 'cpu1_mhz', 'cpu2_mhz', 'cpu3_mhz', 'cpu_avg_mhz',
  'soc_temp_c', 'tmu_state', 'throttle_on', 'freq_limit', 'freq_lock', 'apps', 'moonlight_cpu_pct', 'moonlight_rss_mb', 'swap_in_ps', 'swap_out_ps', 'majflt_ps', 'oom_kills',
  'wifi_rx_mbps', 'wifi_tx_mbps', 'wifi_quality', 'wifi_signal_dbm', 'psi_mem_some10', 'psi_cpu_some10', 'psi_io_some10', 'error'];

let prev = null, oom0 = null;
function parse(out, at, rtt) {
  const row = { t_s: ((at - start) / 1000).toFixed(1), time: new Date(at).toISOString().slice(11, 19), rtt_ms: rtt };
  const line = (re) => (out.match(re) || [])[1];
  const la = out.split('\n')[0].split(/\s+/); row.load1 = la[0]; row.load5 = la[1];
  row.mem_avail_mb = Math.round(+line(/MemAvailable:\s+(\d+)/) / 1024); row.swap_free_mb = Math.round(+line(/SwapFree:\s+(\d+)/) / 1024);
  const f = (line(/^FREQ (.*)$/m) || '').trim().split(/\s+/).map(Number).filter((x) => x > 0);
  f.forEach((x, i) => { row['cpu' + i + '_mhz'] = Math.round(x / 1000); });
  if (f.length) row.cpu_avg_mhz = Math.round(f.reduce((a, b) => a + b, 0) / f.length / 1000);
  const lim = (line(/^LIMIT (.*)$/m) || '').trim().split(/\s+/); row.freq_limit = lim[0]; row.freq_lock = lim[1];
  row.apps = line(/^APPS (\d+)/m);
  const th = (line(/^THERM (.*)$/m) || '').trim().split(/\s+/); row.soc_temp_c = th[0]; row.tmu_state = th[1]; row.throttle_on = th[2];
  const vm = {}; for (const k of ['pswpin', 'pswpout', 'pgmajfault', 'oom_kill']) vm[k] = +line(new RegExp('^' + k + ' (\\d+)', 'm'));
  const dev = (line(/wlan0:\s*([\d\s]+)$/m) || '').trim().split(/\s+/).map(Number);   // rx bytes = [0], tx bytes = [8]
  const ml = line(/^ML (\d+ \d+)/m), rss = line(/VmRSS:\s+(\d+)/);
  const wl = (line(/wlan0:\s+\d+\s+(\d+\.\s+\d+\.)/m) || '').split(/\s+/);      // the /proc/net/wireless line: 'status quality. level.'
  row.wifi_quality = wl[0] ? parseFloat(wl[0]) : '';
  row.wifi_signal_dbm = wl[1] ? (parseFloat(wl[1]) > 127 ? parseFloat(wl[1]) - 256 : parseFloat(wl[1])) : '';
  const psi = (line(/^PSI (.*)$/m) || '').split('|').map((s) => (/avg10=([\d.]+)/.exec(s) || [])[1]);
  [row.psi_mem_some10, row.psi_cpu_some10, row.psi_io_some10] = psi;
  if (oom0 === null) oom0 = vm.oom_kill;
  row.oom_kills = vm.oom_kill - oom0;
  const now = { at, vm, rx: dev[0], tx: dev[8], ml: ml && ml.split(' ').map(Number) };
  if (prev) {
    const dt = (at - prev.at) / 1000;
    row.swap_in_ps = Math.round((vm.pswpin - prev.vm.pswpin) / dt); row.swap_out_ps = Math.round((vm.pswpout - prev.vm.pswpout) / dt);
    row.majflt_ps = Math.round((vm.pgmajfault - prev.vm.pgmajfault) / dt);
    if (now.rx >= prev.rx) row.wifi_rx_mbps = ((now.rx - prev.rx) * 8 / dt / 1e6).toFixed(2);
    if (now.tx >= prev.tx) row.wifi_tx_mbps = ((now.tx - prev.tx) * 8 / dt / 1e6).toFixed(2);
    if (now.ml && prev.ml) row.moonlight_cpu_pct = (((now.ml[0] + now.ml[1]) - (prev.ml[0] + prev.ml[1])) / HZ / dt * 100).toFixed(0);
  }
  if (rss) row.moonlight_rss_mb = Math.round(+rss / 1024);
  prev = now;
  return row;
}

/* ---------- summary and compare ---------- */
function stats(rows, c) {
  const v = rows.map((r) => parseFloat(r[c])).filter((x) => !isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  return { min: v[0], avg, p95: v[Math.min(v.length - 1, Math.floor(v.length * 0.95))], max: v[v.length - 1], n: v.length };
}
function readCsv(file) {
  const [h, ...lines] = readFileSync(file, 'utf8').trim().split('\n');
  const cols = h.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((x, i) => [cols[i], x])));
}
const NUM = COLS.filter((c) => !['t_s', 'time', 'error'].includes(c));
const fmt = (x) => x == null ? '-' : (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2));
function summarize(rows, startTxt, endTxt) {
  let s = `run ${basename(dir)}  ·  ${rows.length} samples  ·  host ${host}\n\n` + 'column'.padEnd(20) + ['min', 'avg', 'p95', 'max'].map((x) => x.padStart(10)).join('') + '\n';
  for (const c of NUM) { const st = stats(rows, c); s += c.padEnd(20) + (st ? [st.min, st.avg, st.p95, st.max].map((x) => fmt(x).padStart(10)).join('') : '         (no data)') + '\n'; }
  const errs = rows.filter((r) => r.error).length;
  if (errs) s += `\nsamples that failed: ${errs}\n`;
  const pic = (t) => ((t.split('##### Picture')[1] || '').split('#####')[0] || '').trim();
  const oom = (t) => ((t.split('##### Kernel log, OOM')[1] || '').split('#####')[0] || '').split('\n').slice(1).filter(Boolean);
  const apps = (t) => ((t.split('##### Running apps')[1] || '').split('#####')[0] || '').split('\n').filter((l) => /\(\d+\)/.test(l)).map((l) => l.trim().replace(/ \(\d+\)$/, ''));
  s += '\npicture at start:\n  ' + pic(startTxt).split('\n').join('\n  ') + '\n';
  if (endTxt) {
    const a0 = apps(startTxt), a1 = apps(endTxt), newOom = oom(endTxt).filter((l) => !oom(startTxt).includes(l));
    s += 'picture at end:\n  ' + pic(endTxt).split('\n').join('\n  ') + '\n';
    s += `\napps running: ${a0.length} at start, ${a1.length} at end\n`;
    s += '  gone during the run: ' + (a0.filter((x) => !a1.includes(x)).join(', ') || 'none') + '\n';
    s += '  started during the run: ' + (a1.filter((x) => !a0.includes(x)).join(', ') || 'none') + '\n';
    s += `new OOM / low-memory kernel lines during the run: ${newOom.length}\n` + newOom.map((l) => '  ' + l).join('\n') + (newOom.length ? '\n' : '');
  }
  return s;
}
function compare(dirs) {
  if (!dirs.length) { console.log('usage: node scripts/tvmon.mjs compare <run dir> <run dir> ...'); return; }
  const runs = dirs.map((d) => ({ name: basename(d).slice(20) || basename(d), rows: readCsv(join(d, 'samples.csv')) }));
  const w = Math.max(18, ...runs.map((r) => r.name.length + 2));
  let out = 'average (p95) per run\n' + 'column'.padEnd(20) + runs.map((r) => r.name.padStart(w)).join('') + '\n';
  out += 'samples'.padEnd(20) + runs.map((r) => String(r.rows.length).padStart(w)).join('') + '\n';
  for (const c of NUM) out += c.padEnd(20) + runs.map((r) => { const st = stats(r.rows, c); return (st ? fmt(st.avg) + ' (' + fmt(st.p95) + ')' : '-').padStart(w); }).join('') + '\n';
  console.log(out);
}

/* ---------- the run ---------- */
if (args[0] === 'compare') { compare(args.slice(1)); process.exit(0); }
let start = Date.now();
mkdirSync(dir, { recursive: true });
console.log(`tvmon: ${label} -> ${dir}\ntaking the start snapshot...`);
const startTxt = await snapshot('start.txt', 'START');
const csv = join(dir, 'samples.csv');
writeFileSync(csv, COLS.join(',') + '\n');
const rows = [];
let stop = false, n = 0;
start = Date.now();                                       // seconds count from here, after the start snapshot
process.on('SIGINT', () => { if (stop) process.exit(1); stop = true; console.log('\nstopping after this sample...'); });
console.log(`sampling once a second${seconds ? ' for ' + seconds + ' s' : ''}; Ctrl+C to stop`);
while (!stop && (!seconds || Date.now() - start < seconds * 1000)) {
  const due = start + n * 1000; n++;
  if (Date.now() < due) await new Promise((r) => setTimeout(r, due - Date.now()));
  const at = Date.now();
  let row;
  try { const r = await tv(SAMPLE, 5000); row = parse(r.out, at, r.ms); }
  catch (e) { row = { t_s: ((at - start) / 1000).toFixed(1), time: new Date(at).toISOString().slice(11, 19), error: e.message.replace(/,/g, ';') }; }
  rows.push(row);
  appendFileSync(csv, COLS.map((c) => row[c] ?? '').join(',') + '\n');
  if (n % 10 === 1) console.log(`${row.time}  mem ${row.mem_avail_mb ?? '?'} MB  swap free ${row.swap_free_mb ?? '?'} MB  load ${row.load1 ?? '?'}  cpu ${row.cpu_avg_mhz ?? '?'} MHz  ${row.soc_temp_c ?? '?'} °C  wifi ${row.wifi_rx_mbps ?? '-'} Mb/s  moonlight ${row.moonlight_cpu_pct ?? '-'}%${row.error ? '  ERROR ' + row.error : ''}`);
}
console.log('taking the end snapshot...');
const endTxt = await snapshot('end.txt', 'END');
const sum = summarize(rows, startTxt, endTxt);
writeFileSync(join(dir, 'summary.txt'), sum);
console.log('\n' + sum + `\nsaved in ${dir}`);
