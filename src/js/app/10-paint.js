/* ---------- focus painting ---------- */

var pressEl = null;
function setPressing(el) {
    if (pressEl === el) return;
    if (pressEl) pressEl.classList.remove('pressing');
    pressEl = el;
    if (el) el.classList.add('pressing');
}

var movingEl = null;
function setMoving(el) {
    if (movingEl === el) return;
    if (movingEl) movingEl.classList.remove('moving');
    movingEl = el;
    if (el) el.classList.add('moving');
}


var prev = {};
function setOn(key, el) {
    if (prev[key] === el) return;
    if (prev[key]) prev[key].classList.remove('on');
    prev[key] = el;
    if (el) el.classList.add('on');
}


function scrollRail() {
    var off = Math.max(0, S.ri - 1) * 216;
    off = Math.min(off, Math.max(0, recs.length * 216 - 32 - 1728));          // the last poster stops 96 px from the edge, like the first one
    track.style.transform = off ? 'translateX(' + (-off) + 'px)' : '';
}

// IMDb rating and Rotten Tomatoes score next to the year and genre: asked once focus rests on a title for 250 ms
// (a sweep asks nothing). Each shows only when OMDb has it.
var imdbT = 0;
function showImdb(r) {
    var el = $('h-imdb'), rtEl = $('h-rt');
    el.classList.remove('on'); rtEl.classList.remove('on');
    clearTimeout(imdbT);
    if (!window.Recs || !window.Recs.imdb || r.connect) return;
    imdbT = setTimeout(function () {
        window.Recs.imdb(r, function (v, rt) {
            if (recs[S.ri] !== r) return;                                   // focus moved on meanwhile
            showScores(el, rtEl, v, rt);
        });
    }, 250);
}

// Fills an IMDb badge and a Rotten Tomatoes badge.
function showScores(el, rtEl, v, rt) {
    if (v) { el.lastChild.textContent = v; el.classList.add('on'); }
    if (rt) { rtEl.lastChild.textContent = rt; rtEl.classList.add('on'); }
}

// A long title steps down through these sizes until it fits on its line; only past the smallest is it cut short.
// One measurement per new title (never while a title stays in focus).
// Measured on a canvas, not on the page: no layout is forced (the page's own measure cost a layout per size tried).
// The box is a fixed width, read once. The canvas font copies the title's: Archivo 650, width 112%, -0.01em tracking.
var measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, size) {
    measureCtx.font = '650 ' + size + 'px Archivo, system-ui, sans-serif';
    try { measureCtx.fontStretch = 'semi-expanded'; measureCtx.letterSpacing = (-0.01 * size) + 'px'; } catch (e) { /* older engine: a little wider than real, so it errs on the small side */ }
    return measureCtx.measureText(text).width;
}
function fitText(el, sizes) {
    var w = el.fitW || (el.fitW = el.clientWidth), t = el.textContent, s = sizes[sizes.length - 1];
    for (var i = 0; i < sizes.length; i++) if (textWidth(t, sizes[i]) / 1.005 <= w + 1) { s = sizes[i]; break; }   // canvas runs 0.5% wide (112.5% vs 112% width)
    el.style.fontSize = s + 'px'; el.style.lineHeight = Math.round(s * 1.1) + 'px';
}
var HERO_SIZES = [76, 64, 54, 46], DT_SIZES = [64, 54, 46, 40];
if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { heroId = null; if (S.zone === 'rail' || S.zone === 'act') renderHero(); });

// The movie panel's icon buttons say what they are only while focused, in one caption at the end of the row.
function paintCap() {
    var b = S.zone === 'act' ? shownActs()[S.ai] : null, cap = $('a-cap');
    if (b && b !== a1) { cap.textContent = b.lastChild.textContent; cap.classList.add('on'); }
    else cap.classList.remove('on');
}

function renderHero() {
    var r = recs[S.ri];
    if (!r || (heroId === r.id && heroWl === r.wl)) return;
    if (heroId !== r.id) {
        var chip = $('h-chip');
        chip.textContent = r.provider || '';
        chip.className = r.streaming ? '' : 'out';
        $('h-note').textContent = r.note || '';
        $('h-title').textContent = r.title;
        fitText($('h-title'), HERO_SIZES);
        $('h-mt').textContent = r.meta || '';
        showImdb(r);
        $('h-desc').textContent = r.desc || '';
        a1.lastChild.textContent = r.connect ? 'Connect Trakt' : (r.streaming === false ? 'Not streaming yet' : 'Open in ' + (r.provider || 'app'));
        a2.style.display = r.connect ? 'none' : '';
        a3.style.display = r.connect ? 'none' : '';
        a4.style.display = r.connect ? 'none' : '';
        a5.style.display = r.connect ? 'none' : '';
    }
    a2.children[0].style.display = r.wl ? 'none' : '';
    a2.children[1].style.display = r.wl ? '' : 'none';
    a2.lastChild.textContent = r.wl ? 'On your watchlist' : 'Add to watchlist';
    a2.classList.toggle('done', !!r.wl);
    heroId = r.id; heroWl = r.wl;
}

/* "Popular on <app>" above the dock, for the focused app */
var infoKey = '';
function renderInfo() {
    var el = $('appinfo'), it = S.zone === 'dock' ? dockItems[S.di] : null, d = it && window.AppInfo && window.AppInfo.get(it.label);
    if (!d) { el.classList.remove('has'); infoKey = ''; return; }
    if (infoKey !== it.label + d.title) {
        infoKey = it.label + d.title;
        $('ai-label').textContent = d.label || 'Popular on ' + it.label;
        $('ai-title').textContent = d.title;
        $('ai-meta').textContent = d.sub || [d.rating ? '★ ' + d.rating : '', d.year, d.genre].filter(Boolean).join(' · ');
    }
    el.classList.add('has');
}
if (window.AppInfo) window.AppInfo.onUpdate = renderInfo;

/* The backdrop follows focus: a dock app -> its icon's colours, then a popular title's backdrop; a rail title -> its
   poster's colours, then its backdrop; anything else -> the wallpaper. */
var lastRi = 0, infoFor = null, infoT = 0;
function syncBackdrop(z) {
    var B = window.Backdrop;
    if (!B) return;
    if (z === 'dock' || z === 'move') {
        // The dock has no backdrop: the wallpaper stays, as it always did. Only the small "Popular on" line is looked up,
        // once focus has rested 300 ms (sweeping across the dock asks nothing).
        B.rest();
        var it = dockItems[S.di];
        if (it && window.AppInfo && infoFor !== it.id) {
            infoFor = it.id; clearTimeout(infoT);
            infoT = setTimeout(function () { window.AppInfo.ensure(it.label, function () { renderInfo(); }); }, 300);
        }
    } else if (z === 'rail' || z === 'act' || z === 'rate' || z === 'dt') {
        var r = z === 'dt' && DT ? DT.r : recs[S.ri], rdir = S.ri >= lastRi ? 1 : -1;
        lastRi = S.ri;
        if (!r || r.connect) return B.rest();
        B.focus('r:' + r.id, {
            // The picture waits until focus has really rested on a title, so moving along the rail asks for nothing
            // and decodes nothing; the popcorn shows once the pause looks deliberate.
            delay: z === 'dt' ? 600 : 2400, loaderAt: 700, loader: true,
            image: function (cb) { cb(r.bd || null); },
            ahead: function () { var n = recs[S.ri + rdir]; return [n && n.bd]; }
        });
    } else B.rest();
}

var lastMode = 'dock', heroT = 0;
function paint() {
    var z = S.zone === 'cc' ? ccReturn : S.zone;                // the launcher looks as it did before the panel opened
    setOn('d', (z === 'dock' || z === 'move') ? dCells[S.di] : null);
    setMoving(z === 'move' ? dCells[S.di] : null);
    setOn('p', z === 'rail' ? pCells[S.ri] : null);
    setOn('a', z === 'act' ? shownActs()[S.ai] : null);
    var mode = (z === 'apps' || z === 'sheet' || z === 'sw' || z === 'srch') ? 'apps' : z === 'full' ? 'full' : (z === 'rail' || z === 'act' || z === 'rate' || z === 'dt' ? 'rail' : (z === null ? 'rest' : 'dock'));
    stage.classList.toggle('z-dock', z === 'dock' && S.di < dCells.length - 1);     // the full-screen hint, except under the home button
    setOn('hm', z === 'home' ? $('homebtn') : null);
    if (z === 'rail' || z === 'act' || z === 'rate' || z === 'dt') {               // the column rises to the focused row
        var pos = rows[S.row].pos || 0;
        if (stage.style.getPropertyValue('--rowpos') !== String(pos)) {
            stage.style.setProperty('--rowpos', pos);
            rows.forEach(function (R) { R.el.classList.toggle('above', (R.pos || 0) < pos); });
        }
    }
    // only when the mode changes: re-setting the same class on the stage still makes the browser re-check every rule
    // that hangs off it, on every key press
    if (mode !== lastMode || !stage.classList.contains('m-' + mode)) {
        stage.classList.remove('m-rest', 'm-dock', 'm-rail', 'm-full', 'm-apps');
        stage.classList.add('m-' + mode);
    }
    if (mode === 'rest' && lastMode !== 'rest') (window.onRest || []).forEach(function (fn) { try { fn(); } catch (e) { /* silent */ } });
    lastMode = mode;
    if (z === 'rail' || z === 'act') {
        scrollRail();                                                 // the rail always moves at once
        clearTimeout(heroT);
        // presses coming fast (a held key, quick taps): the title and buttons fill in once they stop, not on every step
        if (quickKey && z === 'rail') heroT = setTimeout(function () { if (S.zone === 'rail') { renderHero(); paintCap(); } }, 140);
        else renderHero();
    }
    if (z === 'act' && window.DeepLinks) window.DeepLinks.prefetch(recs[S.ri]);    // ready by the time Open is pressed
    paintCap();
    syncBackdrop(z);
    renderInfo();
}

function bump(el, dx, dy) {
    if (!el || !el.animate) return;
    el.animate([{ transform: 'none' }, { transform: 'translate(' + dx * 8 + 'px,' + dy * 8 + 'px)' }, { transform: 'none' }],
        { duration: 180, easing: 'ease-out' });
}
