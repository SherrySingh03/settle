/* Up next: the next episode of each show you're watching, as the first row under the dock. Trakt knows where you are
   (window.Trakt.upNext); TMDB fills in the poster and where it streams (window.Recs.item). Each card is the show, with
   its next episode ("S3 E7") under the poster; OK opens the show in its app.

   The streaming apps on the TV don't tell Trakt what you watched, so the row only moves when an episode is marked:
   the hero's "Mark S3 E7 watched" logs that one episode and moves the card on to the next (or drops it when you're up
   to date). Shown at once from the last list (kept on this TV), refreshed at start and when you come back after a
   while. Nothing polls. */
var UN_KEY = 'settle.upnext.v1', UN_AWAY = 30 * 60 * 1000, unAt = 0, unBusy = false, unHiddenAt = 0;

function unCode(n) { return 'S' + n.season + ' E' + n.number; }
// A TMDB show item plus the episode: the label under the poster and the hero line say which episode is next.
function unDecorate(r, u) {
    r.next = { season: u.next.season, number: u.next.number, title: u.next.title, trakt: u.next.trakt, code: unCode(u.next) };
    r.trakt = u.trakt;
    r.prov = r.next.code;
    r.meta = 'Next: ' + r.next.code + (r.next.title ? ' · ' + r.next.title : '');
    return r;
}
var unFetchedAt = 0;                                              // when the show details (TMDB) were last fetched
function unLoad() { try { var c = JSON.parse(localStorage.getItem(UN_KEY)); unFetchedAt = (c && c.at) || 0; return c && c.items ? c.items : []; } catch (e) { return []; } }
function unSave(list, fetched) {
    if (fetched) unFetchedAt = Date.now();
    try { localStorage.setItem(UN_KEY, JSON.stringify({ at: unFetchedAt, items: list })); } catch (e) { /* silent */ }
}
// The same shows at the same episodes, in the same order: nothing on screen would change.
function unSig(list) { return list.map(function (r) { return r.tmdb + ':' + (r.next && r.next.trakt); }).join(','); }

// Never swapped under the user's focus: waits for Rest like the other rows. Only the two rows Up next touches are
// rebuilt (Up next itself, and TV shows, which leaves out the shows you're watching): rebuilding all four re-created
// and re-decoded every poster on screen, which the TV felt.
var pendingUn = null;
function unRows() {
    var going = {}; upNext.forEach(function (u) { going[u.tmdb] = 1; });
    var shows = lastShows.filter(function (r) { return !r.wl && !going[r.tmdb]; });
    rows[3].list = upNext.slice(); rows[3].ri = 0; buildRow(3); rows[3].track.style.transform = '';
    if (unSig(shows) !== unSig(rows[2].list)) { rows[2].list = shows; rows[2].ri = 0; buildRow(2); rows[2].track.style.transform = ''; }
    var first = rowsShown()[0];
    if (first !== undefined && (S.row === 2 || S.row === 3 || !rows[S.row].list.length)) { S.row = first; recs = rows[first].list; pCells = rows[first].cells; track = rows[first].track; S.ri = 0; heroId = null; }
    stage.style.setProperty('--rowpos', ''); paint();
}
function unApply(list) {
    if (S.zone === 'rail' || S.zone === 'act' || S.zone === 'dt' || S.zone === 'rate') { pendingUn = list; return; }
    upNext = list;
    unRows();
}
(window.onRest = window.onRest || []).push(function () { if (pendingUn) { var l = pendingUn; pendingUn = null; upNext = l; unRows(); } });

function unRefresh() {
    var T = window.Trakt, R = window.Recs;
    if (unBusy || !T || !T.connected() || !T.upNext || !R || !R.item || navigator.onLine === false) return;
    unBusy = true; unAt = Date.now();
    // Show details fetched in the last day are reused: only a show new to the row asks TMDB.
    // The row as it is now, taken first: a reused show is updated in place below.
    var before = unSig(rows[3].list), fresh = Date.now() - unFetchedAt < 24 * 3600 * 1000, known = {}, asked = false;
    if (fresh) upNext.forEach(function (r) { known[r.tmdb] = r; });
    T.upNext(10).then(function (list) {
        return Promise.all(list.map(function (u) {
            if (known[u.tmdb]) return unDecorate(known[u.tmdb], u);
            asked = true;
            return R.item(u.tmdb, 'tv').then(function (r) { return r ? unDecorate(r, u) : null; }, function () { return null; });
        }));
    }).then(function (items) {
        items = items.filter(Boolean);
        var same = unSig(items) === before;
        unSave(items, asked || !fresh);
        if (same) {                                                   // nothing moved: the cards stay, only the data under them updates
            upNext = items; rows[3].list = items.slice();
            if (S.row === 3) { recs = rows[3].list; heroId = null; }
            return;
        }
        unApply(items);
    }).catch(function () { /* the last list stays */ }).then(function () { unBusy = false; });
}

// The hero's Watched button on an Up next card: log this one episode, then show the next one (or drop the card).
function markNext(r) {
    var T = window.Trakt, ep = r.next;
    if (!T || !T.connected()) { toast('Connect Trakt to keep track of episodes'); return; }
    toast('Marking ' + ep.code + ' watched…');
    T.markEpisode(ep.trakt).then(function () { return T.nextEpisode(r.trakt); }).then(function (n) {
        var list = upNext.slice(), i = list.indexOf(r);
        if (n) { unDecorate(r, { trakt: r.trakt, next: n }); heroId = null; toast(ep.code + ' watched. Up next: ' + r.next.code); }
        else { if (i >= 0) list.splice(i, 1); toast(ep.code + ' watched. You’re up to date with ' + r.title); }
        upNext = list; unSave(list);
        // In place when the card stays (focus doesn't move); a rebuild when it goes, once the user is back at Rest.
        if (n) { buildRow(3); if (S.row === 3) pCells = rows[3].cells; paint(); } else unApply(list);
    }).catch(function (e) { toast('Couldn’t mark ' + ep.code + ': ' + ((e && e.message) || e)); });
}

upNext = unLoad();
window.addEventListener('load', function () { setTimeout(unRefresh, 1500); });
document.addEventListener('visibilitychange', function () { if (document.hidden) unHiddenAt = Date.now(); });
(window.onWake = window.onWake || []).push(function () { if (unHiddenAt && Date.now() - unHiddenAt > UN_AWAY) unRefresh(); });
