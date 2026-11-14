/*
 * Idle screensaver: after a while with no remote input on the home screen, hand off to the Aerial Screensaver app
 * (installed separately). Tizen has no way for a sideloaded app to be the system screensaver, so this is our own
 * idle timer plus tizen.application.launch().
 *
 *   - The app is found in the app list Settle already has (an id or name containing "aerial"), or set in
 *     config.screensaver.appId. Not installed: the feature is off, logged once to the console.
 *   - One one-shot timer, re-armed by any key. It only runs while Settle is on screen, and not during the first
 *     90 s after start (a cold boot reaches the home screen late; nobody should get a screensaver before seeing it).
 *   - Before launching: Settle must be on the home screen with nothing open, and the network must answer (the app
 *     streams from Apple; offline it would only show black). Otherwise the timer starts over.
 *   - Loop guard: back from the screensaver, it needs a key press or 60 s before it can arm again. Back within 5 s
 *     of launching counts as a failed launch, and a launch error too: the feature is off for the rest of the session.
 */
(function () {
    'use strict';

    var C = window.LAUNCHER_CONFIG, CFG = C.screensaver || {}, KEY = 'settle.screensaver.v1';
    var ARM_AFTER = 90000, COOLDOWN = 60000, FAILED_MS = 5000, CDN = 'https://sylvan.apple.com/';
    var started = Date.now(), lastInput = Date.now(), timer = 0, launchedAt = 0, waitUntil = 0, off = '', logged = false;
    var log = [], dueAt = 0;
    function note(t) { log.push(new Date().toTimeString().slice(0, 8) + ' ' + t); if (log.length > 12) log.shift(); }
    var QUIET = [null, 'dock', 'rail', 'act', 'full', 'home'];          // home-screen states with nothing open

    function timeoutMs() {
        var v = null;
        try { v = JSON.parse(localStorage.getItem(KEY)); } catch (e) { v = null; }
        if (typeof v === 'number') return v;                              // chosen in the Control Center
        return typeof CFG.timeoutMs === 'number' ? CFG.timeoutMs : 120000;
    }
    function setTimeoutMs(ms) {
        try { localStorage.setItem(KEY, JSON.stringify(ms)); } catch (e) { /* silent */ }
        schedule();
    }

    // The Aerial app's id, or null. Says so once when the app list is in and there is no such app.
    function appId() {
        if (CFG.appId) return CFG.appId;
        var P = window.Platform, a = P && P.findApp ? P.findApp(/aerial/i) : null;
        if (!a && !logged && P && P.source && P.source() === 'live') { logged = true; console.info('[screensaver] no Aerial app is installed: the screensaver is off'); }
        return a ? a.id : null;
    }
    function listKnown() { var P = window.Platform; return !!CFG.appId || !!(P && P.source && P.source() !== 'none'); }

    function schedule() {
        clearTimeout(timer);
        var ms = timeoutMs();
        if (off || !ms || document.hidden) return;
        var at = Math.max(lastInput + ms, started + ARM_AFTER, waitUntil);
        dueAt = at;
        timer = setTimeout(fire, Math.max(1000, at - Date.now()));
    }

    function quiet() { var S = window.Settle && window.Settle.state; return !!S && QUIET.indexOf(S.zone) >= 0; }

    function reach(url) {
        return new Promise(function (ok) {
            var t = setTimeout(function () { ok(false); }, 4000);
            try { fetch(url, { mode: 'no-cors', cache: 'no-store' }).then(function () { clearTimeout(t); ok(true); }, function () { clearTimeout(t); ok(false); }); }
            catch (e) { clearTimeout(t); ok(false); }
        });
    }
    // Apple's video server first; if it does not answer a plain request, any Apple host proves the network is up.
    function online() {
        if (navigator.onLine === false) return Promise.resolve(false);
        return reach(CDN).then(function (up) { return up || reach('https://www.apple.com/'); });
    }

    function again() { lastInput = Date.now(); schedule(); }               // start the wait over

    function fire() {
        if (off || document.hidden) { note('due, but ' + (off ? 'off: ' + off : 'not on screen')); return; }
        var id = appId();
        if (!id) { note('due, but no Aerial app found'); if (listKnown() && window.Platform.source() === 'live') return; return again(); }   // no app: off; list not in yet: later
        if (!quiet()) { note('due, but busy (' + window.Settle.state.zone + '): waiting again'); return again(); }   // something is open: not now
        note('due: checking the network');
        online().then(function (up) {
            if (!up) { note('network did not answer: waiting again'); return again(); }   // offline: the next cycle
            if (off || document.hidden || !quiet() || Date.now() - lastInput < timeoutMs()) { note('a key or a screen change meanwhile: waiting again'); return schedule(); }
            note('launching ' + id);
            launchedAt = Date.now();
            window.Platform.launch(id, function (e) {
                launchedAt = 0;
                off = 'launch failed: ' + ((e && e.name) || 'Error') + ': ' + ((e && e.message) || e);
                console.error('[screensaver] ' + off + ' (off for this session)');
            });
            setTimeout(function () {                                          // accepted, but nothing came up in front of us
                if (launchedAt && !document.hidden) {
                    launchedAt = 0;
                    off = 'the screensaver app did not come up';
                    console.warn('[screensaver] ' + off + ': off for this session');
                }
            }, FAILED_MS);
        });
    }

    document.addEventListener('keydown', function () { lastInput = Date.now(); waitUntil = 0; schedule(); }, true);
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { clearTimeout(timer); return; }                 // inside another app: not counting
        if (launchedAt) {
            var back = Date.now() - launchedAt;
            launchedAt = 0;
            if (back < FAILED_MS) {
                off = 'the screensaver came straight back after ' + back + ' ms';
                console.warn('[screensaver] ' + off + ': off for this session');
                return;
            }
            waitUntil = Date.now() + COOLDOWN;                                // a key press, or 60 s, before it can arm again
        }
        lastInput = Date.now();
        schedule();
    });
    window.addEventListener('load', schedule);

    window.Screensaver = {
        timeoutMs: timeoutMs, setTimeoutMs: setTimeoutMs,
        status: function () { return { app: appId(), off: off, ms: timeoutMs(), known: listKnown(), dueIn: dueAt && !off ? Math.round((dueAt - Date.now()) / 1000) : null, log: log.slice() }; }
    };
})();
