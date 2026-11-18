
var C = window.LAUNCHER_CONFIG, P = window.Platform, MOCK = window.MOCK || null;
function $(id) { return document.getElementById(id); }
// Scripts that are only needed once their feature is used (Diagnostics, the Control Center, the trailer cast): loaded
// on first use, then kept. need(['js/a.js', 'js/b.js'], ready) loads them in order; ready() also runs when they are
// already there. A script that fails to load leaves the feature closed (with a notice).
var loaded = {};
function need(srcs, ready) {
    var i = 0;
    (function next() {
        if (i >= srcs.length) return ready();
        var src = srcs[i++];
        if (loaded[src] === true) return next();
        if (loaded[src]) { loaded[src].push(next); return; }              // already on its way: wait for it
        loaded[src] = [next];
        var s = document.createElement('script');
        s.src = src;
        s.onload = function () { var q = loaded[src]; loaded[src] = true; q.forEach(function (f) { f(); }); };
        s.onerror = function () { delete loaded[src]; toast('Couldn’t load ' + src.replace(/^js\//, '')); };
        document.head.appendChild(s);
    })();
}

function h(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
}

var stage = $('stage'), dock = $('dock'), track = $('rtrack');
var a1 = $('a1'), a2 = $('a2'), a3 = $('a3'), a4 = $('a4'), a5 = $('a5'), acts = $('acts'), rail = $('rail');

var MOON = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style="fill:none;stroke:#B4B8BF;stroke-width:3;stroke-linejoin:round;flex:none"><path d="M21 16.5A9 9 0 0 1 9.5 5 9.5 9.5 0 1 0 21 16.5Z"/></svg>';
var SUN = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style="fill:none;stroke:#B4B8BF;stroke-width:3;stroke-linecap:round"><circle cx="13" cy="13" r="5"/><path d="M13 2v3M13 21v3M2 13h3M21 13h3M5.2 5.2l2.1 2.1M18.7 18.7l2.1 2.1M5.2 20.8l2.1-2.1M18.7 7.3l2.1-2.1"/></svg>';
var CLOUD = '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" style="fill:none;stroke:#B4B8BF;stroke-width:2.6;stroke-linejoin:round"><path d="M7.5 18.5h9a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.5-1A3.75 3.75 0 0 0 7.5 18.5z"/></svg>';
var APPS_ICON = '<svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true"><rect x="6" y="6" width="10" height="10" rx="3"/><rect x="21" y="6" width="10" height="10" rx="3"/><rect x="36" y="6" width="10" height="10" rx="3"/><rect x="6" y="21" width="10" height="10" rx="3"/><rect x="21" y="21" width="10" height="10" rx="3"/><rect x="36" y="21" width="10" height="10" rx="3"/><rect x="6" y="36" width="10" height="10" rx="3"/><rect x="21" y="36" width="10" height="10" rx="3"/><rect x="36" y="36" width="10" height="10" rx="3"/></svg>';
var HOME_ICON = '<svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true"><path d="M8 24 L26 9 L44 24"/><path d="M13 21 V43 H39 V21"/><path d="M22 43 V31 H30 V43"/></svg>';
var SRC_ICON = '<svg width="56" height="36" viewBox="0 0 56 36" aria-hidden="true"><path d="M4 4 H52 V19 L44 32 H12 L4 19 Z"/></svg>';
var PLAY = '<svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true" style="fill:currentColor;stroke:none"><path d="M2 2 L18 11 L2 20 Z"/></svg>';
var PLUS = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 V21 M3 12 H21"/></svg>';
var CHECK = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13 L10 18 L20 6"/></svg>';
var EYE = '<svg width="26" height="24" viewBox="0 0 26 24" aria-hidden="true"><path d="M2 12 C6 5 20 5 24 12 C20 19 6 19 2 12 Z"/><circle cx="13" cy="12" r="3.2"/></svg>';
var INFO = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11 V17"/><circle cx="12" cy="7.5" r="1.3" fill="currentColor" stroke="none"/></svg>';
var NOPE ='<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 18.4 L18.4 5.6"/></svg>';
var WX_ICONS ={ moon: MOON, sun: SUN, cloud: CLOUD };
var SHAPES = { circle: [32, 36, 120, 120, '60px'], bar: [16, 72, 152, 56, '4px'], arch: [32, 30, 120, 150, '60px 60px 0 0'] };

var dockItems = [], dCells = [], recs = [], pCells = [];
var S = { zone: 'dock', di: 0, ri: 0, ai: 0, si: 0, row: 0 };
// Rows under the dock: For tonight (0), Watchlist (1) and TV shows (2), shown in the order ORDER gives. One row is
// "active" at a time: recs, pCells, track and S.ri always describe the active one, so everything that works on the rail
// works on any row.
var rows = [{ list: [], cells: [], track: $('rtrack'), el: $('rail'), ri: 0 }, { list: [], cells: [], track: $('rtrack2'), el: $('rail2'), ri: 0 },
    { list: [], cells: [], track: $('rtrack3'), el: $('rail3'), ri: 0 }];
var ORDER = [0, 2, 1];                                           // top to bottom: For tonight, TV shows, Watchlist
function shown(k) { return rows[k].el.style.display !== 'none'; }
function rowsShown() { return ORDER.filter(function (k) { return rows[k].list.length; }); }
// Each shown row 436 px below the last (its pos); the column moves by pos in rail mode, see paint().
function layoutRows() {
    var pos = 0;
    ORDER.forEach(function (k) { var R = rows[k]; R.pos = pos; if (shown(k)) { R.el.style.top = (956 + 436 * pos) + 'px'; pos++; } });
}
function useRow(k) {
    rows[S.row].ri = S.ri;
    S.row = k; recs = rows[k].list; pCells = rows[k].cells; track = rows[k].track;
    S.ri = Math.min(rows[k].ri, Math.max(0, recs.length - 1)); heroId = null;
}
var srcList = [], srcRows = [], heroId = null, heroWl = null;

/* ---------- build ---------- */


// An app's tile: its own icon, else a bundled logo, else its name. Never a generic placeholder:
// the icon module reports shared placeholder pictures as null, and may do so after the fact.
function paintTile(t, it) {
    function clear() { t.textContent = ''; t.style.background = it.tone || '#16181C'; }
    function fallback() {
        clear();
        var b = it.brand && window.BRANDS && window.BRANDS[it.brand];
        if (!b) { t.textContent = it.label; return; }
        t.style.background = b.bg;
        var m = new Image();
        m.alt = ''; m.className = 'mark';
        m.style.cssText = 'left:' + b.p[1] + '%;top:' + b.p[0] + '%;width:' + (100 - 2 * b.p[1]) + '%;height:' + (100 - 2 * b.p[0]) + '%';
        m.onerror = function () { clear(); t.textContent = it.label; };
        m.src = 'img/brands/' + it.brand + '.svg';
        t.appendChild(m);
        if (window.Icons) window.Icons.status[it.id] = (window.Icons.status[it.id] || 'no icon') + ' -> bundled mark';
    }
    clear();
    if ((it.icon || it.pkg) && window.Icons) {
        window.Icons.get(it, function (src, bg) {
            if (!src) { fallback(); return; }
            clear();
            if (bg) t.style.background = bg;                       // wide tile: the icon's own colour fills the sides
            var im = new Image();
            im.alt = ''; im.onerror = fallback; im.src = src;
            t.appendChild(im);
        });
    } else { fallback(); }
}

function buildDock() {
    dock.textContent = '';
    dCells = [];
    dockItems.concat([{ kind: 'apps', label: 'Apps' }, { kind: 'src', label: 'Sources' }]).forEach(function (it) {
        var c = h('div', 'cell dcell'), t = h('div', 'tile');
        if (it.kind === 'apps') t.innerHTML = APPS_ICON;
        else if (it.kind === 'src') t.innerHTML = SRC_ICON;
        else paintTile(t, it);
        c.appendChild(t);
        dock.appendChild(c);
        dCells.push(c);
    });
    // Glass pill behind the tiles: flat translucent fill + brighter top edge. No blur, no shadow.
    if (dCells.length) {
        var pill = h('div', 'pill'), first = dCells[0], last = dCells[dCells.length - 1];
        dock.insertBefore(pill, dock.firstChild);
    }
    if (S.di >= dCells.length) S.di = 0;
}

function buildRail() { buildRow(S.row); pCells = rows[S.row].cells; }
function buildRow(k) {
    var R = rows[k], tr = R.track, cells = [];
    tr.textContent = '';
    R.list.forEach(function (r) {
        var c = h('div', 'cell pcell'), t = h('div', 'tile');
        t.style.background = r.bg || '#2E323A';
        if (r.art) {
            var im = new Image();
            im.width = 184; im.height = 276; im.alt = ''; im.decoding = 'async';   // decoded off the main thread
            im.src = r.art;
            t.appendChild(im);
        } else {
            var s = SHAPES[r.shape] || SHAPES.circle, sh = h('div', 'shape');
            sh.style.cssText = 'left:' + s[0] + 'px;top:' + s[1] + 'px;width:' + s[2] + 'px;height:' + s[3] + 'px;border-radius:' + s[4] + ';background:' + (r.fg || '#555');
            t.appendChild(sh);
            t.appendChild(h('div', 'pt', r.title));
        }
        var tick = h('div', 'tick');
        tick.innerHTML = CHECK;
        t.appendChild(tick);
        c.appendChild(t);
        c.appendChild(h('div', 'prov', r.prov || r.provider || ''));
        if (r.wl) c.classList.add('wl');
        tr.appendChild(c);
        cells.push(c);
    });
    R.cells = cells;
    R.el.style.display = R.list.length ? '' : 'none';
    if (R.ri >= R.list.length) R.ri = 0;
    if (k === S.row && S.ri >= R.list.length) S.ri = 0;
    railEmpty(false);
}
// Nothing on either row: For tonight stays, with a line saying why instead of a blank space.
var recsFailed = false;
function railEmpty(failed) {
    if (failed) recsFailed = true;
    var none = !rowsShown().length, msg = $('rempty');
    if (!none) { recsFailed = false; msg.classList.remove('on'); layoutRows(); return; }
    rows[0].el.style.display = '';
    layoutRows();
    msg.textContent = !(window.Recs && window.Recs.hasKey) ? 'No picks yet: add a TMDB key to config.local.js and the popcorn starts popping'
        : (recsFailed ? 'The film reel jammed, so no picks right now. Settle tries again when you’re back' : 'Popping tonight’s picks… back in a moment');
    msg.classList.add('on');
}
