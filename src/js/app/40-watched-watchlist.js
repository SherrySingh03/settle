/* "Watched": a small dialog to rate the title, then log it on Trakt. Optimistic: the title leaves the rail at once and
   comes back (with a short notice) only if Trakt refuses. Needs a Trakt account. */
var RT = null;
// Five faces, drawn here (a TV often has no colour emoji font): they stand for 2, 4, 6, 8 and 10 out of 10 on Trakt.
var EYES = '<circle cx="17" cy="19" r="2.4" fill="currentColor" stroke="none"/><circle cx="31" cy="19" r="2.4" fill="currentColor" stroke="none"/>';
var STAR = '<path fill="currentColor" stroke="none" d="M0 -5.5 L1.7 -1.8 L5.6 -1.4 L2.7 1.2 L3.5 5 L0 3 L-3.5 5 L-2.7 1.2 L-5.6 -1.4 L-1.7 -1.8 Z"/>';
function face(inner) { return '<svg width="64" height="64" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20"/>' + inner + '</svg>'; }
var FACES = [
    { name: 'Awful', svg: face(EYES + '<path d="M15 35 Q24 25 33 35"/>') },
    { name: 'Meh', svg: face(EYES + '<path d="M16 33 Q24 29 32 33"/>') },
    { name: 'Fine', svg: face(EYES + '<path d="M16 30 Q24 35 32 30"/>') },
    { name: 'Great', svg: face(EYES + '<path d="M14 28 Q24 41 34 28"/>') },
    { name: 'Amazing', svg: face('<g transform="translate(17 19)">' + STAR + '</g><g transform="translate(31 19)">' + STAR + '</g><path fill="currentColor" d="M14 28 Q24 44 34 28 Z"/>') }
];
function rateNums() {
    var row = $('rt-row');
    if (row.firstChild) return row.children;
    FACES.forEach(function (f) { var n = h('div', 'rt-n'); n.innerHTML = f.svg + '<span>' + f.name + '</span>'; row.appendChild(n); });
    return row.children;
}
function paintRate() {
    var n = rateNums();
    for (var i = 0; i < n.length; i++) n[i].classList.toggle('cur', i + 1 === RT.v);
    $('rt-row').classList.toggle('rt-row-on', RT.f === 0);
    $('rt-fav').classList.toggle('on', RT.f === 1);
    $('rt-skip').classList.toggle('on', RT.f === 2);
    $('rt-val').textContent = RT.f === 0 ? FACES[RT.v - 1].name + ' · ' + RT.v * 2 + ' out of 10 on Trakt' : '';
}
function openRate() {
    var r = recs[S.ri];
    if (!r || r.connect) return;
    if (!trakt()) { toast('Connect Trakt to log what you have watched'); return; }
    clearTimeout(idleT);
    RT = { i: S.ri, r: r, v: 4, f: 0 };
    $('rt-title').textContent = r.title;
    $('rt-sub').textContent = r.type === 'tv' ? 'Mark the whole show as watched. How was it?' : 'Mark as watched. How was it?';
    $('rt-fav').textContent = 'WAIT, THIS WAS ABSOLUTELY AMAZING! Add to favorites';
    S.zone = 'rate';
    paintRate();
    $('rate').classList.add('open');
    paint();
}
function closeRate() {
    $('rate').classList.remove('open');
    RT = null;
    S.zone = 'act'; armIdle(); paint();
}
// Takes a title off both rows (focus to its neighbour). Returns where it was in the focused row.
function dropRec(r) {
    var i = recs.indexOf(r);
    rows.forEach(function (R, k) {
        var j = R.list.indexOf(r);
        if (j >= 0) { R.list.splice(j, 1); if (k !== S.row) buildRow(k); }
    });
    if (i >= 0) { S.ri = Math.min(i, recs.length - 1); heroId = null; buildRail(); track.style.transform = ''; }
    if (recs.length) S.zone = 'rail';
    else if (rowsShown().length) { useRow(rowsShown()[0]); S.zone = 'rail'; }
    else S.zone = 'dock';
    armIdle(); paint();
    return i;
}

/* "Not interested": the title leaves both rows and is never offered again (kept on this TV). With Trakt, it is also
   hidden from Trakt's recommendations, and taken off your watchlist if it was on it. */
function notInterested() {
    var r = recs[S.ri];
    if (!r || r.connect) return;
    if (window.Recs && window.Recs.dismiss) window.Recs.dismiss(r.type === 'tv' ? 'tv:' + r.tmdb : r.tmdb);
    dropRec(r);
    toast('Got it. ' + r.title + ' won’t come up again');
    if (r.wl) {
        if (window.Recs) window.Recs.setWl(r.tmdb, false, r.type);
        if (trakt()) window.Trakt.setWatchlist(r, false).catch(function () { /* best effort */ }); else wlSave(r.id, false);
    }
    if (trakt() && r.type !== 'tv') window.Trakt.hideRecommendation(r).catch(function () { /* still gone here: the local list keeps it out */ });
}

function submitWatched(rating, fav) {
    var rt = RT, r = rt.r;
    if (window.Recs && window.Recs.addWatched) window.Recs.addWatched(r.type === 'tv' ? 'tv:' + r.tmdb : r.tmdb);          // remembered at once: a refresh can no longer bring it back
    $('rate').classList.remove('open'); RT = null;
    var i = dropRec(r);                                                // optimistic: it leaves both rows now
    toast(fav ? 'Logged · rated 10/10 · added to favorites. Great pick!' : (rating ? 'Logged as watched · rated ' + rating + '/10' : 'Logged as watched'));
    window.Trakt.markWatched(r, rating, fav).then(function (res) {
        if (window.Recs && window.Recs.forget) window.Recs.forget(r.tmdb, r.type);
        if (res === 'fav') toast('Logged and rated. Trakt did not take the favorite (it may need Trakt VIP)');
    }, function () {                                                   // reconcile: put it back, quietly
        if (recs.indexOf(r) < 0) { recs.splice(Math.min(Math.max(i, 0), recs.length), 0, r); heroId = null; if (S.zone !== 'rail' && S.zone !== 'act') { buildRail(); paint(); } }
        toast('Could not reach Trakt: the title stays on your rail');
    });
}
function rateKey(d) {
    if (d === 'B') return closeRate();
    if (RT.f === 0) {
        if (d === 'L' && RT.v > 1) RT.v--;
        else if (d === 'R' && RT.v < 5) RT.v++;
        else if (d === 'D') RT.f = 1;
        else if (d === 'OK') return submitWatched(RT.v * 2, false);
    } else if (RT.f === 1) {
        if (d === 'U') RT.f = 0;
        else if (d === 'D') RT.f = 2;
        else if (d === 'OK') return submitWatched(10, true);
    } else {
        if (d === 'U') RT.f = 1;
        else if (d === 'OK') return submitWatched(0, false);
    }
    paintRate();
}

function wlLoad() { try { return JSON.parse(localStorage.getItem('settle.wl.local')) || {}; } catch (e) { return {}; } }
function wlSave(id, on) {
    var m = wlLoad();
    if (on) m[id] = 1; else delete m[id];
    try { localStorage.setItem('settle.wl.local', JSON.stringify(m)); } catch (e) { /* silent */ }
}

function trakt() { return window.Trakt && window.Trakt.connected(); }

// Optimistic: flip the UI now, tell Trakt, and put it back if Trakt refuses.
function setWl(r, i, on) {
    r.wl = on;
    if (!trakt()) wlSave(r.id, on);                               // local fallback only when not connected
    if (window.Recs) window.Recs.setWl(r.tmdb, on, r.type);
    rows.forEach(function (R) { var j = R.list.indexOf(r); if (j >= 0 && R.cells[j]) R.cells[j].classList.toggle('wl', on); });
    if (S.row !== 1 && !r.connect) {                              // never rearranged under the user's focus
        var w = rows[1].list, j = w.indexOf(r);
        if (on && j < 0) w.unshift(r); else if (!on && j >= 0) w.splice(j, 1);
        buildRow(1);
    }
    renderHero();
}
function toggleWatchlist(r) {
    r = r || recs[S.ri];
    var i = S.ri, on = !r.wl;
    setWl(r, i, on);
    if (window.Trakt) window.Trakt.setWatchlist(r, on).catch(function () { setWl(r, i, !on); });   // reconcile on failure
}

/* "Connect Trakt" card: first item of the rail until the account is linked */
var CONNECT = { id: 'connect', connect: true, title: 'Connect Trakt', bg: '#16181C', shape: 'circle', fg: '#FFB23F',
    prov: 'Trakt', provider: 'Trakt', streaming: true, note: 'Picks from what you watch',
    meta: 'About a minute, on your phone',
    desc: 'Link your Trakt account to see recommendations and add titles to your watchlist.' };

var pendingRecs = null, pendingShows = null, lastFilms = [], lastShows = [];
// The films (For tonight) and the shows (TV shows) arrive separately; the Watchlist row holds what is on your watchlist
// from both.
function applyRecs(list) { lastFilms = list; rebuildRows(); }
function applyShows(list) { lastShows = list; rebuildRows(); }
function rebuildRows() {
    var wl = wlLoad(), t = trakt(), films = lastFilms, shows = lastShows;
    films.concat(shows).forEach(function (r) { if (!t && wl[r.id]) r.wl = true; });
    var tonight = films.filter(function (r) { return !r.wl && !r.connect; });
    var watch = films.concat(shows).filter(function (r) { return r.wl && !r.connect; });
    if (window.Trakt && window.Trakt.enabled && !t && navigator.onLine !== false) tonight = [CONNECT].concat(tonight);   // pairing needs the internet
    var going = {}; upNext.forEach(function (u) { going[u.tmdb] = 1; });                // a show you're watching isn't suggested again
    rows[0].list = tonight; rows[1].list = watch; rows[2].list = shows.filter(function (r) { return !r.wl && !going[r.tmdb]; });
    rows[3].list = upNext.slice();
    rows.forEach(function (R, k) { R.ri = 0; buildRow(k); R.track.style.transform = ''; });
    S.row = rowsShown()[0] || 0;
    recs = rows[S.row].list; pCells = rows[S.row].cells; track = rows[S.row].track; S.ri = 0; heroId = null;
    stage.style.setProperty('--rowpos', ''); paint();
}
// Never rebuild the rail under the user's focus: wait until they are back at Rest.
// now = the user asked for this refresh: apply at once, with a visible transition, wherever focus is.
function setRecs(list, now) {
    if (now) {
        pendingRecs = null;
        applyRecs(list);
        rows.forEach(function (R) { R.track.classList.remove('recs-in'); void R.track.offsetWidth; R.track.classList.add('recs-in'); });
        return;
    }
    if (S.zone === 'rail' || S.zone === 'act') pendingRecs = list; else applyRecs(list);
}
/* No internet: say so once, keep whatever rows are saved, and drop the Connect Trakt card (it can't work offline).
   Back online: put the card back, and if the rows are empty, ask for them again. Events only; nothing polls. */
function onNet() {
    var off = navigator.onLine === false;
    stage.classList.toggle('offline', off);
    if (off) toast(rowsShown().length ? 'No internet connection. Showing what’s saved.' : 'No internet connection.');
    if (S.zone !== 'rail' && S.zone !== 'act' && S.zone !== 'dt') rebuildRows();
    railEmpty();
    if (!off && !rowsShown().length && window.Recs && window.Recs.refreshNow) window.Recs.refreshNow().catch(function () { /* the message stays */ });
}
window.addEventListener('offline', onNet);
window.addEventListener('online', onNet);
if (navigator.onLine === false) stage.classList.add('offline');

(window.onRest = window.onRest || []).push(function () { if (pendingRecs) { var l = pendingRecs; pendingRecs = null; applyRecs(l); } });
// The same for the TV shows row.
function setShows(list, now) {
    if (now || !(S.zone === 'rail' || S.zone === 'act')) { pendingShows = null; applyShows(list); return; }
    pendingShows = list;
}
(window.onRest = window.onRest || []).push(function () { if (pendingShows) { var l = pendingShows; pendingShows = null; applyShows(l); } });
