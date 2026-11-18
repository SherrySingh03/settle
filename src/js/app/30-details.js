/* Details: a popup with everything TMDB knows about the title. What the rail already has shows at once; the
   director, cast, where to stream or rent, language and release date arrive with one TMDB call. */
var DT = null;
function fact(label, value, mine) {
    var f = document.createDocumentFragment(), v = h('div', 'fv');
    f.appendChild(h('div', 'fl', label));
    if (mine) v.innerHTML = value; else v.textContent = value;
    f.appendChild(v);
    return f;
}
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function provList(list) {                                        // the services you have are highlighted
    return list.map(function (p) { return p.onTv ? '<span class="mine">' + esc(p.name) + '</span>' : esc(p.name); }).join(', ');
}
function dtButtons() {
    var r = DT.r;
    $('dt-open').lastChild.textContent = r.loading ? 'Finding where to watch…' : (r.streaming === false ? 'Not streaming yet' : 'Open in ' + (r.provider || 'app'));
    $('dt-wl').children[0].style.display = r.wl ? 'none' : '';
    $('dt-wl').children[1].style.display = r.wl ? '' : 'none';
    $('dt-wl').lastChild.textContent = r.wl ? 'On watchlist' : 'Watchlist';
    $('dt-wl').classList.toggle('done', !!r.wl);
    $('dt-tr').style.display = DT.trailer ? '' : 'none';
    var bs = dtBtns();
    if (DT.b >= bs.length) DT.b = bs.length - 1;
    setOn('dt', DT.f === 'b' ? bs[DT.b] : null);
    setOn('lk', DT.f === 'l' ? DT.cells[DT.li] : null);
    var pick = DT.f === 'l' && DT.like[DT.li];
    $('dt-ll').textContent = pick ? 'More like this · ' + pick.title : 'More like this';
    $('dt-hint').textContent = DT.f === 'l' ? 'OK: see this one · ▲ buttons · Back' + (DT.stack.length ? ': previous film' : '')
        : (DT.cells.length ? '▼ More like this · ' : '') + 'OK · Back' + (DT.stack.length ? ': previous film' : ' to close');
}
function dtBtns() { return DT.trailer ? [$('dt-open'), $('dt-tr'), $('dt-wl')] : [$('dt-open'), $('dt-wl')]; }
function playTrailer() {
    var key = DT.trailer, title = DT.r.title;
    need(['js/youtube.js'], function () {                             // loaded on the first trailer
        window.YouTubeCast.play(key, title).catch(function (e) { toast('No trailer tonight: ' + ((e && e.message) || e)); });
    });
}
// The same film object wherever it already is (a rail row), so the watchlist state is shared.
function known(tmdb, type) {
    var all = rows[0].list.concat(rows[1].list, rows[2].list);
    for (var i = 0; i < all.length; i++) if (all[i].tmdb === tmdb && (all[i].type || 'movie') === (type || 'movie')) return all[i];
    return null;
}
// from: the zone Back returns to ('rail' when a poster was opened, 'act' from the Details button).
function openDetails(r, from) {
    if (!r || r.connect) return;
    DT = { r: r, b: 0, f: 'b', li: 0, like: [], cells: [], from: from || 'act', stack: [] };
    S.zone = 'dt'; armIdle(); stage.classList.add('dt-open');
    $('dt').classList.add('open');
    showDetails(r);
}
// A "More like this" pick: shown at once from what the row knows, completed by one TMDB call.
// A pick ({ tmdb, type, title, art }) as a film or show: the same object if a row already has it, else one shown at
// once from what the pick knows and completed by one TMDB call.
function fromPick(p) {
    var r = known(p.tmdb, p.type);
    if (!r) {
        r = { id: (p.type === 'tv' ? 'tv' : 'tm') + p.tmdb, tmdb: p.tmdb, type: p.type || 'movie', title: p.title, art: p.art, bg: '#16181C', loading: true };
        if (window.Recs && window.Recs.item) window.Recs.item(p.tmdb, p.type).then(function (x) {
            r.loading = false;
            if (x) Object.keys(x).forEach(function (k) { if (k !== 'wl') r[k] = x[k]; });
            if (!x) { r.streaming = false; r.provider = 'Not streaming'; }
            if (DT && DT.r === r) { dtButtons(); paint(); }
        });
    }
    return r;
}
function openLike(p) { DT.stack.push(DT.r); showDetails(fromPick(p)); }
function showDetails(r) {
    DT.r = r; DT.b = 0; DT.f = 'b'; DT.li = 0; DT.like = []; DT.trailer = '';
    if (window.DeepLinks) window.DeepLinks.prefetch(r);
    var poster = $('dt-poster');
    poster.textContent = ''; poster.style.background = r.bg || '#2E323A';
    if (r.art) { var im = new Image(); im.alt = ''; im.src = r.art.replace('/w185/', '/w342/'); im.onerror = function () { im.onerror = null; im.src = r.art; }; poster.appendChild(im); }
    $('dt-title').textContent = r.title;
    fitText($('dt-title'), DT_SIZES);
    $('dt-tag').textContent = '';
    $('dt-mt').textContent = r.meta || '';
    $('dt-imdb').classList.remove('on'); $('dt-rt').classList.remove('on');
    $('dt-desc').textContent = r.desc || '';
    var facts = $('dt-facts');
    facts.textContent = '';
    if (r.note) facts.appendChild(fact('Where', r.note.replace(/ · .*/, '')));
    likeRow([]);
    dtButtons();
    paint();
    if (window.Recs && window.Recs.imdb) window.Recs.imdb(r, function (v, rt) { if (DT && DT.r === r) showScores($('dt-imdb'), $('dt-rt'), v, rt); });
    if (window.Recs && window.Recs.details) window.Recs.details(r).then(function (x) {
        if (!x || !DT || DT.r !== r) return;
        likeRow(x.like || []);
        DT.trailer = P.providerApp('YouTube') ? x.trailer || '' : '';   // only offered when YouTube is on the TV
        dtButtons();
        $('dt-tag').textContent = x.tagline;
        if (x.overview) $('dt-desc').textContent = x.overview;
        if (x.genres.length) $('dt-mt').textContent = [(x.released || '').slice(0, 4), x.genres.slice(0, 3).join(', '), x.runtime].filter(Boolean).join(' · ');
        facts.textContent = '';
        if (x.directors.length) facts.appendChild(fact(x.created ? 'Created by' : x.directors.length > 1 ? 'Directors' : 'Director', x.directors.join(', ')));
        if (x.cast.length) facts.appendChild(fact('Starring', x.cast.join(', ')));
        facts.appendChild(fact('Stream on', x.stream.length ? provList(x.stream) : 'Not streaming in your region', true));
        if (x.rent.length) facts.appendChild(fact('Rent or buy', provList(x.rent), true));
        var rel = x.released ? new Date(x.released + 'T00:00:00').toLocaleDateString(C.locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
        if (rel || x.language) facts.appendChild(fact(x.created ? 'First aired' : 'Released', [rel, x.language].filter(Boolean).join(' · ')));
    });
}
// Up to 8 small posters (w185, already the rail's size). Empty: the row and its label are hidden.
function likeRow(list) {
    var row = $('dt-lrow');
    row.textContent = ''; DT.like = list; DT.cells = [];
    list.forEach(function (p) {
        var c = h('div', 'cell lk'), t = h('div', 'tile'), im = new Image();
        im.alt = ''; im.src = p.art;
        t.appendChild(im); c.appendChild(t); row.appendChild(c); DT.cells.push(c);
    });
    $('dt-like').classList.toggle('has', list.length > 0);
}
function closeDetails() {
    $('dt').classList.remove('open'); stage.classList.remove('dt-open');
    setOn('dt', null); setOn('lk', null);
    var from = DT ? DT.from : 'act';
    $('dt-lrow').textContent = '';
    DT = null;
    S.zone = from; armIdle(); paint();
    if (from === 'srch') srFocus('res');                          // back to the result it came from
}
function dtKey(d) {
    if (d === 'B') {                                              // back to the film you came from, then out
        if (DT.stack.length) { showDetails(DT.stack.pop()); return; }
        return closeDetails();
    }
    if (DT.f === 'l') {
        if (d === 'L') { if (DT.li > 0) DT.li--; else bump(DT.cells[0], -1, 0); }
        else if (d === 'R') { if (DT.li < DT.cells.length - 1) DT.li++; else bump(DT.cells[DT.li], 1, 0); }
        else if (d === 'U') DT.f = 'b';
        else if (d === 'OK') { openLike(DT.like[DT.li]); return; }
        dtButtons(); return;
    }
    var bs = dtBtns();
    if (d === 'L') { if (DT.b > 0) DT.b--; else bump(bs[0], -1, 0); dtButtons(); return; }
    if (d === 'R') { if (DT.b < bs.length - 1) DT.b++; else bump(bs[DT.b], 1, 0); dtButtons(); return; }
    if (d === 'D' && DT.cells.length) { DT.f = 'l'; dtButtons(); return; }
    if (d === 'OK') {
        var b = bs[DT.b];
        if (b.id === 'dt-tr') { playTrailer(); return; }
        if (DT.r.loading) return;
        if (b.id === 'dt-open') { openItem(DT.r); return; }
        toggleWatchlist(DT.r); dtButtons();
    }
}
