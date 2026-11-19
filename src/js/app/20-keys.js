/* ---------- keys ---------- */

// 405 = remote's yellow key, 68 = "d" in the desktop preview: both open diagnostics
// 404 = green (the app switcher; 71 = "g" in the preview), 72 = "h" in the preview: a Home press as Vetro delivers it
var KEYS = { 65376: 'OK', 65385: 'B', 37: 'L', 38: 'U', 39: 'R', 40: 'D', 13: 'OK', 10009: 'B', 27: 'B', 8: 'B', 405: 'Y', 68: 'Y', 406: 'E', 69: 'E', 403: 'C', 67: 'C', 404: 'G', 71: 'G', 72: 'H', 10252: 'P', 415: 'P', 19: 'P', 179: 'P', 80: 'P', 48: 'N0', 49: 'N1', 50: 'N2', 51: 'N3' };
try { tizen.tvinputdevice.registerKey('ColorF1Green'); } catch (e) { /* not on a TV */ }
try { tizen.tvinputdevice.registerKey('ColorF2Yellow'); tizen.tvinputdevice.registerKey('ColorF3Blue'); tizen.tvinputdevice.registerKey('ColorF0Red'); ['MediaPlayPause', 'MediaPlay', 'MediaPause', '0', '1', '2', '3'].forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* ignore */ } }); } catch (e) { /* not on a TV */ }

function dockKey(d) {
    var n = dCells.length;
    if (d === 'L') { if (S.di > 0) S.di--; else bump(dCells[S.di], -1, 0); }
    else if (d === 'R') { if (S.di < n - 1) S.di++; else bump(dCells[S.di], 1, 0); }
    else if (d === 'D') { var first = rowsShown()[0]; if (first != null) { useRow(first); S.zone = 'rail'; } }
    else if (d === 'U' && S.di === n - 1) { S.zone = 'home'; }          // the rightmost tile sits under the Samsung Home button
    else if (d === 'U') { S.zone = 'full'; clearTimeout(idleT); learnHint('full'); }      // full-screen wallpaper + centred clock
    else if (d === 'B') { S.zone = null; }
    else if (d === 'OK') {
        var it = dockItems[S.di];
        if (it) { /* apps launch on key release, see okUp(): a long press moves the tile instead */ }
        else if (S.di === dockItems.length) openApps();
        else openSources();
    }
    paint();
}

function homeKey(d) {
    if (d === 'D' || d === 'B') S.zone = 'dock';
    else if (d === 'OK') { openSamsungHome(); return; }
    else bump($('homebtn'), d === 'L' ? -1 : d === 'R' ? 1 : 0, d === 'U' ? -1 : 0);
    paint();
}

function railKey(d) {
    var n = recs.length;
    if (d === 'L') { if (S.ri > 0) S.ri--; else bump(pCells[S.ri], -1, 0); }
    else if (d === 'R') { if (S.ri < n - 1) S.ri++; else bump(pCells[S.ri], 1, 0); }
    else if (d === 'U') { S.zone = 'act'; S.ai = 0; }                 // either row: up to this title's buttons
    else if (d === 'D') { var vis = rowsShown(), below = vis[vis.indexOf(S.row) + 1]; if (below != null) useRow(below); else bump(pCells[S.ri], 0, 1); }
    else if (d === 'B') { S.zone = 'dock'; }
    else if (d === 'OK') { if (recs[S.ri].connect) openTrakt(); else openDetails(recs[S.ri], 'rail'); return; }   // a poster opens its details
    paint();
}

function openItem(r) {
    r = r || recs[S.ri];
    if (r.connect) return openTrakt();
    if (r.streaming === false || !(P.isInstalled((C.providerApps || {})[r.provider] || r.provider) || P.isInstalled(r.provider))) {
        toast(r.streaming === false ? r.title + ' isn’t streaming here yet. Watchlist it and check back' : 'You don’t have ' + r.provider + ' on this TV');
        return;
    }
    launchTitle(r);                                               // straight to the title where the app allows it
}
var launchTitle = function (r) { P.launchProvider(r.provider); };    // replaced below, once launches are wrapped

// The movie panel's buttons, left to right.
var ACTS = [a1, a5, a2, a3, a4];
// The panel's buttons that are showing (the connect card has one; a show has no Watched).
function shownActs() { return ACTS.filter(function (b) { return b.style.display !== 'none'; }); }
function actKey(d) {
    var bs = shownActs(), vis = rowsShown(), above = vis[vis.indexOf(S.row) - 1];
    if (S.ai > bs.length - 1) S.ai = bs.length - 1;
    if (d === 'L') { if (S.ai) S.ai--; else bump(acts, -1, 0); }
    else if (d === 'R') { if (S.ai < bs.length - 1) S.ai++; else bump(acts, 1, 0); }
    else if (d === 'D') { S.zone = 'rail'; }
    else if (d === 'U' && above != null) { useRow(above); S.zone = 'rail'; }   // up to the row above
    else if (d === 'U' || d === 'B') { S.zone = 'dock'; }
    else if (d === 'OK') {
        var b = bs[S.ai];
        if (b === a1) { openItem(); return; }
        if (b === a5) { openDetails(recs[S.ri], 'act'); return; }
        if (b === a3) { if (recs[S.ri] && recs[S.ri].next) markNext(recs[S.ri]); else openRate(); return; }
        if (b === a4) { notInterested(); return; }
        toggleWatchlist();
    }
    paint();
}
