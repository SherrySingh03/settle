/*
 * App icons. Each app's own icon is loaded once, scaled to 132x132 (the focused 1.10x size of a
 * 120 tile) and cached as a PNG data URL in localStorage, so later launches decode a small image
 * and never touch the package again.
 *
 * The path the TV reports is not always valid (e.g. Prime Video points at a file that does not
 * exist), so a failed load tries, in order: sibling names in the same folder (<appId>.png,
 * <packageId>.png, icon.png), then the package's own icon from tizen.package. Every attempt is
 * recorded for the diagnostics screen.
 *
 * Wide logos are contain-fitted; the margin is filled with the icon's own corner colour when its
 * corners are opaque and agree, so it reads as one tile instead of a logo floating in a box.
 * Nothing found: callback(null) and the caller draws the text chip.
 *
 * Placeholders: Samsung hands every app without an icon of its own the same generic image (the
 * pinwheel). Two different apps cannot legitimately share an icon, so when two apps produce an
 * identical picture (compared by an 8x8 signature) that picture is remembered as a placeholder and
 * both apps get callback(null) instead. The callback may therefore fire a second time with null
 * after an icon was first delivered.
 */
(function () {
    'use strict';

    var PFX = 'settle.ic.', GKEY = 'settle.generic.v1', SKEY = 'settle.sigs.v1', SIZE = 132;
    var status = {}, tried = {}, listeners = {};

    function url(p) { return p.charAt(0) === '/' ? 'file://' + p : p; }
    function read(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
    function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota: fine */ } }

    /* ---------- placeholder detection ---------- */

    function isGeneric(sig) { return (read(GKEY) || []).indexOf(sig) >= 0; }

    // Record that app `id` shows picture `sig`. True if that picture is (now) known to be a placeholder.
    function note(id, sig, self) {
        var m = read(SKEY) || {}, ids = m[sig] || (m[sig] = []);
        if (ids.indexOf(id) < 0) { ids.push(id); write(SKEY, m); }
        if (isGeneric(sig)) return true;
        if (ids.length < 2) return false;
        var g = read(GKEY) || [];
        g.push(sig); write(GKEY, g);
        ids.forEach(function (x) {                          // everyone already showing it switches to a chip
            status[x] = 'placeholder -> chip';
            (listeners[x] || []).forEach(function (f) { if (f !== self) f(null); });
        });
        return true;
    }

    function signature(canvas) {                            // 8x8, 16 grey levels + 2-bit alpha: identical pictures, identical string
        try {
            var t = document.createElement('canvas'), g, d, s = '', i;
            t.width = t.height = 8;
            g = t.getContext('2d');
            g.drawImage(canvas, 0, 0, 8, 8);
            d = g.getImageData(0, 0, 8, 8).data;
            for (i = 0; i < d.length; i += 4) s += ((d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10 >> 4).toString(16) + (d[i + 3] >> 6);
            t.width = t.height = 0;
            return s;
        } catch (e) { return ''; }
    }

    /* ---------- finding the file ---------- */

    function candidates(it) {
        var out = [], p = it.icon || '', i = p.lastIndexOf('/');
        if (p) out.push(p);
        if (i > 0) {
            var dir = p.slice(0, i);
            [it.id, it.pkg, 'icon'].forEach(function (n) { if (n) out.push(dir + '/' + n + '.png'); });
        }
        return out.filter(function (v, k, a) { return a.indexOf(v) === k; });
    }

    // The TV may never answer this call, so it gets a deadline.
    function pkgIcon(it, cb) {
        if (!it.pkg) return cb(null, 'no package id');
        var done = false, t = setTimeout(function () { finish(null, 'timeout'); }, 2500);
        function finish(v, why) { if (done) return; done = true; clearTimeout(t); cb(v, why); }
        try {
            tizen.package.getPackageInfo(it.pkg, function (info) { finish((info && info.iconPath) || null, 'no iconPath'); }, function () { finish(null, 'error'); });
        } catch (e) { finish(null, 'unavailable'); }
    }

    // Ask the file:// directory for a listing (a Chromium directory page). May be blocked; that is fine.
    function listDir(dir, cb) {
        var done = false, x;
        function finish(v, why) { if (done) return; done = true; cb(v, why); }
        try {
            x = new XMLHttpRequest();
            x.open('GET', 'file://' + dir + '/');
            x.timeout = 2500;
            x.onload = function () {
                var t = x.responseText || '', names = [];
                t.replace(/addRow\("([^"]+)"/g, function (m, n) { names.push(n); return m; });
                if (!names.length) t.replace(/href="([^"?#]+\.(?:png|jpg|jpeg|svg))"/gi, function (m, n) { names.push(n.split('/').pop()); return m; });
                finish(names, names.length ? '' : 'empty');
            };
            x.onerror = x.ontimeout = function () { finish(null, 'blocked'); };
            x.send();
        } catch (e) { finish(null, 'blocked'); }
    }

    function rank(name, it) {
        var n = name.toLowerCase(), s = 0;
        if (!/\.(png|jpg|jpeg)$/.test(n)) return -1;
        if (it.id && n.indexOf(it.id.toLowerCase()) >= 0) s += 3;
        if (it.pkg && n.indexOf(it.pkg.toLowerCase()) >= 0) s += 3;
        if (/icon|ignition|logo|launcher/.test(n)) s += 2;
        return s;
    }

    /* ---------- drawing ---------- */

    // Opaque, agreeing corners -> that colour, else null.
    function corner(im) {
        try {
            var t = document.createElement('canvas'), g;
            t.width = t.height = 8;
            g = t.getContext('2d');
            g.drawImage(im, 0, 0, 8, 8);
            var a = g.getImageData(0, 0, 1, 1).data, b = g.getImageData(7, 7, 1, 1).data;
            t.width = t.height = 0;
            if (a[3] > 240 && b[3] > 240 && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 30) {
                return 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')';
            }
        } catch (e) { /* tainted: no sampling */ }
        return null;
    }

    function render(im, k, it, alt, cb) {
        var d = null, sig = '';
        try {
            var c = document.createElement('canvas'), g = c.getContext('2d'), bg;
            c.width = c.height = SIZE;
            bg = corner(im);
            if (bg) { g.fillStyle = bg; g.fillRect(0, 0, SIZE, SIZE); }
            var s = Math.min(SIZE / im.naturalWidth, SIZE / im.naturalHeight) || 1,
                w = im.naturalWidth * s, hh = im.naturalHeight * s;
            g.drawImage(im, (SIZE - w) / 2, (SIZE - hh) / 2, w, hh);
            sig = signature(c);
            d = c.toDataURL('image/png');
            c.width = c.height = 0;                         // release the backing store
            write(k, { p: it.icon || '', d: d, sig: sig, bg: bg || null });
        } catch (e) { d = null; }                           // tainted canvas etc.
        if (sig && note(it.id, sig, cb)) { status[it.id] = 'placeholder -> chip'; return cb(null); }
        status[it.id] = (d ? 'ok ' : 'uncached ') + im.naturalWidth + 'x' + im.naturalHeight + (alt ? ' (alt path)' : '');
        cb(d || im.src, bg || null);
    }

    // cb(src | null). Synchronous when cached. May be called again with null if the picture
    // later turns out to be a shared placeholder.
    function get(it, cb) {
        var k = PFX + it.id, hit = read(k);
        listeners[it.id] = (listeners[it.id] || []).concat(cb).slice(-4);       // the dock tile and the All apps tile of one app
        if (hit && hit.sig && hit.p === (it.icon || '') && hit.d && hit.bg !== undefined) {     // entries without a signature predate placeholder detection: reload them
            if (note(it.id, hit.sig, cb)) { status[it.id] = 'placeholder -> chip'; return cb(null); }
            status[it.id] = 'cached';
            return cb(hit.d, hit.bg);
        }

        var list = candidates(it), log = tried[it.id] = [], n = 0;
        function load(u, next) {
            var im = new Image();
            im.onload = function () { log.push('ok   ' + u); render(im, k, it, u !== it.icon, cb); };
            im.onerror = function () { log.push('FAIL ' + u); next(); };
            im.src = url(u);
        }
        function fail() { status[it.id] = 'FAILED (' + log.length + ' tried)'; cb(null); }
        function viaPackage() {                              // last resort: the package's own icon
            pkgIcon(it, function (p, why) {
                log.push('PKG  ' + (p ? p : why));
                if (p && list.indexOf(p) < 0) return load(p, fail);
                fail();
            });
        }
        function viaListing() {                              // then whatever is actually in the icon's folder
            var base = (it.icon || '').lastIndexOf('/');
            if (base <= 0) return viaPackage();
            var dir = it.icon.slice(0, base);
            listDir(dir, function (names, why) {
                log.push('LIST ' + (names ? names.length + ' files: ' + names.slice(0, 6).join(' ') : why));
                var pick = (names || []).map(function (nm) { return { nm: nm, s: rank(nm, it) }; })
                    .filter(function (e) { return e.s >= 0 && list.indexOf(dir + '/' + e.nm) < 0; })
                    .sort(function (a, b) { return b.s - a.s; }).slice(0, 3).map(function (e) { return dir + '/' + e.nm; });
                (function next() {
                    if (!pick.length) return viaPackage();
                    load(pick.shift(), next);
                })();
            });
        }
        function step() {
            if (n < list.length) return load(list[n++], step);
            viaListing();
        }
        step();
    }

    // Drop cached icons (and their signatures) for apps that are no longer in view of any screen.
    function prune(keepIds) {
        var keep = {}, drop = [], i, k;
        keepIds.forEach(function (id) { keep[PFX + id] = 1; });
        try {
            for (i = 0; i < localStorage.length; i++) {
                k = localStorage.key(i);
                if (k.indexOf(PFX) === 0 && !keep[k]) drop.push(k);
            }
            drop.forEach(function (x) { localStorage.removeItem(x); });
        } catch (e) { /* silent */ }
    }

    window.Icons = { get: get, prune: prune, size: SIZE, status: status, tried: tried, generic: function () { return (read(GKEY) || []).length; } };
})();
