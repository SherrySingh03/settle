var idleT = 0;
function armIdle() {
    clearTimeout(idleT);
    idleT = setTimeout(toRest, C.idleMs);
}
function toRest() {
    if (S.zone === 'cc') { cc.close(); stage.classList.remove('cc-open'); S.zone = ccReturn; }
    if (S.zone === 'sheet') { $('sheet').classList.remove('open'); setOn('sh', null); S.zone = 'apps'; }
    if (S.zone === 'move') { applyDock(); S.zone = 'dock'; }
    if (S.zone === 'apps') teardownApps();
    if (S.zone === 'sw') closeSwitcher(false);
    if (S.zone === 'diag') $('diag').classList.remove('open');
    if (S.zone === 'rate') { $('rate').classList.remove('open'); RT = null; }
    if (S.zone === 'dt') { stage.classList.remove('dt-open'); $('dt').classList.remove('open'); setOn('dt', null); DT = null; }
    if (S.zone === 'trk') { window.Trakt.cancel(); closeTrakt(); }   // app was hidden: the code flow was cancelled
    if (S.zone === 'src') { $('sources').classList.remove('open'); setOn('s', null); }
    if (S.zone === 'srch') { srIn.blur(); $('srch').classList.remove('open'); setOn('sr', null); }
    if (S.zone === 'ask') { $('ask').classList.remove('open'); setOn('ask', null); ASK = null; }
    S.zone = null;
    paint();
}

// A hold is a timer started on key-down and cancelled on key-up: it does not rely on the remote repeating the key.
var HOLD_MS = 650, okHold = null, holdT = 0;
function holdFire() {
    var hd = okHold;
    if (!hd || hd.done || S.zone !== hd.z) return;
    hd.done = true;
    setPressing(null);
    if (hd.z === 'dock') startMove(); else openSheet(aItems[aSel]);
}
function actOnTile() {                                          // the contextual action of the blue key
    if (S.zone === 'dock' && S.di < dockItems.length) startMove();
    else if (S.zone === 'apps' && aItems.length) openSheet(aItems[aSel]);
}
function okOn() { return (S.zone === 'dock' && S.di < dockItems.length) || (S.zone === 'apps' && aItems.length > 0); }

document.addEventListener('keyup', function (e) {                // tap OK = open the app; a hold was already handled on keydown
    if (KEYS[e.keyCode] !== 'OK' || !okHold) return;
    clearTimeout(holdT); setPressing(null);
    var hold = okHold; okHold = null;
    if (hold.done) return;
    if (hold.z === 'dock' && S.zone === 'dock') { var it = dockItems[S.di]; if (it && it.placeholder && !it.id) toast('Still reading the app list…'); else if (it) P.launch(it.id, function (e) { toast('Could not open ' + it.label + ': ' + (e.name || 'Error') + ': ' + (e.message || e)); }); }
    else if (hold.z === 'apps' && S.zone === 'apps' && aItems[aSel]) P.launch(aItems[aSel].id);
});

/* Play/Pause: one press = Control Center, double press = Diagnostics; a hold also opens it where the remote reports one (Red and Yellow still work as well).
   The TV does not repeat keys, so a hold is a timer started on keydown and cancelled on keyup. */
// Every key event, mapped or not, is noted for Diagnostics: to see what a remote button really sends.
var keyLog = window.__keyLog = [], keyT = 0;
function logKey(e, mark) {
    var now = Date.now();
    keyLog.push(e.keyCode + mark + (e.repeat ? 'r' : '') + '+' + (keyT ? Math.min(now - keyT, 99999) : 0));
    keyT = now;
    if (keyLog.length > 40) keyLog.shift();
    if (S.zone === 'diag' && window.Diag) window.Diag.repaint();
}
// A stuck key: the same arrow arriving again and again with no key-up between (seen on this TV: a Right key-up came
// 7.6 s after its key-down). A person's taps always have a key-up, so they never trip this. Past 12 in a row the rest
// are dropped until a key-up, so focus cannot run away.
var runaway = { code: 0, n: 0, t: 0 }, ARROWS = [37, 38, 39, 40];
window.__runaway = 0;
document.addEventListener('keydown', function (e) {
    logKey(e, 'v');
    var now = Date.now();
    runaway.n = (e.keyCode === runaway.code && now - runaway.t < 600) ? runaway.n + 1 : 1;
    runaway.code = e.keyCode; runaway.t = now;
    if (runaway.n > 12 && ARROWS.indexOf(e.keyCode) >= 0) { window.__runaway++; e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
document.addEventListener('keyup', function (e) { logKey(e, '^'); if (e.keyCode === runaway.code) runaway.n = 0; }, true);

var pp = { down: false, held: false, last: 0, timer: 0 };
function ccToggle() {
    if (S.zone === 'cc') return closeCC();
    if (['trk', 'diag', 'sheet', 'move', 'src', 'rate', 'sw', 'dt', 'srch', 'ask'].indexOf(S.zone) < 0) openCC();
}
function diagToggle() {
    if (S.zone === 'diag') { $('diag').classList.remove('open'); S.zone = 'dock'; armIdle(); paint(); return; }
    if (['trk', 'src', 'apps', 'sheet', 'move', 'cc'].indexOf(S.zone) >= 0) return;
    openDiag();
}
// Diagnostics (Yellow, or a double Play/Pause): diag.js is loaded the first time it is opened.
function openDiag() {
    if (!window.Diag) { need(['js/diag.js'], function () { if (window.Diag && S.zone !== 'diag') openDiag(); }); return; }
    clearTimeout(idleT);
    S.zone = 'diag';
    window.Diag.show($('d-body'), dockItems);
    $('diag').classList.add('open');
}
document.addEventListener('keyup', function (e) {
    if (KEYS[e.keyCode] !== 'P' || !pp.down) return;
    pp.down = false; clearTimeout(pp.timer);
    if (pp.held) return;                                             // the hold already opened or closed the panel
    var now = Date.now();
    // This remote sends down and up together (a hold cannot be told from a tap), so: two quick presses = Control Center.
    if (pp.last && now - pp.last < 450) { pp.last = 0; ccToggle(); } else pp.last = now;
});

var quickKey = false, lastKeyAt = 0, BOX_KEYS = [38, 40, 13, 10009, 27, 65376, 65385];
document.addEventListener('keydown', function (e) {
    window.__lastKey = e.keyCode;
    if (document.activeElement === srIn && BOX_KEYS.indexOf(e.keyCode) < 0) { armIdle(); return; }   // typing, Left/Right, Backspace: the box's own                                  // shown on the diagnostics screen (to check a remapped button)
    var d = KEYS[e.keyCode];
    if (!d) return;
    e.preventDefault();
    if (d === 'P') {
        if (e.repeat || pp.down) return;
        pp.down = true; pp.held = false;
        clearTimeout(pp.timer);
        pp.timer = setTimeout(function () { if (pp.down) { pp.held = true; pp.last = 0; ccToggle(); } }, HOLD_MS);
        return;
    }
    stage.classList.toggle('fast', !!e.repeat);
    var now = Date.now(); quickKey = now - lastKeyAt < 170; lastKeyAt = now;     // see paint(): quick presses defer the hero
    if (d === 'H') { if (MOCK) homePressed(); return; }                // preview only: on the TV, Home arrives as appcontrol
    if (S.zone === 'diag') {                                        // Back closes; nothing else moves
        if (d === 'B' || d === 'Y') { $('diag').classList.remove('open'); S.zone = 'dock'; armIdle(); paint(); }
        else if (d === 'OK') window.Diag.capture($('d-body'));
        return;
    }
    if (S.zone === 'ask') { armIdle(); askKey(d); return; }
    if (S.zone === 'rate') { armIdle(); clearTimeout(idleT); rateKey(d); return; }
    if (S.zone === 'dt' && d !== 'Y' && d !== 'C' && d !== 'G') { armIdle(); dtKey(d); return; }
    if (S.zone === 'srch' && d !== 'C' && d !== 'G' && d !== 'Y') { armIdle(); searchKey(d); return; }
    if (d === 'Y') {
        if (S.zone === 'trk' || S.zone === 'src' || S.zone === 'apps' || S.zone === 'sheet' || S.zone === 'move' || S.zone === 'sw' || S.zone === 'dt' || S.zone === 'srch') return;
        openDiag();
        return;
    }
    if (d === 'C') {                                                                      // the Control Center key opens and closes the panel
        if (S.zone === 'cc') return closeCC();
        if (['trk', 'diag', 'sheet', 'move', 'src', 'sw', 'dt', 'srch', 'ask'].indexOf(S.zone) < 0) openCC();
        return;
    }
    if (S.zone === 'cc') { armIdle(); cc.handleKey(d); return; }
    if (d === 'G') { if (S.zone === 'sw') closeSwitcher(); else openSwitcher(); return; }   // green: the app switcher
    if (S.zone === 'sw') { armIdle(); return swKey(d); }
    // OK on a dock app or an All apps tile is decided on release (tap = open) or by holding (move / options).
    if (d === 'OK' && e.repeat && !(okHold && !okHold.done)) return;                 // a held OK never repeats an action
    if (d === 'OK' && okOn()) {
        armIdle();
        if (!e.repeat) {
            okHold = { z: S.zone, t: Date.now(), done: false };
            clearTimeout(holdT);
            holdT = setTimeout(holdFire, HOLD_MS);
            setPressing(S.zone === 'dock' ? dCells[S.di] : aCells[aSel]);
            return;
        }
        if (okHold && !okHold.done && Date.now() - okHold.t >= HOLD_MS) holdFire();     // a remote that does repeat: same result
        return;
    }
    if (d === 'E' && (S.zone === 'dock' || S.zone === 'apps')) { armIdle(); actOnTile(); return; }     // blue key: move / options, no holding needed
    if (S.zone === 'move') { armIdle(); return moveKey(d); }
    if (S.zone === 'sheet') { armIdle(); return sheetKey(d); }
    if (S.zone === 'apps') { armIdle(); return appsKey(d); }
    if (d === 'E') { actOnTile(); return; }
    if (S.zone === 'full') { if (d === 'U') { openSearch(); return; } S.zone = 'dock'; armIdle(); paint(); return; }   // Up again: Search; any other key comes back
    if (S.zone !== 'trk') armIdle();
    if (S.zone === 'trk') return trkKey(d);
    if (S.zone === 'src') return srcKey(d);
    if (S.zone === null) {
        if (d === 'B') return P.exit();
        S.zone = 'dock'; return paint();
    }
    if (S.zone === 'dock') dockKey(d);
    else if (S.zone === 'rail') railKey(d);
    else if (S.zone === 'home') homeKey(d);
    else actKey(d);
});
