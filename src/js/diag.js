/*
 * Diagnostics screen (yellow remote key; "d" in the desktop preview). Shows what the TV actually
 * reports, so on-device questions get answered by looking instead of guessing:
 * display scale, whether Archivo's width axis applies, memory, and every dock app's icon path
 * and load result. Built only when opened and removed when closed.
 */
(function () {
    'use strict';

    function tail(s, n) { s = String(s || ''); return s.length > n ? '…' + s.slice(s.length - n + 1) : s; }
    function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

    function fontLine() {
        var t = document.createElement('span');
        t.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;font:600 48px Archivo,sans-serif';
        t.textContent = 'WIDTH TEST Monsoon 0123';
        document.body.appendChild(t);
        var w = {};
        [75, 100, 125].forEach(function (p) { t.style.fontStretch = p + '%'; w[p] = t.offsetWidth; });
        document.body.removeChild(t);
        var loaded = document.fonts && document.fonts.check('24px Archivo');
        return 'Archivo ' + (loaded ? 'loaded' : 'NOT loaded') + ' · width 75% = ' + w[75] + 'px, 100% = ' + w[100] + 'px, 125% = ' + w[125] + 'px · ' +
            (w[125] > w[75] + 20 ? 'axis WORKS (distinct)' : 'axis NOT applied (identical)');
    }

    function lines(items, extra) {
        var L = [], ua = navigator.userAgent.match(/(Chrome|Tizen|SMART-TV)[^ ;)]*/g) || [], m = window.performance && performance.memory;
        L.push('Display   window ' + innerWidth + 'x' + innerHeight + ' · screen ' + screen.width + 'x' + screen.height + ' · devicePixelRatio ' + devicePixelRatio);
        if (extra.display) L.push('Panel     ' + extra.display);
        L.push('Engine    ' + ua.join(' '));
        L.push('Font      ' + fontLine());
        L.push('Memory    ' + (m ? 'JS heap ' + (m.usedJSHeapSize / 1048576).toFixed(1) + ' MB of ' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + ' MB limit' : 'JS heap n/a') +
            (navigator.deviceMemory ? ' · deviceMemory ' + navigator.deviceMemory + ' GB' : ''));
        var w = document.getElementById('wall');
        L.push('Wallpaper ' + w.naturalWidth + 'x' + w.naturalHeight + ' · ' + (w.src.indexOf('blob:') === 0 ? 'daily photo (cached)' : 'bundled fallback'));
        L.push('Rail      ' + (window.Settle ? window.Settle.recs().length : 0) + ' items · Trakt ' + (window.Trakt && window.Trakt.connected() ? 'connected' : 'not connected'));
        L.push('Vetro     ' + (extra.vetro || 'checking…') + ' · last key code ' + (window.__lastKey == null ? 'none yet' : window.__lastKey));
        L.push('Keys      ' + ((window.__keyLog || []).slice(-14).join('  ') || 'none yet') + '   (v down, ^ up, +ms since previous, r repeat)' + (window.__runaway ? ' · stuck-key repeats dropped: ' + window.__runaway : ''));
        if (window.Screensaver) { var ss = window.Screensaver.status(); L.push('Screensaver ' + (!ss.ms ? 'off (timeout 0)' : (ss.app ? ss.app + ' after ' + Math.round(ss.ms / 60000) + ' min' : (ss.known ? 'no Aerial app installed' : 'waiting for the app list'))) + (ss.off ? ' · OFF this session: ' + ss.off : '') + (ss.dueIn != null ? ' · due in ' + ss.dueIn + ' s' : '')); ss.log.slice(-4).forEach(function (x) { L.push('    ' + x); }); }
        L.push('Build     ' + (window.SETTLE_BUILD || 'unknown'));
        var ps = window.Platform.appStats();
        L.push('All apps  list from ' + ({ live: 'Tizen (live)', cache: 'cache (live list not in yet)', none: 'nowhere yet: favourites shown, retrying' }[window.Platform.source ? window.Platform.source() : 'live']) + ' · ' + ps.shown + ' shown · ' + ps.hidden.length + ' hidden' + (ps.hidden.length ? ': ' + ps.hidden.slice(0, 6).join(', ') + (ps.hidden.length > 6 ? ', …' : '') : ''));
        if (window.Vetro && window.Vetro.trace) { var tr = window.Vetro.trace(); if (tr.length) { L.push('Last Vetro setter calls:'); tr.forEach(function (t) { L.push('    ' + tail(t, 170)); }); } }
        ((window.Platform.errors && window.Platform.errors()) || []).forEach(function (e) { L.push('  ! ' + e.t + ' ' + e.kind + (e.id ? ' ' + e.id : '') + ' -> ' + e.name + ': ' + e.message); });
        L.push('');
        L.push('Dock icons (status · path from the TV)');
        var st = (window.Icons && window.Icons.status) || {};
        items.forEach(function (a) {
            L.push(pad(a.label, 13) + pad(st[a.id] || (a.icon ? 'pending' : 'no iconPath'), 28) + tail(a.icon || '(none reported)', 62));
            if (/FAIL/.test(st[a.id] || '')) ((window.Icons.tried || {})[a.id] || []).slice(0, 8).forEach(function (t) { L.push('    ' + tail(t, 110)); });
        });
        return L;
    }

    var lastItems = [], repaintFn = null;
    function show(el, items) {
        lastItems = items;
        var extra = {};
        function paint() { el.textContent = lines(items, extra).join('\n'); }
        repaintFn = paint;
        paint();
        if (window.Vetro) window.Vetro.probe().then(function (r) { extra.vetro = r; paint(); }, function () { extra.vetro = 'probe failed'; paint(); });
        try {
            tizen.systeminfo.getPropertyValue('DISPLAY', function (d) {
                extra.display = d.resolutionWidth + 'x' + d.resolutionHeight + ' physical';
                paint();
            }, function () {});
        } catch (e) { /* not on a TV */ }
    }

    // Every installed app, hidden ones included: the TV's own settings and network screens are apps too.
    function installedApps() {
        return new Promise(function (ok) {
            var t = setTimeout(function () { ok('(timed out)'); }, 4000);
            try {
                window.tizen.application.getAppsInfo(function (list) {
                    clearTimeout(t);
                    ok(list.map(function (a) { return a.id + ' | ' + a.name; }).sort().join('\n'));
                }, function () { clearTimeout(t); ok('(not available)'); });
            } catch (e) { clearTimeout(t); ok('(not available)'); }
        });
    }

    // OK on this screen: run the read-only Vetro capture and send it to the PC log receiver (controlCenter.logUrl).
    var capturing = false;
    function capture(el) {
        if (capturing || !window.Vetro) return;
        capturing = true;
        var base = el.textContent.split('\n\nCAPTURE')[0];
        function status(s) { el.textContent = base + '\n\nCAPTURE  ' + s; }
        status('running…');
        window.Vetro.capture(function (t) { status('running: ' + t); }).then(function (report) {
            var pe = ((window.Platform.errors && window.Platform.errors()) || []).map(function (e) { return e.t + ' ' + e.kind + ' ' + e.id + ' -> ' + e.name + ': ' + e.message; }).join('\n') || '(none)';
            return installedApps().then(function (apps) { var ssr = window.Screensaver ? window.Screensaver.status() : null;
            report = 'Build: ' + (window.SETTLE_BUILD || 'unknown') + '\n' + (ssr ? 'Screensaver: app ' + ssr.app + ' · timeout ' + ssr.ms / 1000 + ' s · off: ' + (ssr.off || 'no') + ' · due in ' + ssr.dueIn + ' s\n  ' + (ssr.log.join('\n  ') || '(nothing logged yet)') + '\n' : '') + report;
            return report + '\n##### App list / launch errors\nlist from: ' + (window.Platform.source ? window.Platform.source() : '?') + '\n' + pe + '\n\n##### Installed apps (id | name)\n' + apps + '\n'; });
        }).then(function (report) {
            var url = (window.LAUNCHER_CONFIG.controlCenter || {}).logUrl;
            if (!url) { status('done (' + report.length + ' chars) but controlCenter.logUrl is not set, so nothing was sent'); return; }
            return fetch(url, { method: 'POST', mode: 'no-cors', body: report }).then(function () {
                status('sent ' + report.length + ' chars to ' + url + ' (check the PC window)');
            }, function (e) { status('could not reach ' + url + ': ' + e.message); });
        }).then(function () { capturing = false; }, function () { capturing = false; });
    }

    // keys 1-3 try one AI setting each, 0 puts them back; the TV's answer is listed under 'Last Vetro setter calls'
    function experiment(el, n) {
        if (capturing || !window.Vetro || !window.Vetro.experiment) return;
        capturing = true;
        el.textContent += '\n\nEXPERIMENT ' + n + ' running…';
        window.Vetro.experiment(n).then(function () { capturing = false; show(el, lastItems); }, function () { capturing = false; });
    }

    window.Diag = { show: show, capture: capture, experiment: experiment, repaint: function () { if (repaintFn) repaintFn(); } };
})();
