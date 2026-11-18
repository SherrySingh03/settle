/* Search: films and shows, opened with Up twice from the dock (full screen, then Up again), as a centred overlay over a
   blurred copy of the wallpaper: it fades in and the panel rises into place (and back out on closing). The box is a real
   text field, so on the TV focusing it brings up Samsung's on-screen keyboard (with voice) at the bottom of the screen;
   results come from TMDB as you type (after a short pause) and OK on one opens its details, which come back here on Back.
     box:     Down, OK (or the keyboard's Done) go to the results; Back ends the typing (closes from an empty box)
     results: Left / Right choose, Up back to the box, OK opens the details, Back closes */
var SR = { f: 'in', i: 0, items: [], cells: [], q: '', t: 0, tok: 0 }, srIn = $('sr-in');
// The backdrop: the wallpaper drawn into a 96x54 canvas and stretched to the screen (the downscale is the blur), then
// darkened. Drawn once per opening; nothing is blurred live.
function srBackdrop() {
    var c = $('sr-bg'), g = c.getContext('2d');
    g.clearRect(0, 0, 96, 54);
    try { g.drawImage($('wall'), 0, 0, 96, 54); } catch (e) { /* not decoded yet: the dark fill alone */ }
    g.fillStyle = 'rgba(10,11,13,.55)'; g.fillRect(0, 0, 96, 54);
}
function openSearch() {
    srBackdrop();
    S.zone = 'srch'; armIdle();
    $('srch').classList.add('open');
    srFocus('in');
    paint();
}
function closeSearch() {
    srIn.blur(); fit();
    $('srch').classList.remove('open');
    setOn('sr', null);
    S.zone = 'dock'; armIdle(); paint();
}
function srFocus(f) {
    SR.f = f === 'res' && SR.items.length ? 'res' : 'in';
    if (SR.f === 'in') { setOn('sr', null); srIn.focus(); } else { srIn.blur(); fit(); setOn('sr', SR.cells[SR.i]); }
    $('sr-box').classList.toggle('on', SR.f === 'in');
    var it = SR.f === 'res' && SR.items[SR.i];
    $('sr-ll').textContent = it ? it.title + (it.year ? ' · ' + it.year : '') + (it.type === 'tv' ? ' · TV show' : '') : '';
    if (SR.f === 'res') $('sr-row').style.transform = SR.items.length > 8 ? 'translateX(' + (-Math.max(0, SR.i - 3) * 216) + 'px)' : '';   // 8 fit: centred, no scroll
}
function srRender(list) {
    var row = $('sr-row');
    row.textContent = ''; SR.items = list; SR.cells = []; SR.i = 0;
    row.style.transform = '';
    list.forEach(function (p) {
        var c = h('div', 'cell pcell srcell'), t = h('div', 'tile'), im = new Image();
        im.width = 184; im.height = 276; im.alt = ''; im.decoding = 'async'; im.src = p.art;
        t.appendChild(im); c.appendChild(t); row.appendChild(c); SR.cells.push(c);
    });
    $('sr-clip').classList.toggle('few', list.length <= 8);
    $('sr-empty').textContent = SR.q && !list.length ? 'Nothing by that name. Try another title' : '';
}
srIn.addEventListener('input', function () {
    armIdle();
    clearTimeout(SR.t);
    var q = srIn.value.trim(), tok = ++SR.tok;
    SR.q = q;
    if (q.length < 2) { srRender([]); return; }
    SR.t = setTimeout(function () {                                   // asked once typing pauses, not per letter
        if (!window.Recs || !window.Recs.search) return;
        window.Recs.search(q).then(function (list) { if (tok === SR.tok) srRender(list); });
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
    else if (d === 'OK') { openDetails(fromPick(SR.items[SR.i]), 'srch'); return; }
    srFocus('res');
}
