/*
 * The Control Center's launcher-side entries, kept apart from the TV (Vetro) adapter:
 *   Wallpaper        -> fetch a new photo now and crossfade it in
 *   Recommendations  -> refetch the rail now and repopulate it
 * compose(base) wraps the Vetro adapter so the panel still talks to ONE adapter. Both actions have a deadline,
 * so a tile can never sit on "Working…". A failure comes back as a short message the panel shows on the tile.
 */
(function () {
    'use strict';

    var DEADLINE = 15000;

    function within(p, ms) {
        return new Promise(function (ok, no) {
            var t = setTimeout(function () { no(new Error('Took too long')); }, ms);
            p.then(function (v) { clearTimeout(t); ok(v); }, function (e) { clearTimeout(t); no(e); });
        });
    }

    // One tile for Settle's own options; its page holds what used to be three tiles, plus Diagnostics.
    var EXTRA = [{ id: 'settle', label: 'Settle', kind: 'page' }];
    var SETTLE_ROWS = [
        { id: 'screensaver', label: 'Screensaver', kind: 'choice' },
        { id: 'wallpaper', label: 'Wallpaper', kind: 'run' },
        { id: 'recs', label: 'Recommendations', kind: 'run' },
        { id: 'nuvio', label: '', kind: 'run' },                        // label: Settle.nuvio.label()
        { id: 'backup', label: 'Back up to this PC', kind: 'run' },
        { id: 'restore', label: 'Restore from this PC', kind: 'run' },
        { id: 'diag', label: 'Diagnostics', kind: 'run' }
    ];

    /* Backup: your dock, hidden apps, app profiles, screensaver and Performance mode choices, watched / not interested
       lists and recent searches, sent to the PC running `npm run logs` (the same address Diagnostics reports go to).
       Restore reads the latest one back and restarts Settle. Never included: the Trakt sign-in, keys, or caches. */
    var KEEP = ['settle.dock.v1', 'settle.hide.v1', 'settle.profiles.v1', 'settle.screensaver.v1', 'settle.perf.v1', 'settle.hints.v1',
        'settle.wl.local', 'settle.watched.v1', 'settle.notinterested.v1', 'settle.search.recent.v1', 'settle.wall.topic.v1'].concat(window.Settle && window.Settle.nuvio ? [window.Settle.nuvio.key] : []);
    function pcUrl() {
        var u = ((window.LAUNCHER_CONFIG || {}).controlCenter || {}).logUrl;
        if (!u) throw new Error('Set logUrl in config.local.js (npm run setup)');
        return u.replace(/\/+$/, '') + '/backup';
    }
    function backup() {
        var keys = {};
        KEEP.forEach(function (k) { try { var v = localStorage.getItem(k); if (v != null) keys[k] = v; } catch (e) { /* skip */ } });
        var body = JSON.stringify({ settle: 1, at: new Date().toISOString(), keys: keys });
        return within(fetch(pcUrl(), { method: 'POST', body: body }), DEADLINE).then(function (r) {
            if (r.status !== 204) throw new Error('The PC said ' + r.status + '. Is npm run logs running?');
            return 'Saved on the PC';
        }, function () { throw new Error('No answer from the PC. Is npm run logs running?'); });
    }
    function restore() {
        return within(fetch(pcUrl()), DEADLINE).then(function (r) {
            if (r.status === 404) throw new Error('No backup on the PC yet');
            if (!r.ok) throw new Error('The PC said ' + r.status);
            return r.json();
        }, function () { throw new Error('No answer from the PC. Is npm run logs running?'); }).then(function (j) {
            if (!j || j.settle !== 1 || !j.keys) throw new Error('That isn’t a Settle backup');
            return new Promise(function (ok) {
                window.Settle.ask({ title: 'Restore Settle’s settings?', lines: [
                    'From the backup made ' + new Date(j.at).toLocaleString() + '.',
                    'Your dock, hidden apps, app profiles and other choices are replaced by the backup’s. Settle restarts afterwards.'
                ], yes: 'Restore', no: 'Cancel' }, function () {
                    KEEP.forEach(function (k) { try { if (j.keys[k] != null) localStorage.setItem(k, j.keys[k]); } catch (e) { /* skip */ } });
                    setTimeout(function () { location.reload(); }, 300);
                });
                ok(null);
            });
        });
    }
    /* Open in Nuvio: off unless you turn it on, and listed only when a Nuvio app is installed. Settle can't
       see whether Nuvio is set up, so turning it on is you saying it is. */
    function nuvio() { return (window.Settle && window.Settle.nuvio) || null; }
    function hasNuvio() { return !!(window.Platform && window.Platform.hasNuvio && window.Platform.hasNuvio() && nuvio()); }
    var SS = [[0, 'Off'], [120000, '2 min'], [300000, '5 min'], [600000, '10 min'], [1800000, '30 min']];
    function ssView() {
        var S = window.Screensaver;
        if (!S) return { value: 'Not available', current: null };
        var st = S.status(), hit = SS.filter(function (o) { return o[0] === st.ms; })[0];
        var v = hit ? hit[1] : Math.round(st.ms / 60000) + ' min';
        if (st.ms && st.known && !st.app) v = 'Aerial not installed';
        else if (st.ms && st.off) v = 'Off for now';
        return { value: v, current: String(st.ms) };
    }
    var IDLE = { wallpaper: { value: 'New photo', current: null }, recs: { value: 'Refresh', current: null }, diag: { value: 'Open', current: null }, backup: { value: 'Dock, profiles, choices', current: null }, restore: { value: 'Latest backup', current: null }, settle: { value: 'Screensaver, wallpaper', current: null } };

    function merge(m) { m = m || {}; Object.keys(IDLE).forEach(function (k) { m[k] = IDLE[k]; }); m.screensaver = ssView(); m.sleep = sleepView(); m.nuvio = { value: nuvio() && nuvio().wanted() ? 'On' : 'Off', current: null }; return m; }

    // Recent apps: opens the app switcher (the panel closes first). It goes after Input, where Wi-Fi used to be.
    var RECENT = { id: 'recent', label: 'Recent apps', kind: 'run' };
    IDLE.recent = { value: 'See what’s open', current: null };

    /* Sleep: now, or in 30 / 60 / 90 minutes (vetro.js sleepIn), or cancel a timer. The timer is kept on this TV with
       its end time; when Settle starts again it cancels a timer it finds, so a TV turned off and on again by hand is
       never switched off later by a timer from before. */
    var SLEEP_KEY = 'settle.sleep.v1';
    function sleepRec() { try { var s = JSON.parse(localStorage.getItem(SLEEP_KEY)); return s && s.end > Date.now() ? s : null; } catch (e) { return null; } }
    function setSleepRec(s) { try { if (s) localStorage.setItem(SLEEP_KEY, JSON.stringify(s)); else localStorage.removeItem(SLEEP_KEY); } catch (e) { /* silent */ } }
    function hhmm(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
    function sleepView() { var s = sleepRec(); return { value: s ? 'Turns off at ' + hhmm(s.end) : 'Turn the TV off', current: null }; }
    function sleepOptions() {
        var s = sleepRec(), o = [{ id: 'now', label: 'Now' }, { id: '30', label: 'In 30 minutes' }, { id: '60', label: 'In 1 hour' }, { id: '90', label: 'In 1 hour 30 minutes' }];
        if (s) o.push({ id: 'cancel', label: 'Cancel the timer (' + hhmm(s.end) + ')' });
        return o;
    }
    function sleepAct(base, arg) {
        var V = window.Vetro, s = sleepRec();
        if (arg === 'now') return base.act('sleep');
        var stop = s && V && V.cancelSleep ? V.cancelSleep(s.pid).catch(function () { /* already gone */ }) : Promise.resolve();
        if (arg === 'cancel') return stop.then(function () { setSleepRec(null); return 'Timer cancelled'; });
        var min = parseInt(arg, 10);
        if (!V || !V.sleepIn || [30, 60, 90].indexOf(min) < 0) return Promise.reject(new Error('Not available'));
        return stop.then(function () { return V.sleepIn(min); }).then(function (pid) {
            var end = Date.now() + min * 60000;
            setSleepRec({ pid: pid, end: end });
            return 'Turns off at ' + hhmm(end);
        });
    }
    (function () {                                                      // at startup: a timer from before goes
        var s = null; try { s = JSON.parse(localStorage.getItem(SLEEP_KEY)); } catch (e) { /* none */ }
        if (!s) return;
        setSleepRec(null);
        if (s.end > Date.now()) setTimeout(function () { if (window.Vetro && window.Vetro.cancelSleep) window.Vetro.cancelSleep(s.pid).catch(function () {}); }, 3000);
    })();

    function compose(base) {
        return {
            controls: function () {
                var c = base.controls().map(function (x) { return x.id === 'sleep' ? { id: 'sleep', label: 'Sleep', kind: 'choice' } : x; });
                var i = c.map(function (x) { return x.id; }).indexOf('input') + 1;
                return c.slice(0, i).concat([RECENT], c.slice(i), EXTRA);
            },
            page: function (id) {
                if (id !== 'settle') return base.page(id);
                return SETTLE_ROWS.filter(function (r) { return r.id !== 'nuvio' || hasNuvio(); })
                    .map(function (r) { return r.id === 'nuvio' ? { id: r.id, label: nuvio().label(), kind: r.kind } : r; });
            },
            options: function (id) { return id === 'sleep' ? sleepOptions() : id === 'screensaver' ? SS.map(function (o) { return { id: String(o[0]), label: o[1] }; }) : base.options(id); },
            cached: function () { return merge(base.cached()); },
            read: function () { return base.read().then(merge, function () { return merge(base.cached()); }); },
            act: function (id, arg) {
                if (id === 'sleep') return sleepAct(base, arg);
                if (id === 'screensaver') {
                    var ms = parseInt(arg, 10);
                    if (!SS.some(function (o) { return o[0] === ms; })) return Promise.reject(new Error('unknown choice'));
                    window.Screensaver.setTimeoutMs(ms);
                    return Promise.resolve();
                }
                if (id === 'perf') {
                    if (!window.Vetro || !window.Vetro.perfState) return Promise.reject(new Error('Not available'));
                    return window.Vetro.perfState().then(function (s) {
                        if (s === 'on') return window.Settle.setPerf(false).then(function () { return 'Off'; });
                        window.Settle.askPerf();                                  // the panel closes; the question opens
                        return null;
                    });
                }
                if (id === 'nuvio') {
                    if (!nuvio()) return Promise.reject(new Error('Not available'));
                    var on = !nuvio().wanted();
                    if (!nuvio().set(on)) return Promise.reject(new Error('Could not save this'));
                    return Promise.resolve(on ? 'On' : 'Off');
                }
                if (id === 'backup') return backup();
                if (id === 'restore') return restore();
                if (id === 'diag') {
                    if (!window.Settle || !window.Settle.openDiag) return Promise.reject(new Error('Not available'));
                    window.Settle.openDiag();
                    return Promise.resolve();
                }
                if (id === 'recent') {
                    if (!window.Settle || !window.Settle.openSwitcher) return Promise.reject(new Error('Not available'));
                    window.Settle.openSwitcher(true);
                    return Promise.resolve();
                }
                if (id === 'wallpaper') {
                    if (!window.Wallpaper) return Promise.reject(new Error('Not available'));
                    return within(window.Wallpaper.refreshNow(), DEADLINE).then(function () { return 'New photo set'; });
                }
                if (id === 'recs') {
                    if (!window.Recs || !window.Recs.refreshNow) return Promise.reject(new Error('Not available'));
                    return within(window.Recs.refreshNow(), DEADLINE).then(function () { if (window.AppInfo) window.AppInfo.invalidate(); return 'Refreshed'; });
                }
                return base.act(id, arg);
            }
        };
    }

    window.LauncherControls = { compose: compose };
})();
