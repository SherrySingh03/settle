/* Search: films and shows, opened with Up twice from the dock (full screen, then Up again), as a centred overlay over a
   blurred copy of the wallpaper: it fades in and the panel rises into place (and back out on closing). The box is a real
   text field, so on the TV focusing it brings up Samsung's on-screen keyboard (with voice) at the bottom of the screen;
   results come from TMDB as you type (after a short pause) and OK on one opens its details, which come back here on Back.
     box:     Down, OK (or the keyboard's Done) go to the results; Back ends the typing (closes from an empty box)
     results: Left / Right choose, Up back to the box, OK opens the details, Back closes */
var SR = { f: 'in', i: 0, items: [], cells: [], q: '', t: 0, tok: 0, zero: false }, srIn = $('sr-in');
// Before you type: the titles you last opened from Search, then what's trending this week. Typing also finds your apps.
var SR_RECENT = 'settle.search.recent.v1';
function srRecent() { try { return JSON.parse(localStorage.getItem(SR_RECENT)) || []; } catch (e) { return []; } }
function srRemember(p) {
    if (!p || p.app) return;
    var l = srRecent().filter(function (x) { return !(x.tmdb === p.tmdb && x.type === p.type); });
    l.unshift({ tmdb: p.tmdb, type: p.type, title: p.title, art: p.art, year: p.year });
    try { localStorage.setItem(SR_RECENT, JSON.stringify(l.slice(0, 8))); } catch (e) { /* silent */ }
}
function srZero() {
    var tok = ++SR.tok, rec = srRecent();
    SR.zero = true; srRender(rec);
    if (window.Recs && window.Recs.trending) window.Recs.trending().then(function (t) {
        if (tok !== SR.tok) return;
        var seen = {}; rec.forEach(function (x) { seen[x.type + x.tmdb] = 1; });
        var at = SR.f === 'res' ? SR.i : 0;
        srRender(rec.concat(t.filter(function (x) { return !seen[x.type + x.tmdb]; })).slice(0, 16));
        if (SR.f === 'res') { SR.i = Math.min(at, SR.items.length - 1); srFocus('res'); } else srFocus('in');
    });
}
function srApps(q) {
    var ql = q.toLowerCase();
    return P.allInstalled().filter(function (a) {
        var l = (a.label || '').toLowerCase();
        return l.indexOf(ql) === 0 || l.split(/[^a-z0-9]+/).some(function (w) { return w && w.indexOf(ql) === 0; });
    }).slice(0, 3).map(function (a) { return { app: a, title: a.label }; });
}
// The backdrop: the wallpaper drawn into a 96x54 canvas and stretched to the screen (the downscale is the blur), then
// darkened. Drawn once per opening; nothing is blurred live.
function srBackdrop() {
    var c = $('sr-bg'), g = c.getContext('2d');
    g.clearRect(0, 0, 96, 54);
    try { g.drawImage($('wall'), 0, 0, 96, 54); } catch (e) { /* not decoded yet: the dark fill alone */ }
    g.fillStyle = 'rgba(10,11,13,.55)'; g.fillRect(0, 0, 96, 54);
}
function openSearch() {
    learnHint('srch');
    srBackdrop();
    S.zone = 'srch'; armIdle();
    $('srch').classList.add('open');
    if (!srIn.value.trim()) srZero();
    else if (!SR.items.length) srIn.dispatchEvent(new Event('input'));     // the results were let go on closing: ask again
    srFocus('in');
    paint();
}
function closeSearch() {
    srIn.blur(); fit();
    $('srch').classList.remove('open');
    setOn('sr', null);
    S.zone = 'dock'; armIdle(); paint();
    clearTimeout(SR.drop); SR.drop = setTimeout(function () { if (S.zone !== 'srch' && S.zone !== 'dt') { SR.tok++; srRender([]); } }, 400);   // after the fade: let the posters go
}
function srFocus(f) {
    SR.f = f === 'res' && SR.items.length ? 'res' : 'in';
    if (SR.f === 'in') { setOn('sr', null); srIn.focus(); } else { srIn.blur(); fit(); setOn('sr', SR.cells[SR.i]); }
    $('sr-box').classList.toggle('on', SR.f === 'in');
    var it = SR.f === 'res' && SR.items[SR.i];
    $('sr-ll').textContent = it ? it.title + (it.app ? ' · App' : (it.year ? ' · ' + it.year : '') + (it.type === 'tv' ? ' · TV show' : ''))
        : SR.zero && SR.items.length ? (srRecent().length ? 'Recent and trending' : 'Trending this week') : '';
    if (SR.f === 'res') $('sr-row').style.transform = SR.items.length > 8 ? 'translateX(' + (-Math.max(0, SR.i - 3) * 216) + 'px)' : '';   // 8 fit: centred, no scroll
}
function srRender(list, done) {
    var row = $('sr-row');
    row.textContent = ''; SR.items = list; SR.cells = []; SR.i = 0;
    row.style.transform = '';
    list.forEach(function (p) {
        if (p.app) {                                                  // an app: its icon tile, centred on the poster's height
            var ac = h('div', 'cell srcell srapp'), at = h('div', 'tile atile');
            ac.appendChild(at); row.appendChild(ac); SR.cells.push(ac);
            paintTile(at, p.app);
            return;
        }
        var c = h('div', 'cell pcell srcell'), t = h('div', 'tile'), im = new Image();
        im.width = 184; im.height = 276; im.alt = ''; im.decoding = 'async'; im.src = p.art;
        t.appendChild(im); c.appendChild(t); row.appendChild(c); SR.cells.push(c);
    });
    $('sr-clip').classList.toggle('few', list.length <= 8);
    $('sr-empty').textContent = done && SR.q && !list.length ? 'Nothing by that name. Try another title' : '';
}
srIn.addEventListener('input', function () {
    armIdle();
    clearTimeout(SR.t);
    var q = srIn.value.trim(), tok = ++SR.tok;
    SR.q = q;
    SR.zero = false;
    if (!q) { srZero(); srFocus('in'); return; }
    srRender(srApps(q)); srFocus('in');                               // apps show at once, from the list already in memory
    if (q.length < 2) return;
    SR.t = setTimeout(function () {                                   // asked once typing pauses, not per letter
        if (!window.Recs || !window.Recs.search) return;
        window.Recs.search(q).then(function (list) { if (tok === SR.tok) { srRender(srApps(q).concat(list), true); srFocus('in'); } });
    }, 450);
});
function searchKey(d) {
    if (SR.f === 'in') {
        // Samsung's keyboard hands the Back (or Cancel) that closes it on to the page. In the box it therefore only ends
        // the typing, landing on the results; Search itself closes on Back from the results, or from an empty box.
        if (d === 'B') { if (SR.items.length) srFocus('res'); else closeSearch(); return; }
        if (d === 'D' || d === 'OK') srFocus('res');
        return;                                                       // Up: nothing above the box
    }
    if (d === 'B') return closeSearch();
    if (d === 'L') { if (SR.i > 0) SR.i--; else bump(SR.cells[0], -1, 0); }
    else if (d === 'R') { if (SR.i < SR.cells.length - 1) SR.i++; else bump(SR.cells[SR.i], 1, 0); }
    else if (d === 'U') { srFocus('in'); return; }
    else if (d === 'OK') {
        var it = SR.items[SR.i];
        if (it.app) { closeSearch(); P.launch(it.app.id, function (e) { toast('Could not open ' + it.title + ': ' + ((e && e.message) || e)); }); return; }
        srRemember(it); openDetails(fromPick(it), 'srch'); return;
    }
    srFocus('res');
}
