/* App switcher: the apps still open in the background, most recent first. OK returns to one, Up closes it, Back
   goes home. Free memory (from Vetro, when it is up) sits in the corner and is read again after every close. */
var swItems = [], swCells = [], swSel = 0, swBusy = false, swOpening = false, swMemT = 0, swMemLast = 0;
function openSwitcher() {
    if (swOpening || S.zone === 'sw' || ['trk', 'diag', 'sheet', 'move', 'src', 'cc', 'rate', 'dt', 'srch', 'ask'].indexOf(S.zone) >= 0) return;
    swOpening = true;
    P.running().then(function (list) {
        swOpening = false;
        if (!list.length) { toast('Nothing open. Everything’s tucked in'); return; }
        if (S.zone === 'apps') teardownApps();
        swItems = list; swSel = 0; swBusy = false;
        buildSwitcher();
        clearTimeout(holdT); setPressing(null); okHold = null;
        S.zone = 'sw'; armIdle();
        $('sw').classList.add('open');
        paint(); swPaint();
        swMemLast = 0; $('sw-mem').classList.remove('on'); swMem(0);
    }, function (e) { swOpening = false; toast('Could not list the open apps: ' + ((e && e.name) || 'Error') + ': ' + ((e && e.message) || e)); });
}
function buildSwitcher() {
    var row = $('sw-row');
    row.textContent = ''; swCells = [];
    swItems.forEach(function (x) {
        var c = h('div', 'cell swcell'), t = h('div', 'tile swtile');
        paintTile(t, x.it);
        c.appendChild(t); c.appendChild(h('div', 'swlbl', x.it.label)); c.appendChild(h('div', 'swsub', ago(P.launchedAt(x.it.id))));
        row.appendChild(c); swCells.push(c);
    });
    var all = h('div', 'cell swcell swall'), at = h('div', 'tile swtile');
    at.innerHTML = '<svg width="56" height="56" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg><span>Close all</span>';
    all.appendChild(at);
    all.appendChild(h('div', 'swlbl'));
    all.appendChild(h('div', 'swsub', 'Frees up memory'));
    row.appendChild(all); swCells.push(all);
    swCount();
}
// "Opened 12 min ago" for an app opened from Settle; one started some other way has no time here.
function ago(t) {
    if (!t) return 'Running in the background';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'Opened just now';
    if (m < 60) return 'Opened ' + m + ' min ago';
    var hr = Math.round(m / 60);
    return hr < 24 ? 'Opened ' + hr + ' h ago' : 'Opened ' + Math.round(hr / 24) + ' d ago';
}
function swCount() { swCells[swCells.length - 1].children[1].textContent = swItems.length === 1 ? '1 app' : swItems.length + ' apps'; }
function swPaint() {
    var c = swCells[swSel];
    setOn('sw', c);
    $('sw-row').style.transform = 'translateX(' + (960 - c.offsetLeft - c.offsetWidth / 2) + 'px)';
}
// Free memory; never waited on. Vetro down or unreadable: the corner stays empty.
function swMem(delay) {
    if (!window.Vetro || !window.Vetro.memAvailable) return;
    clearTimeout(swMemT);
    swMemT = setTimeout(function () {
        window.Vetro.memAvailable().then(function (mb) {
            if (S.zone !== 'sw') return;
            var d = swMemLast ? mb - swMemLast : 0;
            $('sw-mem').textContent = 'Free memory ' + mb + ' MB' + (d > 0 ? '  (+' + d + ')' : '');
            $('sw-mem').classList.add('on');
            swMemLast = mb;
        }, function () { $('sw-mem').classList.remove('on'); });
    }, delay);
}
function closeSwitcher(toDock) {
    $('sw').classList.remove('open');
    setOn('sw', null);
    clearTimeout(swMemT);
    if (toDock === false) return;
    S.zone = 'dock'; armIdle();
    paint();
}
// Close the app at i. Resolves true when it is gone (the card leaves, focus goes to its neighbour).
function swClose(i) {
    var x = swItems[i];
    return P.kill(x.ctx, x.it.id).then(function () {
        var cell = swCells[i];
        swItems.splice(i, 1); swCells.splice(i, 1);
        cell.classList.add('gone');
        return new Promise(function (ok) {
            setTimeout(function () {
                if (cell.parentNode) cell.parentNode.removeChild(cell);
                if (S.zone === 'sw') {
                    if (!swItems.length) { closeSwitcher(); toast('All apps closed'); }
                    else { if (swSel > i || swSel >= swItems.length) swSel = Math.max(0, Math.min(swSel - (swSel > i ? 1 : 0), swItems.length - 1)); swCount(); swPaint(); }
                }
                swMem(700);
                ok(true);
            }, 170);
        });
    }, function (e) {
        toast('Could not close ' + x.it.label + ': ' + ((e && e.name) || 'Error') + ': ' + ((e && e.message) || e));
        return false;
    });
}
function swCloseAll() {
    var i = 0;
    swBusy = true;
    (function next() {
        if (S.zone !== 'sw' || i >= swItems.length) { swBusy = false; return; }
        swSel = i;
        swClose(i).then(function (gone) { if (!gone) i++; next(); });
    })();
}
function swKey(d) {
    if (d === 'B') return closeSwitcher();
    if (swBusy) return;
    var last = swCells.length - 1;
    if (d === 'L') { if (swSel > 0) swSel--; else bump(swCells[swSel], -1, 0); }
    else if (d === 'R') { if (swSel < last) swSel++; else bump(swCells[swSel], 1, 0); }
    else if ((d === 'OK' || d === 'U') && swSel === last) return swCloseAll();
    else if (d === 'U') { swBusy = true; swClose(swSel).then(function () { swBusy = false; }); return; }
    else if (d === 'OK') { var x = swItems[swSel]; P.launch(x.it.id, function (e) { toast('Could not open ' + x.it.label + ': ' + (e.name || 'Error') + ': ' + (e.message || e)); }); return; }
    swPaint();
}

// Home pressed twice opens (or closes) the switcher. Settle never sees the Home key: Vetro's remap rule turns it into
// "launch Settle", which reaches Settle as an appcontrol event and/or as the page becoming visible again (when the
// TV's own home flashes up first). Either counts as a press; two signals within 150 ms are the same press. Every
// signal is written to the key log (Diagnostics, captures) as  home:<kind>+<ms since the previous one>.
var homeAt = 0, homeN = 0, homeT = 0, swOpenedAt = 0;
function homeLog(kind) {
    var now = Date.now();
    keyLog.push('home:' + kind + '+' + (homeAt ? Math.min(now - homeAt, 99999) : 0));
    if (keyLog.length > 40) keyLog.shift();
}
// Samsung's home may only lay itself over Settle (Settle loses focus but stays visible): focus coming back within
// 5 s of losing it counts as a press too.
var blurAt = 0;
window.addEventListener('blur', function () { blurAt = document.hidden ? 0 : Date.now(); homeLog('blur'); });   // hidden: that return counts as "visible"
window.addEventListener('focus', function () {
    var back = blurAt && Date.now() - blurAt < 5000;
    blurAt = 0;
    if (!document.hidden && $('launchfx').classList.contains('on') && !homeTrying) returnFx();   // an overlay app (e.g. Samsung's home) was closed
    if (back && !document.hidden && S.zone !== 'srch') homePressed('focus'); else homeLog('focus');   // (the search keyboard is not a Home press)
});
function homePressed(kind) {
    var now = Date.now();
    homeLog(kind || 'appcontrol');
    if (homeAt && now - homeAt < 150) { homeAt = now; return; }        // the same press, seen twice
    homeN = (homeAt && now - homeAt < 1200) ? homeN + 1 : 1;
    homeAt = now;
    if (homeN < 2) return;
    homeN = 0;
    clearTimeout(homeT);
    homeT = setTimeout(function () {                                     // once the relaunch has settled
        if (document.hidden) return;
        if (S.zone === 'sw') closeSwitcher(); else { openSwitcher(); swOpenedAt = Date.now(); }
    }, 450);
}
