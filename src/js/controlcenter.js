/*
 * Control Center panel. Host-agnostic: it renders into whatever element it is given, takes semantic keys
 * ('L','R','U','D','OK','B') from its host, and reads/changes the TV only through the adapter it is given:
 *
 *   adapter.controls()    -> [{ id, label, kind: 'action'|'run'|'switch'|'info'|'choice'|'slider'|'page', big?, confirm?, min?, max?, step? }]
 *   adapter.page(id)      -> [{ id, label, kind: 'choice'|'slider'|'toggle', min?, max?, step? }]   (rows of a 'page' control)
 *   adapter.cached()      -> { id: { value, current, locked? } }     (locked: why a 'page' cannot be opened right now)          (instant, last known; ids are controls and page rows)
 *   adapter.read()        -> Promise of the same, from the TV
 *   adapter.options(id)   -> [{ id, label }]                      (choice and toggle rows/controls)
 *   adapter.act(id, arg)  -> Promise                              (rejects with an Error to show)
 * and, optionally, from the host:
 *   hooks.requestClose()  the panel wants to close (Back at the top level)
 *   hooks.afterAction(id) an action finished (Sleep)
 *   hooks.backdrop()      -> { source, stageWidth, rect: {x,y,w,h} } or null: what is behind the panel, for a frosted look
 *
 * It knows nothing about the launcher, Vetro, focus zones or any remote's key codes. Phase 2 (over video)
 * mounts the same module in another host with the same adapter (and no backdrop, or a still frame).
 *
 * The frosted backdrop is baked ONCE when the panel opens: the picture behind it is drawn into a ~100 px
 * canvas (the downscale is the blur) and tinted. After that it is a static image: no live blur per frame.
 */
(function (global) {
    'use strict';

    var NS = 'http://www.w3.org/2000/svg';
    // Line icons on a 24 box, drawn 2.6 wide (about 4 px at tile size): never the only thing on a tile, always beside its label.
    var ICONS = {
        sleep: ['M20 14.2A8.5 8.5 0 0 1 9.8 4 8.6 8.6 0 1 0 20 14.2Z'],
        picture: ['M3.5 5.5h17v13h-17z', 'M3.5 16l5-5 4 4 3-3 5 5'],
        sound: ['M4 10v4', 'M8 7v10', 'M12 4v16', 'M16 7v10', 'M20 10v4'],
        output: ['M4 9.5h3.5L12 6v12l-4.5-3.5H4z', 'M15.5 9a4.2 4.2 0 0 1 0 6', 'M18 6.5a8 8 0 0 1 0 11'],
        input: ['M4 6h16v7l-3 5H7l-3-5z'],
        ai: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'],
        settle: ['M3 17.5h18', 'M7.5 17.5a4.5 4.5 0 0 1 9 0', 'M12 6v2.2', 'M5.3 9.3l1.5 1.5', 'M18.7 9.3l-1.5 1.5'],
        recent: ['M4 7.5h11v11H4z', 'M8 4.5h12v11'],
        perf: ['M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5z'],
        bluetooth: ['M7 7.5l10 9-5 4.5V3l5 4.5-10 9'],
        brightness: ['M8.5 12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0', 'M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6']
    };

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function icon(id, size) {                                          // built with DOM calls: nothing is parsed from a string
        var s = document.createElementNS(NS, 'svg');
        s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
        s.setAttribute('aria-hidden', 'true');
        (ICONS[id] || []).forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p); });
        return s;
    }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function restart(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }   // replay a CSS animation

    // Which tile each direction leads to. Brightness returns to whichever of Output / Input was last used.
    // TV controls first; the last tile, Settle, opens the launcher's own options (screensaver, wallpaper, refresh, diagnostics).
    var NAV = {
        sleep: { R: 'picture', D: 'perf' },
        perf: { U: 'sleep', R: 'sound', D: 'output' },
        picture: { L: 'sleep', D: 'sound' },
        sound: { L: 'perf', U: 'picture', D: 'input' },
        output: { U: 'perf', R: 'input', D: 'recent' },
        input: { L: 'output', U: 'sound', D: 'bluetooth' },
        recent: { U: 'output', R: 'bluetooth', D: 'brightness' },
        bluetooth: { U: 'input', L: 'recent', D: 'settle' },
        brightness: { U: 'recent', R: 'settle' },
        settle: { U: 'bluetooth', L: 'brightness' }
    };

    function create(host, adapter, hooks) {
        hooks = hooks || {};
        var controls = adapter.controls(), byId = {}, tiles = {}, st = {}, notes = {};
        controls.forEach(function (c) { byId[c.id] = c; });
        var isOpen = false, view = 'grid', sel = controls[0].id, lastLow = 'recent';
        var pg = null, list = null, armed = null, armT = 0, noteT = 0, slide = null, slideT = 0, closeT = 0, busy = false;
        var panel, body;

        // Before the first read: "Checking…". After it, a missing value says so plainly instead of showing a bare dash.
        var readDone = false;
        function val(id) {
            var v = notes[id] || (st[id] && st[id].value);
            if (v) return v;
            if (!readDone) return 'Checking…';
            var c = byId[id] || {};
            return c.kind === 'choice' ? 'Choose' : c.kind === 'run' || c.kind === 'page' ? '' : 'Not available';
        }

        /* A value that changes crossfades; "Working…" pulses. */
        function paintValue(node, id) {
            var t = val(id);
            if (node.textContent !== t) { node.textContent = t; if (node.dataset.seen) restart(node, 'chg'); }
            node.dataset.seen = '1';
            node.classList.toggle('busy', notes[id] === 'Working…');
        }

        /* ----- grid ----- */
        function paintTile(id) {
            var t = tiles[id], c = byId[id];
            if (!t) return;
            t.root.classList.toggle('on', sel === id && view === 'grid');
            t.root.classList.toggle('armed', armed === id);
            t.label.textContent = c.label;
            if (armed === id) { t.value.textContent = c.confirm; t.value.dataset.seen = ''; }
            else paintValue(t.value, id);
            if (c.kind === 'slider') {
                var cur = st[id] && st[id].current != null ? st[id].current : c.min;
                t.fill.style.setProperty('--p', clamp((cur - c.min) / (c.max - c.min), 0, 1));
            }
        }
        function paintGrid() { controls.forEach(function (c) { paintTile(c.id); }); }

        function buildGrid(direction) {
            var grid = el('div', 'cc-grid'), i = 0;
            tiles = {};
            controls.forEach(function (c) {
                var root = el('div', 'cct cct-' + c.id + (c.big ? ' big' : ''));
                root.style.setProperty('--i', i++);                       // stagger: each tile enters a little after the last
                var ic = el('div', 'ci'); ic.appendChild(icon(c.id, c.big ? 64 : 32));
                var label = el('div', 'cl'), v = el('div', 'cv');
                root.appendChild(ic); root.appendChild(label); root.appendChild(v);
                var t = { root: root, label: label, value: v };
                if (c.kind === 'slider') {
                    var track = el('div', 'cc-track'), fill = el('div', 'cc-fill');
                    track.appendChild(fill); root.appendChild(track);
                    t.fill = fill;
                }
                grid.appendChild(root);
                tiles[c.id] = t;
            });
            mount(grid, direction);
            paintGrid();
        }

        /* Swapping the content of the panel: the new view slides in from the side it logically comes from. */
        function mount(node, direction) {
            body.textContent = '';
            if (direction) node.classList.add(direction > 0 ? 'vin-f' : 'vin-b');
            body.appendChild(node);
        }

        function say(id, text, ms) {                                    // a short message in place of a value
            notes[id] = text;
            repaint(id);
            clearTimeout(noteT);
            if (ms) noteT = setTimeout(function () { delete notes[id]; repaint(id); }, ms);
        }
        function repaint(id) {
            if (view === 'grid') paintTile(id);
            else if (view === 'page') paintPage();
        }

        function refresh() {
            return adapter.read().then(function (s) {
                readDone = true;
                if (!isOpen) return;
                st = s;
                if (view === 'grid') paintGrid(); else if (view === 'page') paintPage();
            });
        }

        /* ----- page (Picture, Sound mode): a column of rows ----- */
        function buildPage(id, direction) {
            var c = byId[id], rows = adapter.page(id), box = el('div', 'cc-page');
            pg = { id: id, rows: rows, els: [], sel: 0, title: c.label };
            view = 'page';
            var head = el('div', 'cc-head'), ic = el('div', 'ci'); ic.appendChild(icon(id, 40));
            head.appendChild(ic); head.appendChild(el('div', 'cc-title', c.label));
            box.appendChild(head);
            var colRows = el('div', 'cc-rows');
            rows.forEach(function (r, i) {
                var node = el('div', 'cc-row' + (r.kind === 'slider' ? ' sl' : ''));
                node.style.setProperty('--i', i);
                var l = el('span', 'rl', r.label), v = el('span', 'rv');
                node.appendChild(l); node.appendChild(v);
                var o = { node: node, value: v };
                if (r.kind === 'slider') { var t = el('div', 'rt'), f = el('div', 'rf'); t.appendChild(f); node.appendChild(t); o.fill = f; }
                colRows.appendChild(node); pg.els.push(o);
            });
            box.appendChild(colRows);
            mount(box, direction);
            paintPage();
        }
        function paintPage() {
            if (!pg) return;
            pg.rows.forEach(function (r, i) {
                var o = pg.els[i];
                o.node.classList.toggle('on', i === pg.sel);
                paintValue(o.value, r.id);
                if (o.fill) {
                    var cur = st[r.id] && st[r.id].current != null ? st[r.id].current : r.min;
                    o.fill.style.setProperty('--p', clamp((cur - r.min) / (r.max - r.min), 0, 1));
                }
            });
        }

        /* ----- choice list ----- */
        function buildList(id, label, back, direction) {
            var opts = adapter.options(id), cur = st[id] && st[id].current, sel2 = 0;
            list = { id: id, opts: opts, rows: [], sel: 0, back: back };
            view = 'list';
            var box = el('div', 'cc-page'), head = el('div', 'cc-head');
            head.appendChild(el('div', 'cc-title', label));
            box.appendChild(head);
            var colRows = el('div', 'cc-rows');
            opts.forEach(function (o, i) {
                var r = el('div', 'cc-row');
                r.style.setProperty('--i', i);
                r.appendChild(el('span', 'rl', o.label));
                if (cur != null && String(cur).toUpperCase() === String(o.id).toUpperCase()) { r.appendChild(el('i', null, 'Current')); sel2 = i; }
                colRows.appendChild(r); list.rows.push(r);
            });
            box.appendChild(colRows);
            list.sel = sel2;
            mount(box, direction);
            paintList();
        }
        function paintList() { list.rows.forEach(function (r, i) { r.classList.toggle('on', i === list.sel); }); }
        function leaveList() {
            var back = list.back, id = list.id;
            list = null;
            if (back === 'page') buildPage(pg.id, -1); else { view = 'grid'; buildGrid(-1); }
        }

        /* ----- doing things ----- */
        function run(id, arg) {
            busy = true;
            say(id, 'Working…');
            return Promise.resolve().then(function () { return adapter.act(id, arg); }).then(function (msg) {
                busy = false;
                delete notes[id]; repaint(id);
                if (typeof msg === 'string') say(id, msg, 2500);                 // an action may report what it did, briefly, on its tile                               // "Working…" ends here, whatever the refresh does
                return refresh().catch(function () {}).then(function () { return true; });
            }, function (e) {
                busy = false;
                say(id, (e && e.message) || 'Could not change this', 3500);
                return false;                                                // the caller can tell it failed: the panel stays open to show why
            });
        }

        function commitSlide() {
            clearTimeout(slideT);
            if (!slide) return;
            var s = slide; slide = null;
            run(s.id, s.v);
        }
        function nudge(id, c, dir) {                                     // slider: shown at once, sent after a short pause
            var cur = slide && slide.id === id ? slide.v : (st[id] && st[id].current != null ? st[id].current : c.min);
            if (slide && slide.id !== id) commitSlide();
            var v = clamp(cur + dir * c.step, c.min, c.max);
            slide = { id: id, v: v };
            var shown = String(v);
            st[id] = { value: c.text ? c.text(v) : shown, current: v };
            repaint(id);
            clearTimeout(slideT);
            slideT = setTimeout(commitSlide, 300);
        }

        function disarm() { clearTimeout(armT); armed = null; paintGrid(); }

        function activate() {
            var c = byId[sel];
            if (busy) return;
            if (c.kind === 'action') {
                if (armed !== sel) { armed = sel; paintTile(sel); clearTimeout(armT); armT = setTimeout(disarm, 3500); return; }   // confirm first
                disarm();
                run(sel).then(function (ok) { if (ok && hooks.afterAction) hooks.afterAction(sel); });      // close only if it worked
            } else if (c.kind === 'switch') { var cur = st[sel] && st[sel].current; run(sel, cur === '1' ? 0 : 1); }
            else if (c.kind === 'run') run(sel);                                  // no confirmation, and the panel stays open
            else if (c.kind === 'choice') buildList(sel, c.label, 'grid', 1);
            else if (c.kind === 'page') {
                if (st[sel] && st[sel].locked) { say(sel, st[sel].locked, 2500); return; }            // the host says this page cannot be changed right now, and why
                buildPage(sel, 1);
            }
        }

        function pageKey(k) {
            var r = pg.rows[pg.sel];
            if (k === 'B') { commitSlide(); pg = null; view = 'grid'; buildGrid(-1); return; }
            if (k === 'U' && pg.sel > 0) pg.sel--;
            else if (k === 'D' && pg.sel < pg.rows.length - 1) pg.sel++;
            else if ((k === 'L' || k === 'R') && r.kind === 'slider') { nudge(r.id, r, k === 'R' ? 1 : -1); return; }
            else if (k === 'OK' && !busy) {
                if (r.kind === 'choice') { commitSlide(); buildList(r.id, r.label, 'page', 1); return; }
                if (r.kind === 'toggle') { var cur = st[r.id] && st[r.id].current; run(r.id, cur === '1' ? 0 : 1); return; }
                if (r.kind === 'run') { run(r.id); return; }
            }
            paintPage();
        }

        function listKey(k) {
            if (k === 'B') { leaveList(); return; }
            if (k === 'U' && list.sel > 0) list.sel--;
            else if (k === 'D' && list.sel < list.opts.length - 1) list.sel++;
            else if (k === 'OK') {
                var id = list.id, o = list.opts[list.sel];
                leaveList();
                run(id, o.id);
                return;
            }
            paintList();
        }

        /* ----- keys: returns true when it used the key ----- */
        function handleKey(k) {
            if (!isOpen) return false;
            if (view === 'list') { listKey(k); return true; }
            if (view === 'page') { pageKey(k); return true; }
            if (k === 'B') { if (armed) disarm(); else if (hooks.requestClose) hooks.requestClose(); return true; }
            var c = byId[sel];
            if (c.kind === 'slider' && (k === 'L' || k === 'R')) { nudge(sel, c, k === 'R' ? 1 : -1); return true; }
            if (k === 'OK') { activate(); return true; }
            var to = NAV[sel] && NAV[sel][k];
            if (sel === 'brightness' && k === 'U') to = lastLow;
            if (to && byId[to]) {
                if (['output', 'input', 'recent', 'bluetooth'].indexOf(sel) >= 0) lastLow = sel;
                if (armed) disarm();
                var prev = sel; sel = to;
                paintTile(prev); paintTile(sel);
            }
            return true;
        }

        /* ----- the frosted backdrop: baked once, then static ----- */
        function bake(canvas) {
            var b = hooks.backdrop && hooks.backdrop();
            if (!b || !b.source || !b.rect) return false;
            try {
                var s = b.source, W = s.naturalWidth || s.videoWidth || s.width, k = W / (b.stageWidth || 1920);
                if (!W) return false;
                var w = 98, h = Math.max(1, Math.round(w * b.rect.h / b.rect.w)), g;
                canvas.width = w; canvas.height = h;
                g = canvas.getContext('2d');
                try { g.filter = 'blur(1.2px)'; } catch (e) { /* the downscale alone still softens it */ }
                g.drawImage(s, b.rect.x * k, b.rect.y * k, b.rect.w * k, b.rect.h * k, 0, 0, w, h);
                try { g.filter = 'none'; } catch (e) { /* ignore */ }
                g.fillStyle = 'rgba(14,16,20,.58)';                      // a dark glass tint: text stays readable over any photo
                g.fillRect(0, 0, w, h);
                return true;
            } catch (e) { return false; }                               // a source that cannot be read: the flat panel colour shows
        }

        function open() {
            clearTimeout(closeT);
            host.textContent = '';
            panel = el('div', 'ccp');
            var canvas = el('canvas', 'cc-bd');
            body = el('div', 'cc-body');
            panel.appendChild(canvas); panel.appendChild(body);
            host.appendChild(panel);
            isOpen = true; view = 'grid'; sel = controls[0].id; armed = null; busy = false; notes = {}; pg = null; list = null; slide = null; readDone = false;
            st = adapter.cached();                                           // readable at once, from what was last known
            buildGrid(0);
            panel.classList.toggle('frost', bake(canvas));
            host.classList.add('open');
            refresh();
        }

        function close() {
            if (!isOpen) return;
            commitSlide();                                                   // a change still waiting is sent, not lost
            clearTimeout(armT); clearTimeout(noteT); clearTimeout(slideT);
            isOpen = false;
            host.classList.remove('open');
            tiles = {}; list = null; pg = null;
            closeT = setTimeout(function () { if (!isOpen) host.textContent = ''; }, 300);      // after the fade-out
        }

        return { open: open, close: close, handleKey: handleKey, isOpen: function () { return isOpen; } };
    }

    global.ControlCenter = { create: create };
})(window);
