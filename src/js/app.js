/* Settle: shell, focus model, clock. No framework. */
(function () {
    'use strict';

    var C = window.LAUNCHER_CONFIG, P = window.Platform, MOCK = window.MOCK || null;
    function $(id) { return document.getElementById(id); }
    function h(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt != null) e.textContent = txt;
        return e;
    }

    var stage = $('stage'), dock = $('dock'), track = $('rtrack'), bar = $('bar');
    var a1 = $('a1'), a2 = $('a2'), a3 = $('a3'), a4 = $('a4'), acts = $('acts'), rail = $('rail');
    bar.style.position = 'absolute';

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
    var NOPE = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 18.4 L18.4 5.6"/></svg>';
    var WX_ICONS ={ moon: MOON, sun: SUN, cloud: CLOUD };
    var SHAPES = { circle: [32, 36, 120, 120, '60px'], bar: [16, 72, 152, 56, '4px'], arch: [32, 30, 120, 150, '60px 60px 0 0'] };

    var dockItems = [], dCells = [], recs = [], pCells = [];
    var S = { zone: 'dock', di: 0, ri: 0, ai: 0, si: 0, row: 0 };
    // Two rows under the dock: For tonight (recommendations) and Watchlist. One row is "active" at a time: recs, pCells,
    // track and S.ri always describe the active one, so everything that works on the rail works on either row.
    var rows = [{ list: [], cells: [], track: $('rtrack'), el: $('rail'), ri: 0 }, { list: [], cells: [], track: $('rtrack2'), el: $('rail2'), ri: 0 }];
    function useRow(k) {
        rows[S.row].ri = S.ri;
        S.row = k; recs = rows[k].list; pCells = rows[k].cells; track = rows[k].track;
        S.ri = Math.min(rows[k].ri, Math.max(0, recs.length - 1)); heroId = null;
    }
    var srcList = [], srcRows = [], heroId = null, heroWl = null;

    /* ---------- build ---------- */

    function parkBar() { if (bar.parentNode !== stage) { bar.style.opacity = 0; stage.appendChild(bar); } }

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
        parkBar();
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
        parkBar();
        tr.textContent = '';
        R.list.forEach(function (r) {
            var c = h('div', 'cell pcell'), t = h('div', 'tile');
            t.style.background = r.bg || '#2E323A';
            if (r.art) {
                var im = new Image();
                im.width = 184; im.height = 276; im.alt = '';
                // TMDB only sends its CORS header when the request carries an Origin, so a poster this TV cached earlier (without
                // one) cannot be re-used for a cross-origin read. A distinct URL is a distinct cache entry; if even that fails the
                // poster is shown the plain way and its colours come from the tile instead.
                im.crossOrigin = 'anonymous';
                im.onerror = function () { im.onerror = null; im.removeAttribute('crossorigin'); im.src = r.art; };
                im.src = r.art + (r.art.indexOf('?') < 0 ? '?cors=1' : '&cors=1');
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
    }

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

    function barAt(parent, x, y, w) {
        var jump = bar.parentNode !== parent || bar.style.opacity !== '1';
        if (bar.parentNode !== parent) parent.appendChild(bar);
        if (jump) bar.style.transition = 'none';
        bar.style.transform = 'translate(' + x + 'px,' + y + 'px) scaleX(' + (w / 198) + ')';
        if (jump) { bar.offsetWidth; bar.style.transition = ''; }
        bar.style.opacity = 1;
    }
    function barTo(cell, wide) { barAt(wide ? track : dock, cell.offsetLeft + (wide ? -7 : -6), wide ? 290 : 134, wide ? 198 : 132); }

    function scrollRail() {
        var off = Math.max(0, S.ri - 1) * 216;
        off = Math.min(off, Math.max(0, recs.length * 216 - 32 - 1728));          // the last poster stops 96 px from the edge, like the first one
        track.style.transform = off ? 'translateX(' + (-off) + 'px)' : '';
    }

    // IMDb rating next to the year and genre: asked once focus rests on a title for 250 ms (a sweep asks nothing).
    var imdbT = 0;
    function showImdb(r) {
        var el = $('h-imdb');
        el.classList.remove('on');
        clearTimeout(imdbT);
        if (!window.Recs || !window.Recs.imdb || r.connect) return;
        imdbT = setTimeout(function () {
            window.Recs.imdb(r, function (v) {
                if (recs[S.ri] !== r) return;                                   // focus moved on meanwhile
                el.lastChild.textContent = v;
                el.classList.add('on');
            });
        }, 250);
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
            $('h-mt').textContent = r.meta || '';
            showImdb(r);
            $('h-desc').textContent = r.desc || '';
            a1.lastChild.textContent = r.connect ? 'Connect Trakt' : (r.streaming === false ? 'Not streaming yet' : 'Open in ' + (r.provider || 'app'));
            a2.style.display = r.connect ? 'none' : '';
            a3.style.display = r.connect ? 'none' : '';
            a4.style.display = r.connect ? 'none' : '';
        }
        a2.children[0].style.display = r.wl ? 'none' : '';
        a2.children[1].style.display = r.wl ? '' : 'none';
        a2.lastChild.textContent = r.wl ? 'On watchlist' : 'Watchlist';
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
        } else if (z === 'rail' || z === 'act' || z === 'rate') {
            var r = recs[S.ri], rdir = S.ri >= lastRi ? 1 : -1;
            lastRi = S.ri;
            if (!r || r.connect) return B.rest();
            B.focus('r:' + r.id, {
                colors: function () { return B.colors('r:' + r.id, function () { var c = pCells[S.ri]; return { el: c && c.querySelector('img'), bg: r.bg }; }); },
                image: function (cb) { cb(r.bd || null); },
                ahead: function () { var n = recs[S.ri + rdir]; return [n && n.bd]; }
            });
        } else B.rest();
    }

    var lastMode = 'dock';
    function paint() {
        var z = S.zone === 'cc' ? ccReturn : S.zone;                // the launcher looks as it did before the panel opened
        setOn('d', (z === 'dock' || z === 'move') ? dCells[S.di] : null);
        setMoving(z === 'move' ? dCells[S.di] : null);
        setOn('p', z === 'rail' ? pCells[S.ri] : null);
        setOn('a', z === 'act' ? [a1, a2, a3, a4][S.ai] : null);
        var mode = (z === 'apps' || z === 'sheet' || z === 'sw') ? 'apps' : z === 'full' ? 'full' : (z === 'rail' || z === 'act' || z === 'rate' ? 'rail' : (z === null ? 'rest' : 'dock'));
        stage.classList.toggle('z-dock', z === 'dock' && S.di < dCells.length - 1);     // the full-screen hint, except under the home button
        setOn('hm', z === 'home' ? $('homebtn') : null);
        stage.classList.toggle('row2', S.row === 1 && (z === 'rail' || z === 'act' || z === 'rate'));
        stage.classList.remove('m-rest', 'm-dock', 'm-rail', 'm-full', 'm-apps');
        stage.classList.add('m-' + mode);
        if (mode === 'rest' && lastMode !== 'rest') (window.onRest || []).forEach(function (fn) { try { fn(); } catch (e) { /* silent */ } });
        lastMode = mode;
        if (z === 'dock' || z === 'move') bar.style.opacity = 0;          // the dock's focus is the enlarged tile with a white outline, no bar
        else if (z === 'rail' && pCells[S.ri]) barTo(pCells[S.ri], true);
        else if (z !== 'apps' && z !== 'sheet') bar.style.opacity = 0;      // (the switcher has no bar either: its focus is the outline)
        if (z === 'rail' || z === 'act') { scrollRail(); renderHero(); }
        syncBackdrop(z);
        renderInfo();
    }

    function bump(el, dx, dy) {
        if (!el || !el.animate) return;
        el.animate([{ transform: 'none' }, { transform: 'translate(' + dx * 8 + 'px,' + dy * 8 + 'px)' }, { transform: 'none' }],
            { duration: 180, easing: 'ease-out' });
    }

    /* ---------- keys ---------- */

    // 405 = remote's yellow key, 68 = "d" in the desktop preview: both open diagnostics
    // 404 = green (the app switcher; 71 = "g" in the preview), 72 = "h" in the preview: a Home press as Vetro delivers it
    var KEYS = { 37: 'L', 38: 'U', 39: 'R', 40: 'D', 13: 'OK', 10009: 'B', 27: 'B', 8: 'B', 405: 'Y', 68: 'Y', 406: 'E', 69: 'E', 403: 'C', 67: 'C', 404: 'G', 71: 'G', 72: 'H', 10252: 'P', 415: 'P', 19: 'P', 179: 'P', 80: 'P', 48: 'N0', 49: 'N1', 50: 'N2', 51: 'N3' };
    try { tizen.tvinputdevice.registerKey('ColorF1Green'); } catch (e) { /* not on a TV */ }
    try { tizen.tvinputdevice.registerKey('ColorF2Yellow'); tizen.tvinputdevice.registerKey('ColorF3Blue'); tizen.tvinputdevice.registerKey('ColorF0Red'); ['MediaPlayPause', 'MediaPlay', 'MediaPause', '0', '1', '2', '3'].forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* ignore */ } }); } catch (e) { /* not on a TV */ }

    function dockKey(d) {
        var n = dCells.length;
        if (d === 'L') { if (S.di > 0) S.di--; else bump(dCells[S.di], -1, 0); }
        else if (d === 'R') { if (S.di < n - 1) S.di++; else bump(dCells[S.di], 1, 0); }
        else if (d === 'D') { if (rows[0].list.length) { useRow(0); S.zone = 'rail'; } else if (rows[1].list.length) { useRow(1); S.zone = 'rail'; } }
        else if (d === 'U' && S.di === n - 1) { S.zone = 'home'; }          // the rightmost tile sits under the Samsung Home button
        else if (d === 'U') { S.zone = 'full'; clearTimeout(idleT); }      // full-screen wallpaper + centred clock
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
        else if (d === 'U') { if (S.row === 1 && rows[0].list.length) useRow(0); else { S.zone = 'act'; S.ai = 0; } }
        else if (d === 'D') { if (S.row === 0 && rows[1].list.length) useRow(1); else bump(pCells[S.ri], 0, 1); }
        else if (d === 'B') { S.zone = 'dock'; }
        else if (d === 'OK') { openItem(); return; }
        paint();
    }

    function openItem() {
        var r = recs[S.ri];
        if (r.connect) openTrakt(); else P.launchProvider(r.provider);
    }

    function actKey(d) {
        var single = recs[S.ri] && recs[S.ri].connect;                 // the connect card has no watchlist button
        if (d === 'L') { if (S.ai) S.ai--; else bump(acts, -1, 0); }
        else if (d === 'R') { if (S.ai < (single ? 0 : 3)) S.ai++; else bump(acts, 1, 0); }
        else if (d === 'D') { S.zone = 'rail'; }
        else if (d === 'U' || d === 'B') { S.zone = 'dock'; }
        else if (d === 'OK') { if (S.ai === 3) { notInterested(); return; } if (S.ai === 2) { openRate(); return; } if (S.ai) toggleWatchlist(); else { openItem(); return; } }
        paint();
    }

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
        else if (rows[1 - S.row].list.length) { useRow(1 - S.row); S.zone = 'rail'; }
        else S.zone = 'dock';
        armIdle(); paint();
        return i;
    }

    /* "Not interested": the title leaves both rows and is never offered again (kept on this TV). With Trakt, it is also
       hidden from Trakt's recommendations, and taken off your watchlist if it was on it. */
    function notInterested() {
        var r = recs[S.ri];
        if (!r || r.connect) return;
        if (window.Recs && window.Recs.dismiss) window.Recs.dismiss(r.tmdb);
        dropRec(r);
        toast('Got it. ' + r.title + ' won’t come up again');
        if (r.wl) {
            if (window.Recs) window.Recs.setWl(r.tmdb, false);
            if (trakt()) window.Trakt.setWatchlist(r, false).catch(function () { /* best effort */ }); else wlSave(r.id, false);
        }
        if (trakt()) window.Trakt.hideRecommendation(r).catch(function () { /* still gone here: the local list keeps it out */ });
    }

    function submitWatched(rating, fav) {
        var rt = RT, r = rt.r;
        if (window.Recs && window.Recs.addWatched) window.Recs.addWatched(r.tmdb);          // remembered at once: a refresh can no longer bring it back
        $('rate').classList.remove('open'); RT = null;
        var i = dropRec(r);                                                // optimistic: it leaves both rows now
        toast(fav ? 'Logged · rated 10/10 · added to favorites. Great pick!' : (rating ? 'Logged as watched · rated ' + rating + '/10' : 'Logged as watched'));
        window.Trakt.markWatched(r, rating, fav).then(function (res) {
            if (window.Recs && window.Recs.forget) window.Recs.forget(r.tmdb);
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
        if (window.Recs) window.Recs.setWl(r.tmdb, on);
        rows.forEach(function (R) { var j = R.list.indexOf(r); if (j >= 0 && R.cells[j]) R.cells[j].classList.toggle('wl', on); });
        if (S.row !== 1 && !r.connect) {                              // never rearranged under the user's focus
            var w = rows[1].list, j = w.indexOf(r);
            if (on && j < 0) w.unshift(r); else if (!on && j >= 0) w.splice(j, 1);
            buildRow(1);
        }
        renderHero();
    }
    function toggleWatchlist() {
        var r = recs[S.ri], i = S.ri, on = !r.wl;
        setWl(r, i, on);
        if (window.Trakt) window.Trakt.setWatchlist(r, on).catch(function () { setWl(r, i, !on); });   // reconcile on failure
    }

    /* "Connect Trakt" card: first item of the rail until the account is linked */
    var CONNECT = { id: 'connect', connect: true, title: 'Connect Trakt', bg: '#16181C', shape: 'circle', fg: '#FFB23F',
        prov: 'Trakt', provider: 'Trakt', streaming: true, note: 'Picks from what you watch',
        meta: 'About a minute, on your phone',
        desc: 'Link your Trakt account to see recommendations and add titles to your watchlist.' };

    var pendingRecs = null;
    function applyRecs(list) {
        var wl = wlLoad(), t = trakt();
        list.forEach(function (r) { if (!t && wl[r.id]) r.wl = true; });
        var tonight = list.filter(function (r) { return !r.wl && !r.connect; }), watch = list.filter(function (r) { return r.wl && !r.connect; });
        if (window.Trakt && window.Trakt.enabled && !t) tonight = [CONNECT].concat(tonight);
        rows[0].list = tonight; rows[1].list = watch; rows[0].ri = rows[1].ri = 0;
        buildRow(0); buildRow(1);
        rows[0].track.style.transform = ''; rows[1].track.style.transform = '';
        S.row = tonight.length || !watch.length ? 0 : 1;
        recs = rows[S.row].list; pCells = rows[S.row].cells; track = rows[S.row].track; S.ri = 0; heroId = null;
        paint();
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
    (window.onRest = window.onRest || []).push(function () { if (pendingRecs) { var l = pendingRecs; pendingRecs = null; applyRecs(l); } });

    /* One-line notice, top right. One-shot timer, no polling. */
    var toastT = 0;
    function toast(msg) {
        var t = $('toast');
        t.textContent = msg;
        t.style.opacity = 1; t.style.transform = 'none';
        clearTimeout(toastT);
        toastT = setTimeout(function () { t.style.opacity = 0; t.style.transform = ''; }, 5000);
    }

    /* Trakt device-code screen */
    function closeTrakt() {
        $('trakt').classList.remove('open');
        $('t-code').textContent = '';
    }
    function openTrakt() {
        S.zone = 'trk';
        clearTimeout(idleT);                                          // the user is on their phone; do not drop to Rest
        $('t-url').textContent = '';
        $('t-code').textContent = '';
        $('trakt').classList.add('open');
        bar.style.opacity = 0;
        window.Trakt.start({
            code: function (c, url) { $('t-code').textContent = c; $('t-url').textContent = url; },
            status: function (s) { $('t-status').textContent = s; },
            done: function () {
                closeTrakt();
                S.zone = 'dock'; armIdle();
                toast('Trakt connected. Loading your picks…');
                if (window.Recs) window.Recs.refresh(true);           // rebuild the rail from Trakt's picks
                if (window.Recs) { var c = window.Recs.cached(); if (!c) applyRecs(rows[0].list.concat(rows[1].list).filter(function (r) { return !r.connect; })); }
                paint();
            }
        });
    }
    function trkKey(d) {
        if (d !== 'B') return;
        window.Trakt.cancel();
        closeTrakt();
        S.zone = 'rail'; armIdle();
        paint();
    }

    /* All apps: every installed app, A-Z, 6 columns. Icons are decoded for the visible rows plus one ahead only. */
    var COLS = 6, ROWS = 3, ROW_PITCH = 284;
    var aItems = [], aCells = [], aSel = 0, aTop = 0, aLoaded = {};

    function appsLoad(fromRow, toRow) {
        for (var r = fromRow; r <= toRow; r++) {
            for (var c = 0; c < COLS; c++) {
                var i = r * COLS + c;
                if (i >= aItems.length || aLoaded[i]) continue;
                aLoaded[i] = 1;
                paintTile(aCells[i].firstChild, aItems[i]);
            }
        }
    }

    function appsPaint() {
        var row = Math.floor(aSel / COLS), grid = $('a-grid'), cell = aCells[aSel];
        if (row < aTop) aTop = row; else if (row > aTop + ROWS - 1) aTop = row - ROWS + 1;       // whole rows, focused tile always in view
        grid.style.transform = 'translateY(' + (24 - aTop * ROW_PITCH) + 'px)';
        appsLoad(aTop, aTop + ROWS);                                                               // the visible rows + one ahead
        setOn('ap', cell);
        barAt(grid, cell.offsetLeft - 9, cell.offsetTop + 194, 198);
    }

    function markDock() {                                           // a number on every app that is on the dock
        var ids = P.dockIds();
        aCells.forEach(function (c, i) {
            var pos = ids.indexOf(aItems[i].id);
            if (pos >= 0) { c.classList.add('indock'); c.setAttribute('data-pos', pos + 1); }
            else { c.classList.remove('indock'); c.removeAttribute('data-pos'); }
        });
    }

    function buildAppsGrid(sel) {
        aItems = mockIcons(P.allInstalled());
        var grid = $('a-grid');
        parkBar();                                                  // the bar lives inside the grid while it is open
        grid.textContent = ''; aCells = []; aLoaded = {};
        aItems.forEach(function (it, i) {
            var c = h('div', 'cell acell'), t = h('div', 'tile atile');
            c.style.setProperty('--r', Math.min(Math.floor(i / COLS), 3));          // rows rise in 25 ms apart
            c.appendChild(t);
            c.appendChild(h('div', 'albl', it.label));
            grid.appendChild(c); aCells.push(c);
        });
        aSel = Math.max(0, Math.min(sel, aItems.length - 1));
        markDock();
    }
    function rebuildApps() { buildAppsGrid(aSel); if (aCells.length) appsPaint(); }

    function openApps() {
        aTop = 0;
        buildAppsGrid(0);
        S.zone = 'apps';
        bar.style.opacity = 0;
        $('apps').classList.add('open');
        paint();
        if (aCells.length) appsPaint();
        // Drawn at once from what we know; the TV is asked again, and a newly installed app joins the grid in place
        // (focus stays on the same app).
        P.refresh().then(function (changed) {
            if (!changed || S.zone !== 'apps') return;
            var keep = aItems[aSel] && aItems[aSel].id;
            buildAppsGrid(0);
            var i = keep ? aItems.map(function (x) { return x.id; }).indexOf(keep) : 0;
            aSel = i < 0 ? 0 : i;
            if (aCells.length) appsPaint();
        });
    }

    function teardownApps() {
        $('apps').classList.remove('open');
        setOn('ap', null);
        parkBar();                                                  // the bar lives inside the grid while it is open
        $('a-grid').textContent = ''; aCells = []; aLoaded = {};
    }

    function closeApps() {                                          // back to the dock, focus on the Apps tile (S.di is untouched)
        teardownApps();
        S.zone = 'dock';
        paint();
    }

    function appsKey(d) {
        var n = aItems.length, col = aSel % COLS, row = Math.floor(aSel / COLS), rows = Math.ceil(n / COLS);
        if (d === 'B') return closeApps();
        if (!n) return;
        if (d === 'L') { if (col > 0) aSel--; }                                     // no wrapping, no bump: focus simply stays
        else if (d === 'R') { if (col < COLS - 1 && aSel < n - 1) aSel++; }
        else if (d === 'U') { if (row > 0) aSel -= COLS; }
        else if (d === 'D') { if (row < rows - 1) aSel = Math.min(aSel + COLS, n - 1); }   // into a short last row: its last tile
        else if (d === 'OK') { return; }                                           // launches on key release (a long press opens the options)
        appsPaint();
    }

    /* Control Center: an overlay zone. Opening remembers the zone we came from; closing returns to it, so every
       focus index (dock tile, poster, hero button, grid tile) is exactly where it was. */
    var cc = null, ccReturn = null;
    function openCC() {
        if (!window.ControlCenter || !window.Vetro) return;
        if (!cc) cc = window.ControlCenter.create($('cc'), window.LauncherControls ? window.LauncherControls.compose(window.Vetro.adapter) : window.Vetro.adapter, {
            requestClose: closeCC, afterAction: closeCC,
            backdrop: function () {                                  // the wallpaper behind the panel (already decoded: baking costs one tiny canvas draw)
                var host = $('cc'), p = host.firstChild;
                return { source: $('wall'), stageWidth: 1920, rect: { x: host.offsetLeft, y: host.offsetTop, w: p ? p.offsetWidth : 784, h: p ? p.offsetHeight : 780 } };
            }
        });
        ccReturn = S.zone;
        clearTimeout(holdT); setPressing(null); okHold = null;
        S.zone = 'cc';
        stage.classList.add('cc-open');
        cc.open();
    }
    function closeCC() {
        if (S.zone !== 'cc') return;
        cc.close();
        stage.classList.remove('cc-open');
        S.zone = ccReturn;
        if (S.zone !== null) armIdle();
        paint();
    }

    /* App switcher: the apps still open in the background, most recent first. OK returns to one, Up closes it, Back
       goes home. Free memory (from Vetro, when it is up) sits in the corner and is read again after every close. */
    var swItems = [], swCells = [], swSel = 0, swBusy = false, swOpening = false, swMemT = 0, swMemLast = 0;
    function openSwitcher() {
        if (swOpening || S.zone === 'sw' || ['trk', 'diag', 'sheet', 'move', 'src', 'cc', 'rate'].indexOf(S.zone) >= 0) return;
        swOpening = true;
        P.running().then(function (list) {
            swOpening = false;
            if (!list.length) { toast('No open apps'); return; }
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
            c.appendChild(t); c.appendChild(h('div', 'swlbl', x.it.label));
            row.appendChild(c); swCells.push(c);
        });
        var all = h('div', 'cell swcell swall');
        all.appendChild(h('div', 'tile swtile', 'Close all'));
        all.appendChild(h('div', 'swlbl'));
        row.appendChild(all); swCells.push(all);
        swCount();
    }
    function swCount() { swCells[swCells.length - 1].lastChild.textContent = swItems.length === 1 ? '1 app' : swItems.length + ' apps'; }
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
        if (back && !document.hidden) homePressed('focus'); else homeLog('focus');
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

    /* Move mode: hold OK on a dock app, then Left / Right to reposition it */
    var moveFrom = 0;
    function startMove() {
        moveFrom = S.di; S.zone = 'move'; clearTimeout(idleT);
        toast('Left / Right to move · OK to place · Back to cancel');
        paint();
    }
    function swapDock(i, j) {
        var t = dockItems[i]; dockItems[i] = dockItems[j]; dockItems[j] = t;
        var c = dCells[i]; dCells[i] = dCells[j]; dCells[j] = c;
        dCells.forEach(function (x) { dock.appendChild(x); });      // re-seat the tiles in their new order; the glass pill stays first
    }
    function moveKey(d) {
        var n = dockItems.length;
        if (d === 'L' && S.di > 0) { swapDock(S.di, S.di - 1); S.di--; }
        else if (d === 'R' && S.di < n - 1) { swapDock(S.di, S.di + 1); S.di++; }
        else if (d === 'OK') { P.setDock(dockItems.map(function (x) { return x.id; })); S.zone = 'dock'; armIdle(); toast('Dock saved.'); }
        else if (d === 'B') { applyDock(); S.di = moveFrom; S.zone = 'dock'; armIdle(); }          // put everything back
        paint();
    }

    /* Options for an app in All apps: add to the dock, replace one, or remove it. The dock holds P.maxApps. */
    var shIt = null, shMode = 'menu', shSel = 0, shRows = [], shOpts = [];

    function sheetPaint() {
        var ids = P.dockIds(), on = ids.indexOf(shIt.id) >= 0, full = ids.length >= P.maxApps, list = $('sh-list');
        list.textContent = ''; shRows = []; shOpts = [];
        if (shMode === 'menu') {
            $('sh-title').textContent = shIt.label;
            $('sh-sub').textContent = 'Dock ' + ids.length + ' of ' + P.maxApps + (on ? ' · on your dock at position ' + (ids.indexOf(shIt.id) + 1) : (full ? ' · full' : ''));
            shOpts.push({ t: 'Open', k: 'open' });
            if (!on && !full) shOpts.push({ t: 'Add to dock', k: 'add' });
            if (!on) shOpts.push({ t: 'Replace an app on the dock…', k: 'pick' });
            if (on && ids.length > 1) shOpts.push({ t: 'Remove from dock', k: 'remove' });
            shOpts.push({ t: 'Hide from All apps', k: 'hide' });
            shOpts.push({ t: 'App info', k: 'info' });
            if (P.hiddenCount() > 0) shOpts.push({ t: 'Show hidden apps (' + P.hiddenCount() + ')', k: 'unhide' });
            if (P.hasSavedDock()) shOpts.push({ t: 'Reset the dock to the default apps', k: 'reset' });
            shOpts.push({ t: 'Cancel', k: 'cancel' });
        } else if (shMode === 'info') {
            var inf = P.appInfo(shIt.id) || {};
            $('sh-title').textContent = shIt.label;
            $('sh-sub').textContent = 'App details';
            [['App ID', shIt.id], ['Package', inf.pkg || shIt.pkg || 'n/a'], ['Version', inf.version || 'n/a'],
             ['On the dock', on ? 'Position ' + (ids.indexOf(shIt.id) + 1) : 'No'],
             ['Icon', (window.Icons && window.Icons.status[shIt.id]) || (shIt.icon ? 'not loaded' : 'none')]]
                .forEach(function (l) { shOpts.push({ t: l[0], k: 'line', r: l[1] }); });
        } else {
            $('sh-title').textContent = 'Replace which app?';
            $('sh-sub').textContent = 'It will be swapped for ' + shIt.label + ', in the same spot.';
            dockItems.forEach(function (d, i) { shOpts.push({ t: d.label, k: 'swap', i: i, r: 'Position ' + (i + 1) }); });
        }
        shOpts.forEach(function (o) {
            var r = h('div', 'erow');
            r.appendChild(h('span', null, o.t));
            if (o.r) r.appendChild(h('span', 'off', o.r));
            list.appendChild(r); shRows.push(r);
        });
        shSel = Math.max(0, Math.min(shSel, shRows.length - 1));
        setOn('sh', shRows[shSel]);
    }
    function openSheet(it) {
        shIt = it; shMode = 'menu'; shSel = 0; S.zone = 'sheet';
        $('sheet').classList.add('open');
        sheetPaint();
    }
    function closeSheet() {
        $('sheet').classList.remove('open');
        setOn('sh', null);
        S.zone = 'apps';
        paint();
    }
    function commitDock(ids, msg) {                                 // save, rebuild the dock behind the screen, keep the grid's focus bar
        P.setDock(ids);
        applyDock();
        S.di = dockItems.length;                                    // the Apps tile has moved if the dock grew or shrank
        closeSheet();
        markDock();
        if (aCells.length) appsPaint();
        toast(msg);
    }
    function sheetKey(d) {
        var o = shOpts[shSel], ids = P.dockIds();
        if (d === 'B') { if (shMode !== 'menu') { shMode = 'menu'; shSel = 0; return sheetPaint(); } return closeSheet(); }
        if (d === 'U') { if (shSel > 0) shSel--; }
        else if (d === 'D') { if (shSel < shRows.length - 1) shSel++; }
        else if (d === 'OK' && o) {
            if (o.k === 'cancel') return closeSheet();
            if (o.k === 'line') return;
            if (o.k === 'open') { P.launch(shIt.id); return closeSheet(); }
            if (o.k === 'info') { shMode = 'info'; shSel = 0; return sheetPaint(); }
            if (o.k === 'hide') { P.hideApp(shIt.id); closeSheet(); rebuildApps(); return toast('Hidden from All apps.'); }
            if (o.k === 'unhide') { P.unhideAll(); closeSheet(); rebuildApps(); return toast('Hidden apps are back.'); }
            if (o.k === 'reset') return commitDock(null, 'Dock reset to the default apps.');
            if (o.k === 'pick') { shMode = 'pick'; shSel = 0; return sheetPaint(); }
            if (o.k === 'add') { if (ids.length >= P.maxApps) return toast('The dock is full: ' + P.maxApps + ' apps.'); ids.push(shIt.id); return commitDock(ids, 'Added ' + shIt.label + ' to the dock.'); }
            if (o.k === 'remove') { ids.splice(ids.indexOf(shIt.id), 1); return commitDock(ids, 'Removed ' + shIt.label + ' from the dock.'); }
            if (o.k === 'swap') { var was = dockItems[o.i].label; ids[o.i] = shIt.id; return commitDock(ids, 'Replaced ' + was + ' with ' + shIt.label + '.'); }
        }
        sheetPaint();
    }

    function mockIcons(list) {                                      // browser preview only: stand-in icon paths
        if (MOCK && MOCK.icons) list.forEach(function (x) { if (MOCK.icons[x.label] && !x.brandFirst) x.icon = MOCK.icons[x.label]; });
        return list;
    }

    function applyDock() {                                          // (re)build the dock from the saved layout
        dockItems = mockIcons(P.layout(C));
        if (window.Icons && P.source() === 'live') window.Icons.prune(P.installedIds());     // only a real list may drop cached icons
        buildDock();
        if (window.AppInfo) window.AppInfo.refresh(dockItems.map(function (x) { return x.label; }));
    }

    /* Sources screen */
    // Samsung's own home screen, from any state: the web API first, then Vetro. A refusal is said on screen with the error.
    function openSamsungHome() {
        var ids = C.samsungHome || ['com.samsung.tv.coba.newhome'];
        P.launchFirst(ids).catch(function (e) {
            if (!window.Vetro || !window.Vetro.launchApp) throw e;
            return window.Vetro.launchApp(ids[0]);
        }).catch(function (e) { toast('Samsung Home did not open: ' + ((e && e.name) || 'Error') + ': ' + ((e && e.message) || e)); });
    }

    function openSources() {
        S.zone = 'src'; S.si = 0;
        $('sources').classList.add('open');
        P.sources().then(function (list) {
            srcList = list;
            var box = $('s-list');
            box.textContent = ''; srcRows = [];
            list.forEach(function (s) {
                var r = h('div', 'srow');
                r.appendChild(h('span', null, s.label));
                r.appendChild(h('span', null, s.on ? 'Connected' : 'No signal'));
                box.appendChild(r); srcRows.push(r);
            });
            if (!list.length) box.appendChild(h('div', 'srow', 'No inputs reported'));
            setOn('s', srcRows[0] || null);
        });
    }
    function closeSources() {
        $('sources').classList.remove('open');
        setOn('s', null);
        S.zone = 'dock';
        paint();
    }
    function srcKey(d) {
        if (d === 'B') return closeSources();
        if (d === 'U' && S.si > 0) S.si--;
        else if (d === 'D' && S.si < srcRows.length - 1) S.si++;
        else if (d === 'OK' && srcList[S.si]) P.openSource(srcList[S.si]);
        setOn('s', srcRows[S.si] || null);
    }

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
        if (S.zone === 'trk') { window.Trakt.cancel(); closeTrakt(); }   // app was hidden: the code flow was cancelled
        if (S.zone === 'src') { $('sources').classList.remove('open'); setOn('s', null); }
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
        if (['trk', 'diag', 'sheet', 'move', 'src', 'rate', 'sw'].indexOf(S.zone) < 0) openCC();
    }
    function diagToggle() {
        if (S.zone === 'diag') { $('diag').classList.remove('open'); S.zone = 'dock'; armIdle(); paint(); return; }
        if (['trk', 'src', 'apps', 'sheet', 'move', 'cc'].indexOf(S.zone) >= 0) return;
        clearTimeout(idleT);
        S.zone = 'diag'; bar.style.opacity = 0;
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

    var expN = 0;
    document.addEventListener('keydown', function (e) {
        window.__lastKey = e.keyCode;                                  // shown on the diagnostics screen (to check a remapped button)
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
        if (d === 'H') { if (MOCK) homePressed(); return; }                // preview only: on the TV, Home arrives as appcontrol
        if (S.zone === 'diag') {                                        // Back closes; nothing else moves
            if (d === 'B' || d === 'Y') { $('diag').classList.remove('open'); S.zone = 'dock'; armIdle(); paint(); }
            else if (d === 'OK') window.Diag.capture($('d-body'));
            else if (/^N[0-3]$/.test(d)) window.Diag.experiment($('d-body'), +d.charAt(1));
            else if (d === 'R') { expN = expN % 3 + 1; window.Diag.experiment($('d-body'), expN); }        // Right: try the next AI setting (1, 2, 3)
            else if (d === 'L') { expN = 0; window.Diag.experiment($('d-body'), 0); }                      // Left: put them all back
            return;
        }
        if (S.zone === 'rate') { armIdle(); clearTimeout(idleT); rateKey(d); return; }
        if (d === 'Y') {
            if (S.zone === 'trk' || S.zone === 'src' || S.zone === 'apps' || S.zone === 'sheet' || S.zone === 'move' || S.zone === 'sw') return;
            clearTimeout(idleT);
            S.zone = 'diag'; bar.style.opacity = 0;
            window.Diag.show($('d-body'), dockItems);
            $('diag').classList.add('open');
            return;
        }
        if (d === 'C') {                                                                      // the Control Center key opens and closes the panel
            if (S.zone === 'cc') return closeCC();
            if (['trk', 'diag', 'sheet', 'move', 'src', 'sw'].indexOf(S.zone) < 0) openCC();
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
        if (S.zone === 'full') { S.zone = 'dock'; armIdle(); paint(); return; }   // any key comes back
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

    /* ---------- clock & ambient (one timeout, re-armed, never under 1 s) ---------- */

    var clockT = 0, lastDate = '', hhs = document.querySelectorAll('.hh'), mms = document.querySelectorAll('.mm');
    var wxText = '', wxShort = '', wxKind = 'moon';

    function setWeather(long, short, kind) {
        wxText = long; wxShort = short; wxKind = kind || wxKind;
        var ic = WX_ICONS[wxKind];
        $('wx-rest').children[0].innerHTML = ic;
        $('wx-rest').children[1].textContent = long;
        $('al-i').innerHTML = ic;
        $('al-w').textContent = short;
        $('wx-full').children[0].innerHTML = ic;
        $('wx-full').children[1].textContent = long;
    }

    function tick() {
        var d = new Date(), hh = ('0' + d.getHours()).slice(-2), mm = ('0' + d.getMinutes()).slice(-2), i;
        for (i = 0; i < hhs.length; i++) { hhs[i].textContent = hh; mms[i].textContent = mm; }
        var key = d.toDateString();
        if (key !== lastDate) {
            lastDate = key;
            var L = C.locale;
            $('date-rest').textContent = d.toLocaleDateString(L, { weekday: 'long' }) + ', ' + d.toLocaleDateString(L, { day: 'numeric', month: 'long' });
            $('date-full').textContent = $('date-rest').textContent;
            $('al-d').textContent = d.toLocaleDateString(L, { weekday: 'short' }) + ' ' + d.toLocaleDateString(L, { day: 'numeric', month: 'short' });
        }
        clockT = setTimeout(tick, Math.max(1000, 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50));
    }

    /* ---------- launch and return animations ---------- */
    var fx = $('launchfx'), fxEl = null, fxUndo = 0, retT = 0;
    function focusedCell() {
        if (S.zone === 'dock') return dCells[S.di];
        if (S.zone === 'apps') return aCells[aSel];
        if (S.zone === 'sw') return swCells[swSel];
        if (S.zone === 'rail' || S.zone === 'act') return pCells[S.ri];
        return null;
    }
    // Plays the launch animation, then go(). If the app never takes the screen, the launcher comes back after 2.5 s.
    function launchFx(go) {
        var el = focusedCell();
        if (fxEl) fxEl.classList.remove('launching');
        fxEl = el; if (el) el.classList.add('launching');
        fx.classList.add('on');
        clearTimeout(fxUndo);
        fxUndo = setTimeout(function () { if (!document.hidden) returnFx(); }, 2500);
        setTimeout(go, 190);
    }
    function returnFx() {
        clearTimeout(fxUndo);
        if (fxEl) { fxEl.classList.remove('launching'); fxEl = null; }
        fx.classList.remove('on');
        stage.classList.remove('returning'); void stage.offsetWidth; stage.classList.add('returning');
        clearTimeout(retT); retT = setTimeout(function () { stage.classList.remove('returning'); }, 260);
    }
    // Every launch goes through here: the dock, All apps, the rail, Samsung Home, the screensaver.
    (function () {
        var rawLaunch = P.launch, rawProvider = P.launchProvider, rawFirst = P.launchFirst;
        P.launch = function (id, onFail) {
            if (!id) return rawLaunch(id, onFail);
            launchFx(function () { rawLaunch(id, function (e) { returnFx(); if (onFail) onFail(e); }); });
        };
        P.launchProvider = function (name) { launchFx(function () { rawProvider(name); }); };
        P.launchFirst = function (ids) {
            return new Promise(function (ok, no) { launchFx(function () { rawFirst(ids).then(ok, function (e) { returnFx(); no(e); }); }); });
        };
    })();

    document.addEventListener('visibilitychange', function () {
        clearTimeout(clockT); clearTimeout(idleT); clearTimeout(holdT); setPressing(null);
        if (document.hidden) { blurAt = 0; homeLog('hidden'); return; }
        returnFx();
        tick();
        homePressed('visible');
        if (S.zone === 'trk') return;    // mid-login (e.g. approving in another tab): stay on the code screen
        if (S.zone === 'sw' && Date.now() - swOpenedAt < 1500) { armIdle(); return; }   // the tail of the double Home that opened it
        toRest();                        // coming back from another app: start at rest
        (window.onWake || []).forEach(function (fn) { try { fn(); } catch (e) { /* silent */ } });
    });

    /* Launched with the extra  cc=1  (for example from a Vetro Remapper rule that runs
       app_launcher -s SettleTv01.Settle cc 1): open the Control Center. Works on a cold start and when already running. */
    function wantsCC(ac) {
        try { return (ac && ac.appControl && ac.appControl.data || []).some(function (d) { return d.key === 'cc' && String(d.value && d.value[0]) === '1'; }); } catch (e) { return false; }
    }
    function launchCC() {
        setTimeout(function () {                                   // after the wake-from-background reset to rest
            if (['trk', 'diag', 'sheet', 'move', 'src', 'cc'].indexOf(S.zone) < 0) openCC();
        }, 400);
    }
    try {
        window.addEventListener('appcontrol', function () {
            try { if (wantsCC(window.tizen.application.getCurrentApplication().getRequestedAppControl())) launchCC(); else homePressed(); } catch (e) { /* not on a TV */ }
        });
        if (wantsCC(window.tizen.application.getCurrentApplication().getRequestedAppControl())) window.addEventListener('load', launchCC);
    } catch (e) { /* not on a TV */ }

    function fit() {
        var s = Math.min(innerWidth / 1920, innerHeight / 1080);
        stage.style.transform = s === 1 ? '' : 'translate(' + ((innerWidth - 1920 * s) / 2) + 'px,' + ((innerHeight - 1080 * s) / 2) + 'px) scale(' + s + ')';
    }
    window.addEventListener('resize', fit);
    fit();

    /* ---------- boot ---------- */

    a1.innerHTML = PLAY + '<span></span>';
    a2.innerHTML = PLUS + CHECK + '<span></span>';
    a3.innerHTML = EYE + '<span>Watched</span>';
    a4.innerHTML = NOPE + '<span>Not interested</span>';
    $('wx-rest').innerHTML = '<span></span><span></span>';
    $('wx-full').innerHTML = '<span style="display:flex"></span><span></span>';
    $('act-line').innerHTML = '<span id="al-d"></span><b class="dot"></b><span id="al-i" style="display:flex"></span><span id="al-w"></span>';

    var haveKey = window.Recs && window.Recs.hasKey;
    applyRecs((window.Recs && window.Recs.cached()) || (!haveKey && MOCK && MOCK.recs) || []);    // both rows, from cache: no network
    tick();
    setWeather(wxText, wxShort, wxKind);
    paint();

    // The live app list replacing the cache (or the favourites): applied at once unless the user is rearranging the dock
    // or browsing All apps, in which case it waits for Rest.
    var dockPending = false;
    function appsChanged() {
        if (['move', 'apps', 'sheet'].indexOf(S.zone) >= 0) { dockPending = true; return; }
        applyDock(); paint();
    }
    (window.onRest = window.onRest || []).push(function () { if (dockPending) { dockPending = false; applyDock(); paint(); } });
    P.apps(C, appsChanged).then(function () {
        applyDock();
        paint();
    });
    armIdle();

    window.Settle = { state: S, recs: function () { return recs; }, rows: function () { return [rows[0].list, rows[1].list]; }, setWeather: setWeather, setRecs: setRecs, toast: toast };
})();
