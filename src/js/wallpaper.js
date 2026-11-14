/*
 * Daily wallpaper (Unsplash). One image per day, fetched at 1920 wide, ingested once:
 *   blob -> 1920x1080 canvas (cover) -> scrim baked in -> JPEG blob -> IndexedDB (disk)
 * The canvas is released straight away; the <img> decodes the stored JPEG exactly once.
 * Never refetches within a local day; a failed attempt waits an hour. The last 5 images are kept on
 * disk; when today's cannot be fetched (offline, no key) they rotate by date so the picture still changes. With no key, no network
 * or no cache, the bundled img/wall.svg simply stays. Everything is silent.
 *
 * A new image is only swapped in at Rest or on wake (dip to ground: 100 ms out, swap, 100 ms in),
 * so the picture never changes under the user's hands.
 */
(function () {
    'use strict';

    var C = window.LAUNCHER_CONFIG, KEY = (C.keys || {}).unsplash, W = C.wallpaper || {};
    var wall = document.getElementById('wall'), cap = document.getElementById('caption');
    var WW = W.width || 1920, WH = W.height || 1080, K = WW / 1920;
    var cur = null, shownDay = null, pending = null, due = false;

    function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

    /* ----- tiny IndexedDB key/value ----- */
    function db() {
        return new Promise(function (ok, no) {
            var r = indexedDB.open('settle', 1);
            r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
            r.onsuccess = function () { ok(r.result); };
            r.onerror = function () { no(r.error); };
        });
    }
    function kv(mode, fn) {
        return db().then(function (d) {
            return new Promise(function (ok, no) {
                var tx = d.transaction('kv', mode), req = fn(tx.objectStore('kv'));
                tx.oncomplete = function () { d.close(); ok(req.result); };
                tx.onerror = tx.onabort = function () { d.close(); no(tx.error); };
            });
        });
    }
    function kvGet(k) { return kv('readonly', function (s) { return s.get(k); }); }
    function kvSet(k, v) { return kv('readwrite', function (s) { return s.put(v, k); }); }

    /* ----- show ----- */
    function apply(rec, dip) {
        var url = URL.createObjectURL(rec.blob), old = cur;
        function go() {
            wall.onload = function () {
                wall.onload = null;
                if (old) URL.revokeObjectURL(old);
                if (dip) { wall.style.opacity = ''; setTimeout(function () { wall.style.transition = ''; }, 120); }
            };
            wall.onerror = function () { wall.onerror = null; wall.style.opacity = ''; wall.style.transition = ''; };
            wall.src = url; cur = url;
            document.getElementById('cap1').textContent = rec.caption || '';
            document.getElementById('cap2').textContent = rec.credit || '';
            cap.style.display = rec.caption || rec.credit ? '' : 'none';
        }
        if (dip) { wall.style.transition = 'opacity 100ms linear'; wall.style.opacity = 0; setTimeout(go, 100); }
        else go();
        shownDay = rec.day;
    }

    function flush() { if (pending) { var p = pending; pending = null; apply(p, true); } }

    /* ----- ingest ----- */
    function ingest(blob) {
        return createImageBitmap(blob).then(function (bm) {
            var c = document.createElement('canvas'), g;
            c.width = WW; c.height = WH;
            g = c.getContext('2d');
            var s = Math.max(WW / bm.width, WH / bm.height), w = bm.width * s, h = bm.height * s;
            g.drawImage(bm, (WW - w) / 2, (WH - h) / 2, w, h);
            if (bm.close) bm.close();
            var l = g.createLinearGradient(0, 0, 960 * K, 0);              // left half, up to 55%
            l.addColorStop(0, 'rgba(0,0,0,.55)'); l.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = l; g.fillRect(0, 0, 960 * K, WH);
            var b = g.createLinearGradient(0, 720 * K, 0, WH);           // bottom third, up to 55%
            b.addColorStop(0, 'rgba(0,0,0,0)'); b.addColorStop(1, 'rgba(0,0,0,.55)');
            g.fillStyle = b; g.fillRect(0, 720 * K, WW, 360 * K);
            return new Promise(function (ok, no) {
                c.toBlob(function (out) { c.width = c.height = 0; out ? ok(out) : no(new Error('encode')); }, 'image/jpeg', 0.82);
            });
        });
    }

    function fetchToday() {
        var auth = { headers: { Authorization: 'Client-ID ' + KEY, 'Accept-Version': 'v1' } };
        var q = 'orientation=landscape&content_filter=high&query=' + encodeURIComponent(W.query || 'nature landscape');
        return fetch('https://api.unsplash.com/photos/random?' + q, auth)
            .then(function (r) { if (!r.ok) throw new Error('api'); return r.json(); })
            .then(function (j) {
                var raw = j.urls.raw, u = raw + (raw.indexOf('?') > -1 ? '&' : '?') + 'w=' + WW + '&h=' + WH + '&fit=crop&q=80&fm=jpg';
                if (j.links && j.links.download_location) fetch(j.links.download_location, auth).catch(function () {});   // API guideline
                return fetch(u).then(function (r) { if (!r.ok) throw new Error('img'); return r.blob(); }).then(ingest).then(function (blob) {
                    var loc = (j.location && j.location.name) || j.description || j.alt_description || '';
                    return {
                        day: today(), w: WW, blob: blob,
                        caption: loc.length > 56 ? loc.slice(0, 55) + '…' : loc,
                        credit: j.user && j.user.name ? 'Photo by ' + j.user.name + ' on Unsplash' : 'Unsplash'
                    };
                });
            });
    }

    function atRest() { return !window.Settle || window.Settle.state.zone === null; }

    var KEEP = 5;
    function keepRecent(n) {
        return kvGet('walls').catch(function () { return null; }).then(function (l) {
            l = (l || []).filter(function (r) { return r.day !== n.day; });
            l.unshift(n);
            return kvSet('walls', l.slice(0, KEEP));
        }).catch(function () {});
    }
    // No new picture today: show one of the kept ones, chosen by the date so it changes daily.
    function rotate() {
        return kvGet('walls').catch(function () { return null; }).then(function (l) {
            if (!l || l.length < 2) return;
            var d = new Date(), n = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
            var r = l[n % l.length];
            if (!r || !r.blob || r.day === shownDay) return;
            if (shownDay === null) apply(r, false);
            else if (atRest()) apply(r, true);
            else pending = r;
        });
    }

    function run() {
        if (!window.indexedDB) return;
        kvGet('wall').catch(function () { return null; }).then(function (rec) {
            var first = null;
            if (rec && rec.blob && shownDay === null) {            // boot: an old picture is replaced by one of the kept ones, by date, with no flash
                if (rec.day !== today()) first = rotate().then(function () { if (shownDay === null) apply(rec, false); });
                else apply(rec, false);
            }
            return Promise.resolve(first).then(function () { return again(rec); });
        }).catch(function () { return rotate(); }).catch(function () { /* silent: bundled/cached image stays */ });
    }

    function again(rec) {
        return Promise.resolve().then(function () {
            if (rec && rec.day === today() && rec.w === WW) return;
            if (!KEY) return rotate();
            var last = 0;
            try { last = +localStorage.getItem('settle.wall.try') || 0; } catch (e) { /* silent */ }
            if (Date.now() - last < 3600000) return rotate();
            // Ingest briefly holds ~2 full-size bitmaps, so with a picture already showing wait for Rest.
            if (shownDay !== null && !atRest()) { due = true; return; }
            due = false;
            try { localStorage.setItem('settle.wall.try', String(Date.now())); } catch (e) { /* silent */ }
            return fetchToday().then(function (n) {
                kvSet('wall', n).catch(function () {});
                keepRecent(n);
                if (shownDay === null) apply(n, false);                  // first ever: nothing to dip from
                else { pending = n; flush(); }                            // we are at Rest: swap now
            });
        }).catch(function () { return rotate(); }).catch(function () { /* silent: bundled/cached image stays */ });
    }

    // The user asked for a new picture: fetch now (no date check, no hourly guard, not waiting for Rest) and crossfade it in.
    // Today's date stays on the record, so tomorrow's automatic change still happens on the first launch after midnight.
    var manualTok = 0;
    function refreshNow() {
        if (!KEY) return Promise.reject(new Error('Needs an Unsplash key'));
        if (!window.indexedDB) return Promise.reject(new Error('Not available'));
        var tok = ++manualTok;
        return fetchToday().then(function (n) {
            if (tok !== manualTok) return;
            kvSet('wall', n).catch(function () {});
            keepRecent(n);
            pending = null;
            if (shownDay === null) apply(n, false); else apply(n, true);
        }, function () { throw new Error('Could not fetch a photo'); });
    }
    window.Wallpaper = { refreshNow: refreshNow };

    cap.style.display = 'none';
    (window.onRest = window.onRest || []).push(function () { if (due) run(); else flush(); });
    (window.onWake = window.onWake || []).push(function () { flush(); run(); });
    window.addEventListener('load', run);
})();
