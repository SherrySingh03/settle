/*
 * Rail backdrop. A rail title, once focus has rested on it, shows its TMDB backdrop full screen over plain black; the
 * picture arrives with a short fade and settle (200 ms, opacity and transform only). Anything else: the wallpaper.
 * A backdrop that is missing or fails just leaves black: a valid final state, never an error.
 *
 * Cost rules (this TV is memory- and heat-limited):
 *   - nothing is computed per focus move: no colour sampling, no canvas work; moving along the rail only (re)arms a timer
 *   - the network and the decode wait until focus has rested (spec.delay), with the popcorn loader on the right meanwhile
 *   - at most TWO backdrops are decoded at once (current + incoming); the outgoing one is released as its fade ends
 *   - one backdrop ahead, in the direction of travel, is only fetched into the HTTP cache, not decoded
 */
(function () {
    'use strict';

    var root = document.getElementById('bd');
    if (!root) return;
    var stage = document.getElementById('stage');
    var BD = 'https://image.tmdb.org/t/p/w780', DEBOUNCE = 300, FADE = 220;
    var scrim = document.getElementById('bs');
    var IMAGES = !((window.LAUNCHER_CONFIG.backdrop || {}).images === false);
    var imgs = [root.querySelector('.bi0'), root.querySelector('.bi1')];
    var ii = 0, imgOn = false, key = null, token = 0, timer = 0, ahead = {};

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

    // spec: { image: fn(cb) -> cb(url|null) (called once focus has rested), ahead: fn -> [urls],
    //         delay: ms of rest before the picture is fetched (default 300), loader: true to show the loader meanwhile,
    //         loaderAt: ms of rest before the loader appears (default 300) }
    function focus(k, spec) {
        if (k === key) return;
        key = k; var tok = ++token;
        clearTimeout(timer);
        loaderOff();
        root.classList.add('on'); stage.classList.add('bd-on');   // plain black behind the launcher
        hideImage();                                            // the previous focus's picture does not describe this one
        if (!spec.image || !IMAGES) return;
        var wait = Math.max(DEBOUNCE, spec.delay || 0), first = Math.min(wait, Math.max(DEBOUNCE, spec.loaderAt || 0));
        function fetchIt() {
            spec.image(function (path) {
                if (tok !== token) return;
                if (!path) { loaderOff(); return; }             // nothing available: black stays
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

    window.Backdrop = { focus: focus, rest: rest };
})();
