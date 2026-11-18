/* ---------- clock & ambient (one timeout, re-armed, never under 1 s) ---------- */

var clockT = 0, lastDate = '', hhs = document.querySelectorAll('.hh'), mms = document.querySelectorAll('.mm');
var wxText = '', wxShort = '', wxKind = 'moon';

function setWeather(long, short, kind) {
    wxText = long; wxShort = short; wxKind = kind || wxKind;
    var ic = WX_ICONS[wxKind];
    $('wx-rest').children[0].innerHTML = ic;
    $('wx-rest').children[1].textContent = long;
    $('al-i').innerHTML = ic;
    $('al-w').textContent = short;
    $('wx-full').children[0].innerHTML = ic;
    $('wx-full').children[1].textContent = long;
}

function tick() {
    var d = new Date(), hh = ('0' + d.getHours()).slice(-2), mm = ('0' + d.getMinutes()).slice(-2), i;
    for (i = 0; i < hhs.length; i++) { hhs[i].textContent = hh; mms[i].textContent = mm; }
    var key = d.toDateString();
    if (key !== lastDate) {
        lastDate = key;
        var L = C.locale;
        $('date-rest').textContent = d.toLocaleDateString(L, { weekday: 'long' }) + ', ' + d.toLocaleDateString(L, { day: 'numeric', month: 'long' });
        $('date-full').textContent = $('date-rest').textContent;
        $('al-d').textContent = d.toLocaleDateString(L, { weekday: 'short' }) + ' ' + d.toLocaleDateString(L, { day: 'numeric', month: 'short' });
    }
    clockT = setTimeout(tick, Math.max(1000, 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50));
}

/* ---------- launch and return animations ---------- */
var fx = $('launchfx'), fxEl = null, fxUndo = 0, retT = 0;
function focusedCell() {
    if (S.zone === 'dock') return dCells[S.di];
    if (S.zone === 'apps') return aCells[aSel];
    if (S.zone === 'sw') return swCells[swSel];
    if (S.zone === 'rail' || S.zone === 'act') return pCells[S.ri];
    return null;
}
// Plays the launch animation, then go(). If the app never takes the screen, the launcher comes back after 2.5 s.
function launchFx(go) {
    var el = focusedCell();
    if (fxEl) fxEl.classList.remove('launching');
    fxEl = el; if (el) el.classList.add('launching');
    fx.classList.add('on');
    clearTimeout(fxUndo);
    fxUndo = setTimeout(function () { if (!document.hidden) returnFx(); }, 2500);
    setTimeout(go, 190);
}
function returnFx() {
    clearTimeout(fxUndo);
    if (fxEl) { fxEl.classList.remove('launching'); fxEl = null; }
    fx.classList.remove('on');
    stage.classList.remove('returning'); void stage.offsetWidth; stage.classList.add('returning');
    clearTimeout(retT); retT = setTimeout(function () { stage.classList.remove('returning'); }, 260);
}
// Every launch goes through here: the dock, All apps, the rail, Samsung Home, the screensaver.
(function () {
    var rawLaunch = P.launch, rawProvider = P.launchProvider, rawFirst = P.launchFirst;
    P.launch = function (id, onFail) {
        if (!id) return rawLaunch(id, onFail);
        launchFx(function () { rawLaunch(id, function (e) { returnFx(); if (onFail) onFail(e); }); });
    };
    P.launchProvider = function (name) { launchFx(function () { rawProvider(name); }); };
    // A rail title: its deep link when JustWatch has one for the app (asked at most 2 s, usually already fetched
    // when the buttons or the details were shown), else the app's home screen as before.
    launchTitle = function (r) {
        launchFx(function () {
            clearTimeout(fxUndo);
            var find = window.DeepLinks ? window.DeepLinks.find(r, 2000) : Promise.resolve(null);
            find.then(function (dl) {
                fxUndo = setTimeout(function () { if (!document.hidden) returnFx(); }, 2500);
                if (!dl) return rawProvider(r.provider);
                P.launchDeep(dl.app, dl.data).catch(function () { rawProvider(r.provider); });
            });
        });
    };
    P.launchFirst = function (ids) {
        return new Promise(function (ok, no) { launchFx(function () { rawFirst(ids).then(ok, function (e) { returnFx(); no(e); }); }); });
    };
})();

document.addEventListener('visibilitychange', function () {
    clearTimeout(clockT); clearTimeout(idleT); clearTimeout(holdT); setPressing(null);
    // Search open: Samsung's on-screen keyboard makes the page hidden and visible again as it opens and closes. That is
    // not another app, so nothing is reset and it never counts as a Home press.
    if (S.zone === 'srch') { homeLog('keyboard'); if (!document.hidden) { tick(); armIdle(); } return; }
    if (document.hidden) {
        blurAt = 0; homeLog('hidden');
        // Another app has the screen: go to rest now rather than on return, so the backdrop picture, the All apps grid
        // and any open panel are let go while that app runs (Settle keeps running in the background for trailers).
        if (S.zone !== 'trk' && !(S.zone === 'sw' && Date.now() - swOpenedAt < 1500)) toRest();   // (not the tail of the double Home)
        return;
    }
    returnFx();
    tick();
    homePressed('visible');
    if (S.zone === 'trk') return;    // mid-login (e.g. approving in another tab): stay on the code screen
    if (S.zone === 'sw' && Date.now() - swOpenedAt < 1500) { armIdle(); return; }   // the tail of the double Home that opened it
    toRest();                        // coming back from another app: start at rest
    (window.onWake || []).forEach(function (fn) { try { fn(); } catch (e) { /* silent */ } });
});

/* Launched with the extra  cc=1  (for example from a Vetro Remapper rule that runs
   app_launcher -s SettleTv01.Settle cc 1): open the Control Center. Works on a cold start and when already running. */
function wantsCC(ac) {
    try { return (ac && ac.appControl && ac.appControl.data || []).some(function (d) { return d.key === 'cc' && String(d.value && d.value[0]) === '1'; }); } catch (e) { return false; }
}
function launchCC() {
    setTimeout(function () {                                   // after the wake-from-background reset to rest
        if (['trk', 'diag', 'sheet', 'move', 'src', 'cc'].indexOf(S.zone) < 0) openCC();
    }, 400);
}
try {
    window.addEventListener('appcontrol', function () {
        try { if (wantsCC(window.tizen.application.getCurrentApplication().getRequestedAppControl())) launchCC(); else homePressed(); } catch (e) { /* not on a TV */ }
    });
    if (wantsCC(window.tizen.application.getCurrentApplication().getRequestedAppControl())) window.addEventListener('load', launchCC);
} catch (e) { /* not on a TV */ }

// Samsung's on-screen keyboard makes the window shorter while it is open: ignored, so the layout keeps its size and the
// keyboard simply sits over the bottom of the screen (re-fitted when typing ends).
function fit() {
    if (document.activeElement === srIn) return;
    var s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = s === 1 ? '' : 'translate(' + ((innerWidth - 1920 * s) / 2) + 'px,' + ((innerHeight - 1080 * s) / 2) + 'px) scale(' + s + ')';
}
window.addEventListener('resize', fit);
fit();
