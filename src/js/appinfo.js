/*
 * "Popular on <app>": the title shown (and the backdrop used) when a dock app is focused.
 *
 * Each app has a TMDB watch-provider id in config.js (tmdbProviders, by app label). On focus, one request for
 * movies and one for series asks TMDB for that provider's popular titles in your region; the top ~10 are kept
 * and ONE is shown, chosen by the date and the app, so it changes daily and differs per app. Apps with no
 * entry are matched by name against TMDB's provider list. Xbox shows Game Pass, GeForce NOW the top Steam
 * seller (no TMDB involved; those have no backdrop, so they keep the icon's colour field).
 *
 * Stale-while-revalidate: whatever is cached is shown at once (even from yesterday); a newer list is fetched
 * in the background and used from the NEXT focus, never swapped under the one on screen. Cache is keyed by
 * local date. Nothing is fetched until the app is focused (the backdrop layer debounces that by 300 ms).
 * Failures are silent: the cache, or just the colour field, stays.
 */
(function () {
    'use strict';

    var C = window.LAUNCHER_CONFIG, KEY = (C.keys || {}).tmdb, REG = C.region || 'IN', MAP = C.tmdbProviders || {};
    var CK = 'settle.appinfo.v3', API = 'https://api.themoviedb.org/3', AWAY = 30 * 60 * 1000;
    var data = null, busy = {}, hiddenAt = 0, provCache = null;

    function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
    function dayNum() { var d = new Date(); return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000); }
    function hash(s) { var h = 0, i; for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003; return h; }
    function load() { try { return JSON.parse(localStorage.getItem(CK)); } catch (e) { return null; } }
    function save() { try { localStorage.setItem(CK, JSON.stringify(data)); } catch (e) { /* silent */ } }
    function store() {
        if (!data) data = load();
        if (!data || data.region !== REG || !data.items) data = { region: REG, items: {} };
        return data;
    }

    function json(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }); }
    function tmdb(path, params) { return json(API + path + '?api_key=' + KEY + '&' + params); }

    /* ---------- the title list for one app ---------- */

    function item(m, kind) {
        var year = (m.release_date || m.first_air_date || '').slice(0, 4);
        return {
            title: m.title || m.name || '', bd: m.backdrop_path || '',
            sub: [m.vote_average ? '★ ' + m.vote_average.toFixed(1) : '', year, kind].filter(Boolean).join(' · ')
        };
    }

    function providerId(label) {
        if (MAP[label]) return Promise.resolve(MAP[label]);
        var short = (window.Recs && window.Recs.short) || function (n) { return n; };      // not in config: match by name, once a session
        var p = provCache || (provCache = tmdb('/watch/providers/movie', 'watch_region=' + REG + '&language=en-US').then(function (j) { return j.results || []; }));
        return p.then(function (list) { var x = list.filter(function (q) { return short(q.provider_name) === label; })[0]; return x ? x.provider_id : 0; });
    }

    function tmdbList(label) {
        return providerId(label).then(function (id) {
            if (!id) return [];
            var base = 'with_watch_providers=' + id + '&watch_region=' + REG + '&with_watch_monetization_types=flatrate&sort_by=popularity.desc&vote_count.gte=100&include_adult=false&language=en-US';
            var since = new Date(Date.now() - 1100 * 86400000).toISOString().slice(0, 10);
            return Promise.all([
                tmdb('/discover/movie', base + '&primary_release_date.gte=' + since).catch(function () { return { results: [] }; }),
                tmdb('/discover/tv', base + '&first_air_date.gte=' + since).catch(function () { return { results: [] }; })
            ]).then(function (r) {
                var mv = (r[0].results || []).slice(0, 5).map(function (m) { return item(m, 'Movie'); });
                var tv = (r[1].results || []).slice(0, 5).map(function (m) { return item(m, 'Series'); });
                var out = [], i;
                for (i = 0; i < 5; i++) { if (mv[i]) out.push(mv[i]); if (tv[i]) out.push(tv[i]); }      // interleaved: the top ~10
                return out.filter(function (x) { return x.title; });
            });
        });
    }

    // Game services (no TMDB): Xbox shows the top Game Pass title, GeForce NOW the top-selling Steam game.
    function mkt() { return REG.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'IN'; }
    var GP = ['eab7757c-ff70-45af-bfa6-79d3cfb2bf81', 'f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e'];
    function gamePass() {
        function list(i) {
            if (i >= GP.length) return Promise.resolve([]);
            return json('https://catalog.gamepass.com/sigls/v2?id=' + GP[i] + '&language=en-us&market=' + mkt()).then(function (j) {
                var ids = (j || []).map(function (x) { return x && x.id; }).filter(function (x) { return /^[A-Z0-9]+$/i.test(x || ''); }).slice(0, 8);
                if (!ids.length) return list(i + 1);
                return json('https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=' + ids.join(',') + '&market=' + mkt() + '&languages=en-us').then(function (p) {
                    var out = (p.Products || []).filter(function (x) { return x.LocalizedProperties && x.LocalizedProperties[0] && x.LocalizedProperties[0].ProductTitle; })
                        .map(function (x) { return { title: x.LocalizedProperties[0].ProductTitle, label: 'Trending on Game Pass', sub: 'Game Pass', bd: '' }; });
                    return out.length ? out : list(i + 1);
                });
            }).catch(function () { return list(i + 1); });
        }
        return list(0);
    }
    function steam() {
        var cc = mkt();
        return json('https://store.steampowered.com/api/featuredcategories?cc=' + cc + '&l=english').then(function (j) {
            var items = ((j.top_sellers || {}).items || []).filter(function (x) { return x && x.type === 0 && !/steam deck|valve index|steam controller/i.test(x.name || ''); });
            return items.slice(0, 8).map(function (g) { return { title: g.name, label: 'Top seller on Steam', sub: 'Playable on GeForce NOW', bd: '' }; });
        });
    }
    var GAMES = [{ re: /xbox/i, run: gamePass }, { re: /geforce/i, run: steam }];
    function gameFor(label) { return GAMES.filter(function (g) { return g.re.test(label); })[0] || null; }

    /* ---------- what the rest of the app uses ---------- */

    function pick(entry, label) {
        var l = entry && entry.list;
        return l && l.length ? l[(dayNum() + hash(label)) % l.length] : null;
    }

    // The title for this app today, from cache, or null. Never touches the network.
    function get(label) { return pick(store().items[label], label); }

    // cb(item|null): at once from cache, or when the first list arrives. A fresher list than the one shown is cached for next time.
    function ensure(label, cb) {
        var s = store(), entry = s.items[label], shown = !!(entry && entry.list && entry.list.length);
        if (shown) cb(pick(entry, label));
        if (entry && entry.day === today()) { if (!shown) cb(null); return; }               // fresh (even if empty: do not ask again today)
        if (busy[label]) return;
        var game = gameFor(label);
        if (!game && !KEY) { if (!shown) cb(null); return; }
        busy[label] = true;
        (game ? game.run() : tmdbList(label)).then(function (list) {
            s.items[label] = { day: today(), list: list || [] };
            save();
            if (!shown) cb(pick(s.items[label], label));
        }, function () { if (!shown) cb(null); }).then(function () { busy[label] = false; });
    }

    // Mark every list stale: they are refetched on the next focus and used from the focus after that.
    function invalidate() { var s = store(); Object.keys(s.items).forEach(function (k) { s.items[k].day = ''; }); save(); }

    document.addEventListener('visibilitychange', function () { if (document.hidden) hiddenAt = Date.now(); });
    (window.onWake = window.onWake || []).push(function () { if (hiddenAt && Date.now() - hiddenAt > AWAY) invalidate(); });

    window.AppInfo = { get: get, ensure: ensure, invalidate: invalidate, refresh: function () {}, onUpdate: null };
})();
