/*
 * Dynamic backdrop. What is focused decides what is behind the launcher:
 *   at rest          the daily wallpaper (this module is idle and the layer is hidden)
 *   a dock app       its icon's colours at once, then (after the focus settles) the backdrop of a popular title
 *   a rail title     its poster's colours at once, then the title's own backdrop
 * A backdrop that is missing or fails leaves the colour field: that is a valid final state, never an error.
 *
 * Cost rules (this TV is memory- and heat-limited):
 *   - only opacity animates, 200 ms, the dock's own curve; the layer is never scaled, panned or moved
 *   - colour fields are two 64x36 canvases, stretched by the GPU and crossfaded (a texture of a few KB, not a
 *     full-screen gradient); each pair of colours is computed once and cached, misses included
 *   - at most TWO backdrops are decoded at once (current + incoming); the outgoing one is released the
 *     moment its fade ends
 *   - the network and the decode wait until focus has rested 300 ms, so sweeping across the dock fires nothing; a rail
 *     title waits longer (spec.delay) with the popcorn loader on the right, so moving along the rail stays quick
 *   - one backdrop ahead, in the direction of travel, is only fetched into the HTTP cache, not decoded
 */
(function () {
    'use strict';

    var root = document.getElementById('bd');
    if (!root) return;
    var stage = document.getElementById('stage');
    var BD = 'https://image.tmdb.org/t/p/w780', DEBOUNCE = 300, FADE = 220;
    var fields = [root.querySelector('.bf0'), root.querySelector('.bf1')], scrim = document.getElementById('bs');
    var IMAGES = !((window.LAUNCHER_CONFIG.backdrop || {}).images === false);
    var imgs = [root.querySelector('.bi0'), root.querySelector('.bi1')];
    var fi = 0, ii = 0, imgOn = false, key = null, token = 0, timer = 0, ahead = {};
    var NEUTRAL = ['rgb(30,34,44)', 'rgb(12,14,18)'];

    /* ---------- colour extraction: an 8x8 copy, bucketed, two dominant colours ---------- */

    var cvs = document.createElement('canvas'), g = null, cache = {};
    cvs.width = cvs.height = 8;
    try { g = cvs.getContext('2d'); } catch (e) { g = null; }

    function mix(c, k) { return 'rgb(' + Math.round(c[0] * (1 - k) + 10 * k) + ',' + Math.round(c[1] * (1 - k) + 11 * k) + ',' + Math.round(c[2] * (1 - k) + 13 * k) + ')'; }
    function pairOf(a, b) { return [mix(a, 0.28), mix(b || [a[0] * 0.5, a[1] * 0.5, a[2] * 0.5], 0.6)]; }

    function bgRgb(bg) {                                        // any CSS colour -> [r,g,b] (through the canvas itself)
        if (!g || !bg) return null;
        try { g.clearRect(0, 0, 8, 8); g.fillStyle = bg; g.fillRect(0, 0, 8, 8); var d = g.getImageData(0, 0, 1, 1).data; return d[3] ? [d[0], d[1], d[2]] : null; } catch (e) { return null; }
    }

    // el: a decoded <img> (or null); bg: the colour behind it. Returns a pair of CSS colours, or null if unreadable.
    function dominant(el, bg) {
        if (!g) return null;
        var d;
        try {
            g.clearRect(0, 0, 8, 8);
            if (bg) { g.fillStyle = bg; g.fillRect(0, 0, 8, 8); }
            if (el && el.complete && el.naturalWidth) g.drawImage(el, 0, 0, 8, 8);
            d = g.getImageData(0, 0, 8, 8).data;
        } catch (e) { return null; }                           // a picture the browser will not let us read
        var b = {}, i, r, gg, bl, mx, mn, sat, lum, w, k, e;
        for (i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 128) continue;
            r = d[i]; gg = d[i + 1]; bl = d[i + 2];
            mx = Math.max(r, gg, bl); mn = Math.min(r, gg, bl);
            sat = mx ? (mx - mn) / mx : 0; lum = r * 0.3 + gg * 0.59 + bl * 0.11;
            w = 0.25 + 2.5 * sat;                              // colourful beats grey
            if (lum < 24) w *= 0.4;                            // near black and near white count for little
            if (lum > 230 && sat < 0.1) w *= 0.2;
            k = (r >> 5) * 64 + (gg >> 5) * 8 + (bl >> 5);
            e = b[k] || (b[k] = { n: 0, w: 0, r: 0, g: 0, b: 0 });
            e.n++; e.w += w; e.r += r; e.g += gg; e.b += bl;
        }
        var list = Object.keys(b).map(function (x) { var q = b[x]; return { s: q.w, c: [q.r / q.n, q.g / q.n, q.b / q.n] }; }).sort(function (p, q) { return q.s - p.s; });
        if (!list.length) return null;
        var c1 = list[0].c, c2 = null;
        for (i = 1; i < list.length && !c2; i++) {
            var c = list[i].c;
            if (Math.abs(c[0] - c1[0]) + Math.abs(c[1] - c1[1]) + Math.abs(c[2] - c1[2]) > 110) c2 = c;
        }
        return pairOf(c1, c2);
    }

    // Cached per app / title and never recomputed once it has a result.
    function colorsFor(k, get) {
        if (cache[k]) return cache[k];                          // a hit costs nothing: no style lookup, no canvas
        var s = get() || {}, el = s.el, bg = s.bg;
        var p = dominant(el, bg);
        if (!p && bg) { var c = bgRgb(bg); if (c) p = pairOf(c, null); }
        p = p || NEUTRAL;
        if (!el || (el.complete && el.naturalWidth)) cache[k] = p;      // a picture that is not decoded yet is asked again next time
        return p;
    }

    /* ---------- the two stacked colour fields, and the picture layer ---------- */

    function paintField(cv, pair) {
        var x = cv.getContext('2d'), w = cv.width, hh = cv.height, gr = x.createLinearGradient(0, 0, w, hh);
        gr.addColorStop(0, pair[0]); gr.addColorStop(1, pair[1]);
        x.fillStyle = gr; x.fillRect(0, 0, w, hh);
    }
    function setField(pair) {
        var next = 1 - fi;
        paintField(fields[next], pair);
        fields[next].classList.add('a'); fields[fi].classList.remove('a');
        fi = next;
    }
    (function () {                                              // the reading scrim: drawn once, static
        var x = scrim.getContext('2d'), w = scrim.width, hh = scrim.height;
        var l = x.createLinearGradient(0, 0, w, 0);
        l.addColorStop(0, 'rgba(10,11,13,.7)'); l.addColorStop(0.58, 'rgba(10,11,13,.18)'); l.addColorStop(1, 'rgba(10,11,13,0)');
        x.fillStyle = l; x.fillRect(0, 0, w, hh);
        var v = x.createLinearGradient(0, hh, 0, 0);
        v.addColorStop(0, 'rgba(10,11,13,.78)'); v.addColorStop(0.46, 'rgba(10,11,13,0)');
        x.fillStyle = v; x.fillRect(0, 0, w, hh);
    })();

    function release(img) { img.onload = null; img.removeAttribute('src'); }

    function hideImage() {                                      // fade out, then let go of the decoded picture
        if (!imgOn) return;
        var old = imgs[ii]; imgOn = false;
        old.classList.remove('a');
        setTimeout(function () { if (!old.classList.contains('a')) release(old); }, FADE);
    }

    function showImage(url, tok) {
        var next = imgs[1 - ii];
        function go() {
            if (tok !== token) { release(next); return; }
            loaderOff();
            var old = imgs[ii], had = imgOn;
            next.classList.add('a'); old.classList.remove('a');
            ii = 1 - ii; imgOn = true;
            if (had) setTimeout(function () { if (!old.classList.contains('a')) release(old); }, FADE);    // the outgoing one is dropped as its fade ends
        }
        next.onload = null;
        next.src = url;
        if (next.decode) next.decode().then(go, function () { if (tok === token) { release(next); loaderOff(); } });
        else { next.onload = go; next.onerror = function () { if (tok === token) loaderOff(); }; }
    }

    function prefetch(url) {                                    // warm the HTTP cache only: nothing is decoded
        if (!url || ahead[url]) return;
        ahead[url] = 1;
        var ks = Object.keys(ahead); if (ks.length > 8) delete ahead[ks[0]];
        try { fetch(url, { mode: 'no-cors' }).catch(function () { /* silent */ }); } catch (e) { /* silent */ }
    }

    /* ---------- the API ---------- */

    /* The loader: a little popcorn bucket on the right while a slow backdrop is on its way. It only appears once
       focus has rested (a sweep never shows it), and its animation runs only while it is visible. */
    var loader = document.getElementById('bdload'), LINES = ['Popping the popcorn…', 'Dimming the lights…', 'Finding the good seats…',
        'Shushing the row behind you…', 'Rewinding the tape…', 'Unwrapping the snacks…', 'Adjusting the tracking…'];
    function loaderOn() {
        if (!loader) return;
        loader.lastChild.textContent = LINES[Math.floor(Math.random() * LINES.length)];
        loader.classList.add('on');
    }
    function loaderOff() { if (loader) loader.classList.remove('on'); }

    // spec: { colors: fn -> [c1,c2], image: fn(cb) -> cb(url|null) (called once focus has rested), ahead: fn -> [urls],
    //         delay: ms of rest before the picture is fetched (default 300), loader: true to show the loader meanwhile,
    //         loaderAt: ms of rest before the loader appears (default 300) }
    function focus(k, spec) {
        if (k === key) return;
        key = k; var tok = ++token;
        clearTimeout(timer);
        loaderOff();
        root.classList.add('on'); stage.classList.add('bd-on');
        setField((spec.colors && spec.colors()) || NEUTRAL);   // immediately, from what is already decoded
        hideImage();                                            // the previous focus's picture does not describe this one
        if (!spec.image || !IMAGES) return;
        var wait = Math.max(DEBOUNCE, spec.delay || 0), first = Math.min(wait, Math.max(DEBOUNCE, spec.loaderAt || 0));
        function fetchIt() {
            spec.image(function (path) {
                if (tok !== token) return;
                if (!path) { loaderOff(); return; }             // nothing available: the colour field stays
                showImage(path.charAt(0) === '/' ? BD + path : path, tok);
                if (spec.ahead) spec.ahead().forEach(function (p) { if (p) prefetch(p.charAt(0) === '/' ? BD + p : p); });
            });
        }
        timer = setTimeout(function () {
            if (!spec.loader || wait <= first) return fetchIt();
            loaderOn();                                         // rested: show the bucket, then fetch after the rest of the wait
            timer = setTimeout(fetchIt, wait - first);
        }, first);
    }

    function rest() {
        if (key === null) return;
        key = null; token++;
        clearTimeout(timer);
        loaderOff();
        hideImage();
        root.classList.remove('on'); stage.classList.remove('bd-on');
    }

    window.Backdrop = { focus: focus, rest: rest, colors: colorsFor, prefetch: prefetch, active: function () { return key; } };
})();
