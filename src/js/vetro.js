/*
 * Vetro adapter: the ONLY code in Settle that talks to Vetro. The Control Center panel knows nothing
 * about Vetro, shell commands or transports; it sees this module's view model (controls / page / options /
 * read / act) and nothing else. Moving the panel over playing video (phase 2) means giving that overlay the
 * same adapter, not rewriting the panel.
 *
 * Every command below is copied from APL Launcher's published source (MIT, Knikt/APL-Launcher-for-TizenOS:
 * launcher/js/system.js, settings-tree.js, controlcenter.js). Vetro's API is  POST /exec  {"cmd": "<shell>"}
 * (root), answered with { ok, output, exit_code }. Nothing here is an invented endpoint. APL noted the value
 * lists on a different model (a Smart Monitor M8): they live in config.js -> controlCenter, so they can be
 * corrected for this TV.
 *
 * Reading answers: APL reports that Vetro lets a web page read answers only from /status, /probe and /screen.
 * A page can still SEND /exec as text/plain with no-cors. So the transport is chosen once, with a harmless
 * command, and never by retrying a real one (a blocked read still delivers the request: retrying "sleep"
 * would press the power key twice):
 *   direct    the answer is readable                         -> full state
 *   readback  send-only, but the command's output is written to a file the page can read
 *   send-only commands work, values cannot be read           -> the panel shows what was last set
 *   down      Vetro does not answer
 * Shell text built here never contains backslashes (Vetro doubles them) and every value put into it is
 * validated first (numbers from fixed ranges or lists, Bluetooth addresses against a strict pattern).
 */
(function () {
    'use strict';

    var C = window.LAUNCHER_CONFIG, CC = C.controlCenter || {};
    var PORT = CC.vetroPort || 8099, LOOP = ['127.0.0.1', '[::ffff:127.0.0.1]'], IPV4 = /^(?!0\.0\.0\.0$)(?!127\.)\d{1,3}(\.\d{1,3}){3}$/;
    // The Bluetooth manager also has LaunchAudioList (seen in the capture): the TV's own device screen. Its effect is not confirmed yet.
    var BTM = 'gdbus call --system --dest com.samsung.tv.bt.connectionmanager --object-path /com/samsung/tv/bt/connectionmanager --method com.samsung.tv.bt.connectionmanager.';
    var OUT_FILE = '/tmp/settle-cc.out', OUT_URL = CC.readbackUrl || 'file://' + OUT_FILE;
    var STORE = 'settle.cc.v2';

    // The AV service and Samsung's Bluetooth manager, exactly as APL calls them.
    var AVOC = 'busctl --system call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl ';
    var BT = 'gdbus call --system --dest com.samsung.tv.bt.connectionmanager --object-path /com/samsung/tv/bt/connectionmanager --method org.tizen.btapp.ApiInterface.';
    var MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;
    var ICON_DIR = '/usr/apps/com.samsung.tv.theme-resource/shared/res/org.tizen.menu/Settings_Popup/device_icon/';

    var link = { mode: 'unknown', host: 0, hosts: [], tried: [], ips: [], at: 0 }, linkP = null, backend = null;
    var assumed = load();                     // what we last set: shown when the real value cannot be read

    function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }
    function save() { try { localStorage.setItem(STORE, JSON.stringify(assumed)); } catch (e) { /* silent */ } }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function int(v, lo, hi) { v = Math.round(+v); if (isNaN(v) || v < lo || v > hi) throw new Error('value out of range'); return v; }

    /* ---------- transport ---------- */

    function base(host) { return 'http://' + host + ':' + PORT; }
    function timed(u, opts, ms) {
        return new Promise(function (ok, no) {
            var ctl = window.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); no(new Error('timeout')); }, ms);
            if (ctl) opts.signal = ctl.signal;
            fetch(u, opts).then(function (r) { clearTimeout(t); ok(r); }, function (e) { clearTimeout(t); no(e); });
        });
    }
    function body(cmd) { return JSON.stringify({ cmd: cmd }); }
    function postReadable(host, cmd, ms) {          // rejects (TypeError) when the browser may not read the answer
        return timed(base(host) + '/exec', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: body(cmd) }, ms || 9000).then(function (r) {
            if (r.status === 401) {                                          // Vetro is there and we may read it, but this app is not paired
                return r.json().catch(function () { return {}; }).then(function (j) { var e = new Error(j.error || 'Vetro needs this app to be paired'); e.unpaired = true; throw e; });
            }
            return r.json();
        });
    }
    function postBlind(host, cmd, ms) {
        return timed(base(host) + '/exec', { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: body(cmd) }, ms || 9000);
    }
    function readFile() {
        return new Promise(function (ok, no) {
            var x = new XMLHttpRequest();
            x.open('GET', OUT_URL + (OUT_URL.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now());
            x.timeout = 2500;
            x.onload = function () { ok(x.responseText || ''); };
            x.onerror = x.ontimeout = function () { no(new Error('unreadable')); };
            x.send();
        });
    }

    /* Where Vetro may be. Some 2025 TVs refuse loopback to apps while Vetro listens on every interface (APL Launcher's
       notes), so the TV's own LAN address is tried too: the one you set (controlCenter.vetroHost), then any this app is
       allowed to read, then loopback. */
    function systemInfoIps() {
        function one(prop) {
            return new Promise(function (ok) {
                var t = setTimeout(function () { ok(null); }, 1500);
                try { window.tizen.systeminfo.getPropertyValue(prop, function (n) { clearTimeout(t); ok(n && n.ipAddress); }, function () { clearTimeout(t); ok(null); }); }
                catch (e) { clearTimeout(t); ok(null); }                   // no tizen (preview) or no permission: that is fine
            });
        }
        return Promise.all([one('ETHERNET_NETWORK'), one('WIFI_NETWORK')]).then(function (a) { return a.filter(function (ip) { return ip && IPV4.test(ip); }); });
    }
    function hostList() {
        var manual = CC.vetroHost && /^[A-Za-z0-9.\-]+$/.test(CC.vetroHost) ? [CC.vetroHost] : [];          // validated: it goes into a URL
        return systemInfoIps().then(function (ips) {
            link.ips = ips;
            var all = manual.concat(ips, LOOP);
            return all.filter(function (h, i) { return all.indexOf(h) === i; });
        });
    }

    // Decide the transport once, using only harmless commands. A "down" verdict is re-tested after 15 s (Vetro may have been started).
    function ensureLink() {
        if ((link.mode === 'down' || link.mode === 'unpaired') && Date.now() - link.at > 15000) link.mode = 'unknown';
        if (link.mode !== 'unknown') return Promise.resolve(link);
        if (linkP) return linkP;
        linkP = hostList().then(function (hosts) {
            link.hosts = hosts; link.tried = [];
            var i = 0;
            function next() {
                if (i >= hosts.length) { link.mode = 'down'; link.at = Date.now(); return link; }
                var h = hosts[i], idx = i; i++;
                return postReadable(h, 'true', 3000).then(function () { link.mode = 'direct'; link.host = idx; return link; }, function (err) {
                    if (err && err.unpaired) { link.mode = 'unpaired'; link.host = idx; link.why = err.message; link.at = Date.now(); return link; }
                    return postBlind(h, 'true', 3000).then(function () {                    // Vetro is there, but its answers are not readable
                        link.host = idx;
                        return postBlind(h, 'echo settle-ok > ' + OUT_FILE).then(function () { return wait(400); }).then(readFile).then(function (t) {
                            link.mode = /settle-ok/.test(t) ? 'readback' : 'send-only';
                            return link;
                        }, function () { link.mode = 'send-only'; return link; });
                    }, function () { link.tried.push(h + ' no answer'); return next(); });
                });
            }
            return next();
        }).then(function (l) { linkP = null; return l; });
        return linkP;
    }

    // exec(cmd, want): resolves { ok, output } or { sent: true } when the output cannot be read.
    function exec(cmd, want) {
        if (backend) return backend(cmd);
        return ensureLink().then(function (l) {
            if (l.mode === 'down') throw new Error('Vetro is not reachable');
            if (l.mode === 'unpaired') throw new Error('Vetro needs this app to be paired with it first');
            var h = l.hosts[l.host];
            if (l.mode === 'direct') {
                return postReadable(h, cmd).then(function (j) {
                    if (j && j.ok === false) throw new Error(j.error || 'Vetro refused the command');
                    return j;
                });
            }
            if (want && l.mode === 'readback') {
                return postBlind(h, '{ ' + cmd + '; } > ' + OUT_FILE + ' 2>&1').then(function () { return wait(350); })
                    .then(readFile).then(function (t) { return { ok: true, output: t }; }, function () { return { sent: true }; });
            }
            return postBlind(h, cmd).then(function () { return { sent: true }; });
        });
    }

    /* ---------- the settings: one row per setting, straight from APL ---------- */

    function modes() { return CC.pictureModes || []; }
    function soundModes() { return CC.soundModes || []; }
    function devices() { return CC.audioDevices || []; }
    function inputs() { return CC.inputs || []; }

    var OFF_ON = [[0, 'Off'], [1, 'On']];
    // get: the AV service getter (read as  "<type> <value> <code>", code 0 = answered)
    // set: builds the setter for a value (the trailing 1 = "save it": APL found that 0 applies but is forgotten at once)
    // kind: slider (min/max/step) | choice (list) | toggle (0/1)
    var ROWS = {
        'brightness':  { label: 'Brightness', kind: 'slider', min: 0, max: 50, step: 2, get: 'GetBacklight i 0', set: function (v) { return 'SetBacklight ii ' + v + ' 1'; } },
        'p.mode':      { label: 'Picture mode', kind: 'choice', list: modes, get: 'GetPictureMode i 0', set: function (v) { return 'SetPictureMode ii ' + v + ' 1'; } },
        'p.ai':        { label: 'AI mode', kind: 'toggle', list: function () { return OFF_ON; }, get: 'GetPictureMode i 0', map: function (c) { return c === 589824 ? 1 : 0; },
                         set: function (v) { return 'SetPictureMode ii ' + (v ? 589824 : 65537) + ' 1'; } },     // on = the AI picture code seen in the captures; off = Standard
        'p.contrast':  { label: 'Contrast', kind: 'slider', min: 0, max: 50, step: 2, get: 'GetContrast i 0', set: function (v) { return 'SetContrast yi ' + v + ' 1'; } },
        'p.sharpness': { label: 'Sharpness', kind: 'slider', min: 0, max: 20, step: 1, get: 'GetSharpness i 0', set: function (v) { return 'SetSharpness yi ' + v + ' 1'; } },
        'p.color':     { label: 'Color', kind: 'slider', min: 0, max: 50, step: 2, get: 'GetColorStrength i 0', set: function (v) { return 'SetColorStrength yi ' + v + ' 1'; } },
        'p.tint':      { label: 'Tint (G/R)', kind: 'slider', min: 0, max: 30, step: 1, get: 'GetColorTint i 0', set: function (v) { return 'SetColorTint yi -- ' + v + ' 1'; },
                         text: function (v) { return v === 15 ? '0/0' : v < 15 ? 'G' + (15 - v) : 'R' + (v - 15); } },
        'p.eye':       { label: 'Eye Saver mode', kind: 'toggle', list: function () { return OFF_ON; }, get: 'GetEyeSaverMode i 0', set: function (v) { return 'SetEyeSaverMode ii -- ' + v + ' 1'; } },
        'p.adaptive':  { label: 'Adaptive picture', kind: 'toggle', list: function () { return OFF_ON; }, get: 'GetAdaptivePicture', set: function (v) { return 'SetAdaptivePicture i -- ' + v; } },
        'p.hdmi':      { label: 'HDMI black level', kind: 'choice', list: function () { return [[0, 'Normal'], [1, 'Auto'], [2, 'Low']]; }, get: 'GetHdmiBlackLevel i 0', set: function (v) { return 'SetHdmiBlackLevel ii -- ' + v + ' 1'; } },
        's.mode':      { label: 'Sound mode', kind: 'choice', list: soundModes, get: 'GetSoundMode u 0', set: function (v) { return 'SetSoundMode uu -- ' + v + ' 1'; } },
        's.asp':       { label: 'Adaptive Sound Pro', kind: 'toggle', ai: true, list: function () { return OFF_ON; }, get: 'GetAiAudioSceneBased', set: function (v) { return 'SetAiAudioSceneBased ii ' + v + ' 1'; } },
        's.autovol':   { label: 'Auto volume', kind: 'choice', list: function () { return [[0, 'Disabled'], [1, 'Normal'], [2, 'Night']]; }, get: 'GetAutoVolume u 0', set: function (v) { return 'SetAutoVolume uu -- ' + v + ' 1'; } }
    };
    var PAGES = {
        picture: ['p.mode', 'p.contrast', 'p.sharpness', 'p.color', 'p.tint', 'p.eye', 'p.adaptive', 'p.hdmi'],
        sound: ['s.mode', 's.asp', 's.autovol']
    };
    var aiOn = false;                                                      // AI mode shows up as picture mode 589824 (seen in the captures)
    var AI_PICTURE = 589824;
    function rid(id) { return id.replace('.', '_'); }                      // a shell/regex-safe id

    function answerValue(line) { return parseInt(String(line || '').trim().split(/\s+/)[1], 10); }   // "ii <value> <code>"
    function lineVal(out, id) {
        var m = new RegExp('^' + rid(id) + '\\s+\\S+\\s+(-?\\d+)\\s+(\\d+)', 'm').exec(out);
        return m && +m[2] === 0 ? +m[1] : null;                                                       // code 0 = the screen answered
    }
    function lastLine(r) { var l = String((r && r.output) || '').trim().split('\n'); return l[l.length - 1]; }

    function readAll() {
        var parts = Object.keys(ROWS).map(function (id) { return 'echo ' + rid(id) + ' $(' + AVOC + ROWS[id].get + ' 2>/dev/null)'; });
        var cmd = parts.join('; ') + '; echo BT_BEGIN; ' + BT + 'get_connected_bt_speaker_info 2>&1; echo BT_END; echo WIFI_BEGIN; connmanctl services 2>&1 | grep -E "^\\*[A-Z]*[OR] "; echo WIFI_END';
        return exec(cmd, true).then(function (r) {
            if (!r || r.sent) return null;
            var out = String(r.output || ''), st = { v: {} };
            Object.keys(ROWS).forEach(function (id) { st.v[id] = lineVal(out, id); });
            aiOn = st.v['p.mode'] === AI_PICTURE;
            var bt = /BT_BEGIN([\s\S]*?)BT_END/.exec(out);
            if (bt && !/error/i.test(bt[1])) { var m = /[0-9A-F]{2}(?::[0-9A-F]{2}){5}/i.exec(bt[1].toUpperCase()); st.btKnown = true; st.btMac = m ? m[0] : null; }
            var wf = /WIFI_BEGIN([\s\S]*?)WIFI_END/.exec(out);
            if (wf) { var wm = /^\*[A-Z]*[OR]\s+(.+?)\s+wifi_/m.exec(wf[1]); st.wifi = wm ? wm[1] : 'Not connected'; }
            return st;
        });
    }

    /* ---------- the view model ---------- */

    function controls() {
        return [
            { id: 'sleep', label: 'Sleep', kind: 'action', big: true, confirm: 'Press OK again to sleep' },
            { id: 'picture', label: 'Picture', kind: 'page' },
            { id: 'sound', label: 'Sound mode', kind: 'page' },
            { id: 'output', label: 'Audio output', kind: 'choice' },
            { id: 'input', label: 'Input', kind: 'choice' },
            { id: 'wifi', label: 'Wi-Fi', kind: 'run' },
            { id: 'bluetooth', label: 'Bluetooth', kind: 'run' },
            { id: 'brightness', label: 'Brightness', kind: 'slider', min: 0, max: 50, step: 2 }
        ];
    }

    // The rows of a page (Picture, Sound mode): label, kind and range, no values.
    function page(id) {
        var rows = (PAGES[id] || []).filter(function (r) { return !ROWS[r].ai || aiOn; });
        return rows.map(function (r) { var d = ROWS[r]; return { id: r, label: d.label, kind: d.kind, min: d.min, max: d.max, step: d.step, text: d.text }; });
    }

    function options(id) {
        if (ROWS[id] && ROWS[id].list) return ROWS[id].list().map(function (m) { return { id: String(m[0]), label: m[1] }; });
        if (id === 'output') return [{ id: 'tv', label: 'TV speakers' }].concat(devices().map(function (d) { return { id: d.mac.toUpperCase(), label: d.name }; }));
        if (id === 'input') return inputs().map(function (i) { return { id: String(i.type), label: i.label }; });
        return [];
    }

    function currentInput() {                  // read with the Tizen API the launcher already uses: no Vetro, no new privilege
        try {
            var s = window.tizen.tvwindow.getSource('MAIN');
            if (s && s.type === 'HDMI') return { id: String(12 + s.number), label: 'HDMI ' + s.number };
            if (s && s.type === 'TV') return { id: '0', label: 'TV' };
        } catch (e) { /* not available */ }
        return null;
    }

    function offline() { return backend ? null : (link.mode === 'down' ? 'Vetro offline' : (link.mode === 'unpaired' ? 'Pairing needed' : null)); }

    function rowView(id, st) {                 // { value: text, current } for one setting
        var d = ROWS[id], fromTv = st && st.v && st.v[id] != null, v = fromTv ? st.v[id] : assumed[id];
        if (fromTv && d.map) v = d.map(v);
        if (v == null) return { value: offline() || '—', current: null };
        if (d.kind === 'slider') return { value: d.text ? d.text(v) : String(v), current: v };
        if (id === 'p.mode' && v === AI_PICTURE) return { value: 'AI optimised', current: String(v) };     // seen in the captures with AI mode on
        var hit = d.list().filter(function (m) { return m[0] === v; })[0];
        return { value: hit ? hit[1] : (d.kind === 'toggle' ? String(v) : 'Mode ' + v), current: String(v) };
    }

    function build(st) {
        var m = {};
        Object.keys(ROWS).forEach(function (id) { m[id] = rowView(id, st); });
        m.sleep = { value: 'Turn the TV off' };
        var aiNow = m['p.ai'].current === '1';
        m.picture = { value: m['p.mode'].value, current: m['p.mode'].current, locked: aiNow ? 'AI mode is on (TV setting)' : null };      // AI decides the picture while it is on
        m.sound = { value: m['s.mode'].value, current: m['s.mode'].current };
        var aud = st && st.btKnown ? (st.btMac || 'tv') : assumed.audio;
        var dev = aud && aud !== 'tv' ? devices().filter(function (d) { return d.mac.toUpperCase() === String(aud).toUpperCase(); })[0] : null;
        m.output = { value: !aud ? (offline() || '—') : (aud === 'tv' ? 'TV speakers' : (dev ? dev.name : 'Bluetooth speaker')), current: aud || null };
        var ci = currentInput() || (assumed.input != null ? options('input').filter(function (o) { return o.id === String(assumed.input); })[0] : null);
        m.input = { value: ci ? ci.label : '—', current: ci ? ci.id : null };
        m.wifi = { value: st && st.wifi ? st.wifi : (offline() || '—'), current: null };
        m.bluetooth = { value: 'Find devices', current: null };
        return m;
    }

    function cached() { return build(null); }
    function read() { return readAll().then(build, function () { return build(null); }); }

    /* ---------- actions ---------- */

    // The last few setter calls and exactly what the TV answered: shown in Diagnostics and added to every capture.
    var traceLog = [];
    function trace(id, cmd, r) {
        traceLog.push(id + '  ' + cmd.replace(/^.*AvOutputControl /, '') + ' => ' + (r && !r.sent ? String(r.output || '').replace(/\s+/g, ' ').trim().slice(0, 420) : '(output not readable)'));
        if (traceLog.length > 6) traceLog.shift();
    }
    function setRow(id, arg) {
        var d = ROWS[id], v;
        if (d.kind === 'slider') v = int(arg, d.min, d.max);
        else {
            v = int(arg, -1e6, 1e7);
            if (!d.list().some(function (m) { return m[0] === v; })) throw new Error('unknown value');
        }
        return exec(AVOC + d.set(v) + ' 2>&1; ' + AVOC + d.get + ' 2>&1', true).then(function (r) {
            trace(id, d.set(v) + ' ; ' + d.get, r);
            var back = r && !r.sent ? answerValue(lastLine(r)) : NaN;
            if (d.map && !isNaN(back)) back = d.map(back);
            assumed[id] = isNaN(back) ? v : back; save();
            if (id === 'p.mode') aiOn = (isNaN(back) ? v : back) === AI_PICTURE;
            if (!isNaN(back) && back !== v) throw new Error('The TV refused this setting for now');
        });
    }

    /* Switching inputs needs no Vetro: the app asks Samsung's TV viewer directly (as APL Launcher does first, Vetro second). */
    // Launch an installed app by id with Tizen's own API (the widget has the application.launch privilege). Gives up after 3 s.
    function launchNative(appId) {
        return new Promise(function (ok, no) {
            var t = setTimeout(function () { no(new Error('no answer')); }, 3000);
            try { window.tizen.application.launch(appId, function () { clearTimeout(t); ok(); }, function (e) { clearTimeout(t); no(e); }); }
            catch (e) { clearTimeout(t); no(e); }
        });
    }

    function inputNative(type, label, icon) {
        return new Promise(function (ok, no) {
            try {
                var tz = window.tizen, n = String(type);
                var extra = [['change_source', n], ['sourceType', n], ['sourceName', label], ['sourceIcon', icon], ['mbrIndex', '-2']];
                var data = extra.map(function (kv) { return new tz.ApplicationControlData(kv[0], [kv[1]]); });
                var ctl = new tz.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null, data);
                tz.application.launchAppControl(ctl, 'org.tizen.tv-viewer', ok, no);
            } catch (e) { no(e); }
        });
    }

    /* Sleep without Vetro: Samsung's network remote, a local WebSocket (adapted from APL Launcher, MIT). The TV may ask to
       allow this device the first time; the token it gives back is kept. */
    function sleepViaRemote() {
        return new Promise(function (resolve, reject) {
            var name = window.btoa('Settle'), token = '';
            try { token = localStorage.getItem('settle.remoteToken') || ''; } catch (e) { /* none */ }
            var urls = ['ws://127.0.0.1:8001/api/v2/channels/samsung.remote.control?name=' + name,
                        'wss://127.0.0.1:8002/api/v2/channels/samsung.remote.control?name=' + name + (token ? '&token=' + token : '')];
            (function attempt(i) {
                if (i >= urls.length) { reject(new Error('Neither Vetro nor the TV\'s network remote answered')); return; }
                var done = false, ws, timer = setTimeout(function () { if (!done) { done = true; try { ws.close(); } catch (e) { /* ignore */ } attempt(i + 1); } }, 5000);
                try { ws = new window.WebSocket(urls[i]); } catch (e) { clearTimeout(timer); attempt(i + 1); return; }
                ws.onmessage = function (m) {
                    var d = {};
                    try { d = JSON.parse(m.data); } catch (e) { /* not json */ }
                    if (d.event === 'ms.channel.connect') {
                        if (d.data && d.data.token) { try { localStorage.setItem('settle.remoteToken', d.data.token); } catch (e) { /* ignore */ } }
                        ws.send(JSON.stringify({ method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: 'KEY_POWER', Option: 'false', TypeOfRemote: 'SendRemoteKey' } }));
                        done = true; clearTimeout(timer);
                        setTimeout(function () { try { ws.close(); } catch (e) { /* ignore */ } resolve(); }, 400);
                    } else if (d.event === 'ms.channel.unauthorized') {
                        done = true; clearTimeout(timer); reject(new Error('The TV refused the network remote: allow it on the TV'));
                    }
                };
                ws.onerror = function () { if (!done) { done = true; clearTimeout(timer); attempt(i + 1); } };
            })(0);
        });
    }

    function act(id, arg) {
        var cmd, v;
        if (ROWS[id]) return setRow(id, arg);
        if (id === 'sleep') {
            if (backend) return exec('/usr/bin/input_keyevent XF86PowerOff 2>&1').then(function () {});
            return ensureLink().then(function (l) {
                return (l.mode === 'down' || l.mode === 'unpaired') ? sleepViaRemote() : exec('/usr/bin/input_keyevent XF86PowerOff 2>&1').then(function () {});
            });
        }
        if (id === 'ai') return setRow('p.ai', arg);
        if (id === 'bluetooth') {                                                  // the call that did open something on the TV before
            return exec(BTM + 'LaunchAudioList 2>&1', true).then(function (r) {
                trace('bluetooth', 'LaunchAudioList', r);
                if (r && !r.sent && /error|failed|unknown|not found/i.test(String(r.output || ''))) throw new Error('The TV did not open it');
                return 'Opened on the TV';
            });
        }
        if (id === 'wifi') {                                                       // the TV's network settings app: asked directly first, then through Vetro
            var apps = [CC.wifiApp || 'com.samsung.tv.coba.setting.networksettings', 'org.tizen.NetworkSetting-Tizen'];
            return (function tryApp(i) {
                if (i >= apps.length) throw new Error('The TV did not open it');
                if (!/^[A-Za-z0-9._-]+$/.test(apps[i])) return tryApp(i + 1);
                var native = window.tizen && window.tizen.application && !backend;
                return (native ? launchNative(apps[i]).then(function () { trace('wifi', 'tizen launch ' + apps[i], { output: 'accepted' }); return true; },
                                                              function (e) { trace('wifi', 'tizen launch ' + apps[i], { output: 'refused: ' + (e && e.message) }); return false; })
                               : Promise.resolve(false)).then(function (ok) {
                    if (ok) return 'Opened on the TV';
                    return exec('app_launcher -s ' + apps[i] + ' 2>&1', true).then(function (r) {
                        trace('wifi', 'app_launcher -s ' + apps[i], r);
                        if (r && !r.sent && /error|fail|not found|no such|unknown|invalid/i.test(String(r.output || ''))) return tryApp(i + 1);
                        return 'Sent to the TV';
                    });
                });
            })(0);
        }
        if (id === 'input') {
            v = int(arg, 0, 20);
            var o = inputs().filter(function (i) { return i.type === v; })[0];
            if (!o) throw new Error('unknown input');
            var label = String(o.label).replace(/[^A-Za-z0-9 +-]/g, ''), icon = ICON_DIR + (v >= 13 && v <= 16 ? 'r_icon_device_s_hdmi' + (v - 12) : 'r_icon_device_s_tv') + '.webp';
            cmd = 'app_launcher -s org.tizen.tv-viewer change_source ' + "'" + v + "'" + ' sourceType ' + "'" + v + "'" + ' sourceName ' + "'" + label + "'" + ' sourceIcon ' + "'" + icon + "'" + ' __K_EX_LAUNCH_REQUESTOR ' + "'user'" + ' 2>&1';
            var native = window.tizen && window.tizen.application && !backend;
            return (native ? inputNative(v, label, icon).catch(function () { return exec(cmd); }) : exec(cmd)).then(function () { assumed.input = v; save(); });
        }
        if (id === 'output') {
            var want = String(arg).toUpperCase();
            if (want === 'TV') {
                cmd = BT + 'disconnect_last_btspk_list 2>&1';                          // APL: buds_switching_disconnect does nothing; this one works
            } else {
                if (!MAC.test(want) || !devices().some(function (d) { return d.mac.toUpperCase() === want; })) throw new Error('unknown audio device');
                cmd = BT + 'buds_switching_connect ' + want + ' 2>&1';
            }
            var target = want === 'TV' ? 'TV' : want;
            return exec(cmd).then(function () {
                assumed.audio = want === 'TV' ? 'tv' : want; save();
                var tries = 6;                                                          // Bluetooth takes a few seconds: ask the TV until it agrees
                return (function poll() {
                    return wait(1500).then(readAll).then(function (st) {
                        if (!st || !st.btKnown) return;
                        var now = (st.btMac || 'TV').toUpperCase();
                        if (now === target) return;
                        if (--tries <= 0) throw new Error('The speaker did not respond: turn it on and try again');
                        return poll();
                    });
                })();
            });
        }
        return Promise.reject(new Error('unknown control'));
    }

    // For the diagnostics screen: which way this TV lets us talk to Vetro, and every address that was tried.
    function probe() {
        if (backend) return Promise.resolve('stand-in (preview)');
        link.mode = 'unknown';                                            // diagnostics always re-tests
        return ensureLink().then(function (l) {
            var ip = CC.vetroHost ? 'using the configured address ' + CC.vetroHost : (l.ips.length ? 'TV address ' + l.ips.join(', ') : 'TV address not readable by this app: set controlCenter.vetroHost');
            if (l.mode === 'unpaired') return 'reachable at ' + l.hosts[l.host] + ' but NOT paired (401)\n           ' + l.why + '\n           ' + ip;
            if (l.mode === 'down') return 'NOT reachable on port ' + PORT + '\n           tried ' + l.tried.join(' · ') + '\n           ' + ip;
            return { direct: 'direct: answers readable', readback: 'send-only + file read-back', 'send-only': 'send-only: values cannot be read' }[l.mode] + ' (' + l.hosts[l.host] + ')\n           ' + ip;
        });
    }

    /* ---------- experiments (Diagnostics keys 1-3, 0 = undo) ----------
       Fixed, reversible: set ONE AI setting, read the AI values back, record what the TV said. Nothing else is touched. */
    var EXP = { 1: ['SetAiPictureOptimizer', 1], 2: ['SetAiIllumination', 1], 3: ['SetAiAudioSceneBased', 1] };
    var EXP_READ = 'echo opt $(' + AVOC + 'GetAiPictureOptimizer i 0 2>&1); echo illum $(' + AVOC + 'GetAiIllumination 2>&1); echo scene $(' + AVOC + 'GetAiAudioSceneBased 2>&1); echo picmode $(' + AVOC + 'GetPictureMode i 0 2>&1)';
    function experiment(n) {
        var cmd;
        if (n === 0) cmd = Object.keys(EXP).map(function (k) { return AVOC + EXP[k][0] + ' ii 0 1 2>&1'; }).join('; ');
        else if (EXP[n]) cmd = AVOC + EXP[n][0] + ' ii ' + EXP[n][1] + ' 1 2>&1';
        else return Promise.resolve();
        return exec(cmd + '; ' + EXP_READ, true).then(function (r) { trace('exp' + n, cmd.replace(/busctl[^;]*?AvOutputControl /g, ''), r); }, function (e) { trace('exp' + n, 'failed', { output: e.message }); });
    }

    /* ---------- capture: a read-only report of what this TV exposes (for diagnostics) ----------
       Nothing here sets anything. It lists the AV service's methods, reads every one-argument getter
       with argument 0, lists the Bluetooth manager's methods and the audio/picture-related services. */
    function capture(progress) {
        var say = progress || function () {}, out = [];
        function run(title, cmd) {
            say(title);
            return exec(cmd, true).then(function (r) { out.push('##### ' + title + '\n' + (r && r.sent ? '(sent, output not readable)' : String((r && r.output) || '').trim()) + '\n'); },
                function (e) { out.push('##### ' + title + '\n(failed: ' + e.message + ')\n'); });
        }
        var avSvc = 'busctl --system introspect org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl 2>&1';
        return exec('true').then(function () { return ensureLink(); }).then(function (l) {
            out.push('Recent setter calls (what the TV answered)\n' + (traceLog.length ? traceLog.join('\n') : '(none this session)') + '\n');
            out.push('Recent key events: ' + ((window.__keyLog || []).join('  ') || 'none') + (window.__runaway ? '  [stuck-key repeats dropped: ' + window.__runaway + ']' : '') + '\n');
            out.push('Settle capture ' + new Date().toISOString() + '\nlink: ' + l.mode + (l.hosts ? ' (' + l.hosts[l.host] + ')' : '') + '\n');
            if (l.mode !== 'direct' && l.mode !== 'readback' && !backend) throw new Error('Vetro is ' + l.mode + ': cannot capture');
            // Vetro's own read-only pages (GET): how keys are remapped now, and what it knows about the TV. Needs a readable link.
            var gets = l.mode === 'direct' && !backend ? ['remap', 'input', 'status'].map(function (p) {
                return function () {
                    say('Vetro /' + p);
                    return timed(base(l.hosts[l.host]) + '/' + p, { method: 'GET' }, 5000).then(function (r) { return r.text(); })
                        .then(function (t) { out.push('##### Vetro GET /' + p + '\n' + t.slice(0, 6000) + '\n'); }, function (e) { out.push('##### Vetro GET /' + p + '\n(failed: ' + e.message + ')\n'); });
                };
            }) : [];
            var chain = Promise.resolve();
            gets.forEach(function (g) { chain = chain.then(g); });
            return chain.then(function () { say('AV service methods'); return exec(avSvc, true); });
        }).then(function (r) {
            var text = String((r && r.output) || ''), getters = [], plain = [];
            out.push('##### AV service methods\n' + text.trim() + '\n');
            text.split('\n').forEach(function (ln) {
                var m = /^\.(Get[A-Za-z0-9]+)\s+method\s+([iuy])\s/.exec(ln.trim());
                if (m && getters.length < 150) getters.push([m[1], m[2]]);
                var n = /^\.((?:Get|AudioGet)[A-Za-z0-9]+)\s+method\s+-\s+(?:ii|ui|i)\s/.exec(ln.trim());
                if (n && plain.length < 150) plain.push(n[1]);
            });
            var chunks = [];
            for (var i = 0; i < getters.length; i += 25) chunks.push(getters.slice(i, i + 25));
            var seq = Promise.resolve();
            chunks.forEach(function (c, k) {
                seq = seq.then(function () {
                    return run('AV getters ' + (k + 1) + '/' + chunks.length, c.map(function (g) { return 'echo ' + g[0] + ' $(' + AVOC + g[0] + ' ' + g[1] + ' 0 2>&1)'; }).join('; '));
                });
            });
            for (var j = 0; j < plain.length; j += 25) (function (c, k, t) {
                seq = seq.then(function () { return run('AV no-argument getters ' + (k + 1) + '/' + t, c.map(function (g) { return 'echo ' + g + ' $(' + AVOC + g + ' 2>&1)'; }).join('; ')); });
            })(plain.slice(j, j + 25), j / 25, Math.ceil(plain.length / 25));
            return seq;
        }).then(function () {
            var q = function (g, t) { return [0, 1, 2, 3, 4].map(function (a) { return 'echo ' + g + a + ' $(' + AVOC + g + ' ' + t + ' ' + a + ' 2>&1)'; }).join('; '); };
            return run('Sound getters tried with arguments 0-4', q('GetDialogClarity', 'u') + '; ' + q('GetSoundMode', 'u') + '; ' + q('GetSoundOnVideoCall', 'u') + '; echo CheckDialogClarity $(' + AVOC + 'CheckDialogClarity 2>&1)');
        }).then(function () {
            return run('Settings store (vconf), sound/AI related keys', '(which vconftool 2>&1; for d in db memory file; do vconftool get -r $d 2>&1; done) | grep -i -E "vconftool|sound|audio|voice|amplif|adaptive|dialog|volume|speaker|ai_|_ai" | head -300');
        }).then(function () {
            return run('Network and Bluetooth state', '(connmanctl state; connmanctl technologies; connmanctl services) 2>&1 | head -60; busctl --system tree org.projectx.bt 2>&1 | head -40; busctl --system tree net.connman 2>&1 | head -30; (which hciconfig bluetoothctl wpa_cli iwconfig; hciconfig; ip -brief addr) 2>&1 | head -30').then(function () {
                return run('AI services (structure only)', 'for s in org.tizen.AISControlManager org.projectx.aitech; do echo "=== $s"; for p in $(busctl --system tree $s --list 2>/dev/null | head -8); do echo "--- $p"; busctl --system introspect $s $p --no-pager 2>&1 | grep -v "org.freedesktop.DBus" | head -60; done; done');
            });
        }).then(function () {
            return run('Running apps (app_launcher -S)', 'app_launcher -S 2>&1 | head -80');
        }).then(function () {
            return run('Bluetooth manager methods', 'gdbus introspect --system --dest com.samsung.tv.bt.connectionmanager --object-path /com/samsung/tv/bt/connectionmanager 2>&1');
        }).then(function () {
            return run('Bluetooth connected speaker', BT + 'get_connected_bt_speaker_info 2>&1');
        }).then(function () {
            return run('Bluetooth paired devices', BT + 'get_paired_device_info 2>&1; ' + BT + 'get_devices_info 2>&1');
        }).then(function () {
            return run('Related services on the system bus', "busctl --system list --no-pager 2>&1 | grep -i -E 'avoc|audio|sound|picture|bt|blue|ai|speaker'");
        }).then(function () { return out.join('\n'); }, function (e) { out.push('FAILED: ' + e.message); return out.join('\n'); });
    }

    if (window.MOCK && window.MOCK.vetro) backend = window.MOCK.vetro;          // browser preview: a stand-in TV (mock.js, not shipped)

    window.Vetro = {
        adapter: { controls: controls, page: page, options: options, read: read, cached: cached, act: act },
        probe: probe,
        capture: capture,
        launchApp: function (appId) {                                    // through Vetro, for apps the web API is not allowed to open
            if (!/^[A-Za-z0-9._-]+$/.test(appId || '')) return Promise.reject(new Error('bad app id'));
            return exec('app_launcher -s ' + appId + ' 2>&1', true).then(function (r) { trace('launch', 'app_launcher -s ' + appId, r); return r; });
        },
        // The app switcher's fallback when tizen.application.kill() is refused.
        killApp: function (appId) {
            if (!/^[A-Za-z0-9._-]+$/.test(appId || '')) return Promise.reject(new Error('bad app id'));
            return exec('app_launcher -k ' + appId + ' 2>&1', true).then(function (r) { trace('kill', 'app_launcher -k ' + appId, r); return r; });
        },
        // MemAvailable in MB, from /proc/meminfo. Rejects when Vetro is not up or the output cannot be read.
        memAvailable: function () {
            return exec('grep MemAvailable /proc/meminfo', true).then(function (r) {
                var m = /MemAvailable:\s+(\d+)/.exec((r && r.output) || '');
                if (!m) throw new Error('no reading');
                return Math.round(+m[1] / 1024);
            });
        },
        experiment: experiment,
        trace: function () { return traceLog.slice(); },
        mode: function () { return link.mode; },
        setBackend: function (fn) { backend = fn; }          // preview / tests only
    };
})();
