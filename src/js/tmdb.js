/*
 * Rail content. TMDB v3 supplies artwork, metadata and where-to-watch (region from config);
 * the list of titles comes from Trakt recommendations when connected, otherwise from TMDB
 * discover (movies streaming now in the region, by popularity).
 *   discover/movie  or  Trakt /recommendations/movies  -> ids
 *   movie/{id}?append_to_response=watch/providers,release_dates  -> one call per title
 * Once per 24 h, cached whole in localStorage. The rail shows the cache instantly; a refresh
 * only lands while the user is at Rest. Failures are silent. Posters are w185 (185x278), the
 * closest TMDB size to the 184x276 slot.
 */
(function () {
    'use strict';

    var C = window.LAUNCHER_CONFIG, KEY = (C.keys || {}).tmdb, REG = C.region || 'IN';
    var CK = 'settle.recs.v3', AWAY = 30 * 60 * 1000, N = 12, hiddenAt = 0;
    function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }   // the cache is keyed by local date
    var API = 'https://api.themoviedb.org/3', IMG = 'https://image.tmdb.org/t/p/w185';
    var SHORT = { 'Amazon Prime Video': 'Prime Video', 'Amazon Video': 'Prime Video', 'Disney Plus Hotstar': 'JioHotstar', 'Hotstar': 'JioHotstar', 'Sony Liv': 'SonyLIV', 'Sonyliv': 'SonyLIV', 'Apple TV Plus': 'Apple TV', 'Apple TV+': 'Apple TV' };

    function load() { try { return JSON.parse(localStorage.getItem(CK)); } catch (e) { return null; } }
    function save(v) { try { localStorage.setItem(CK, JSON.stringify(v)); } catch (e) { /* silent */ } }
    function source() { return window.Trakt && window.Trakt.connected() ? 'trakt' : 'pop'; }
    function cached() {
        var c = load();
        return c && c.region === REG && c.src === source() && c.items && c.items.length ? c.items : null;
    }

    function get(path, params) {
        return fetch(API + path + '?api_key=' + KEY + '&' + params).then(function (r) {
            if (!r.ok) throw new Error('tmdb ' + r.status);
            return r.json();
        });
    }

    // TMDB lists channel/ad-tier variants as separate providers; fold them into the base service.
    function short(n) {
        n = n.replace(/\s+(with Ads|Amazon Channel|Apple TV Channel|Roku Premium Channel|Store)$/i, '').trim();
        var k = n.toLowerCase();
        for (var s in SHORT) if (s.toLowerCase() === k) return SHORT[s];
        return n;
    }
    function names(list) { return (list || []).map(function (p) { return short(p.provider_name); }).filter(function (n, i, a) { return a.indexOf(n) === i; }); }

    function runtime(m) {
        if (!m) return '';
        var h = Math.floor(m / 60), mm = m % 60;
        return h ? h + 'h ' + (mm < 10 ? '0' : '') + mm + 'm' : mm + 'm';
    }

    function cert(d) {
        var rs = (d.release_dates && d.release_dates.results) || [], i, j;
        for (i = 0; i < rs.length; i++) {
            if (rs[i].iso_3166_1 !== REG) continue;
            for (j = 0; j < rs[i].release_dates.length; j++) {
                var c = rs[i].release_dates[j].certification;
                if (c) return c.replace(/^UA/, 'U/A');
            }
        }
        return '';
    }

    function country() {
        try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(REG); } catch (e) { return REG; }
    }

    // A provider whose app is on this TV (by the app label it maps to, or its own name).
    function onTv(n) {
        var P = window.Platform;
        return !!P && (P.isInstalled((C.providerApps || {})[n] || n) || P.isInstalled(n));
    }

    // tier: how watchable a title is here, lower first. On an app you have and included in the subscription (0), on an
    // app you have to rent or buy (1), streaming on a service you do not have (2), rent elsewhere (3), nowhere (4).
    function toItem(d) {
        var wp = (d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results[REG]) || {};
        var flat = names(wp.flatrate), rent = names((wp.rent || []).concat(wp.buy || []));
        var flatOn = flat.filter(onTv), rentOn = rent.filter(onTv);
        var primary = '', streaming = true, kind = 'flat', tier = 4;
        if (flatOn.length) { primary = flatOn[0]; tier = 0; }
        else if (rentOn.length) { primary = rentOn[0]; kind = 'rent'; tier = 1; }
        else if (flat.length) { primary = flat[0]; tier = 2; }
        else if (rent.length) { primary = rent[0]; kind = 'rent'; tier = 3; }
        else streaming = false;

        var others = flat.filter(function (n) { return n !== primary; }), rentOthers = rent.filter(function (n) { return n !== primary; });
        var note = !streaming ? 'Not streaming in ' + country() + ' yet'
            : (kind === 'rent' ? 'Rent in ' : 'Streaming in ') + country() +
              (others.length ? ' · also on ' + others[0] : (rentOthers.length ? ' · also on ' + rentOthers[0] + ' to rent' : ''));

        var year = (d.release_date || '').slice(0, 4), genre = d.genres && d.genres[0] ? d.genres[0].name : '';
        return {
            id: 'tm' + d.id, tmdb: d.id, imdb: d.imdb_id || '', tier: tier, title: d.title || d.original_title,
            art: d.poster_path ? IMG + d.poster_path : '', bd: d.backdrop_path || '', bg: '#16181C',
            provider: primary || 'Not streaming', prov: streaming ? primary + (kind === 'rent' ? ' · rent' : '') : 'Not streaming',
            streaming: streaming, note: note,
            meta: [year, genre, runtime(d.runtime), cert(d)].filter(Boolean).join(' · '),
            desc: d.overview || d.tagline || ''
        };
    }

    function detail(id) {
        return get('/movie/' + id, 'append_to_response=watch/providers,release_dates&language=en-US').then(toItem).catch(function () { return null; });
    }

    // Each refresh looks one page further down TMDB's popular list (pages 1-5, then round again), so it does not hand
    // back the same twenty films every time.
    var PK = 'settle.railpage.v1', RK = 'settle.railshown.v1';
    function nextPage() {
        var n = 0;
        try { n = (+localStorage.getItem(PK) || 0) + 1; localStorage.setItem(PK, String(n)); } catch (e) { /* silent */ }
        return (n % 5) + 1;
    }
    // TMDB provider ids of the streaming apps installed on this TV (config.tmdbProviders, by app label).
    function myProviders() {
        var map = C.tmdbProviders || {}, P = window.Platform;
        return Object.keys(map).filter(function (label) { return P && P.isInstalled(label); }).map(function (label) { return map[label]; });
    }
    function discover(page, prov) {
        var since = new Date(Date.now() - 548 * 86400000).toISOString().slice(0, 10);   // last ~18 months
        return get('/discover/movie', 'region=' + REG + '&watch_region=' + REG + '&with_watch_monetization_types=flatrate' +
            (prov && prov.length ? '&with_watch_providers=' + prov.join('|') : '') +
            '&sort_by=popularity.desc&vote_count.gte=200&primary_release_date.gte=' + since + '&include_adult=false&language=en-US&page=' + (page || 1))
            .then(function (j) {
                var ids = (j.results || []).filter(function (m) { return m.poster_path; }).slice(0, 20).map(function (m) { return m.id; });
                if (!ids.length && page > 1) return discover(1, prov);           // fewer pages than that: start over
                return ids;
            });
    }
    // Popular films streaming on the apps you have first; popular films anywhere after them, to fill.
    function popularIds(page) {
        var prov = myProviders();
        if (!prov.length) return discover(page);
        return Promise.all([discover(page, prov).catch(function () { return []; }), discover(page)]).then(function (r) {
            return r[0].concat(r[1].filter(function (x) { return r[0].indexOf(x) < 0; }));
        });
    }
    // Most watchable first (see toItem), keeping the incoming order within a tier.
    function rank(list) {
        return list.map(function (r, i) { return { r: r, i: i }; })
            .sort(function (a, b) { return ((a.r.tier == null ? 4 : a.r.tier) - (b.r.tier == null ? 4 : b.r.tier)) || a.i - b.i; })
            .map(function (x) { return x.r; });
    }

    var traktOf = {};                                                     // tmdb id -> Trakt id, for "Not interested"
    function traktIds() {
        return window.Trakt.recommendations().then(function (list) {
            (list || []).forEach(function (m) { if (m.ids && m.ids.tmdb && m.ids.trakt) traktOf[m.ids.tmdb] = m.ids.trakt; });
            return (list || []).map(function (m) { return m.ids && m.ids.tmdb; }).filter(Boolean).slice(0, 60);
        });
    }

    // What the rail showed lately (apart from your watchlist): a refresh prefers anything else, so it really changes.
    function shownLoad() { try { return JSON.parse(localStorage.getItem(RK)) || []; } catch (e) { return []; } }
    function shownAdd(ids) {
        var l = shownLoad().filter(function (x) { return ids.indexOf(x) < 0; }).concat(ids);
        try { localStorage.setItem(RK, JSON.stringify(l.slice(-60))); } catch (e) { /* silent */ }
    }
    // Up to `need` ids from the pool, new ones first; the recently shown are used only if there is nothing else.
    function freshPick(pool, need) {
        var recent = shownLoad(), out = [];
        pool.forEach(function (x) { if (out.length < need && out.indexOf(x) < 0 && recent.indexOf(x) < 0) out.push(x); });
        pool.forEach(function (x) { if (out.length < need && out.indexOf(x) < 0) out.push(x); });
        return out;
    }

    // Films logged as watched here are remembered locally too, so the very next refresh cannot offer them again
    // even if Trakt's own lists lag behind.
    var WK = 'settle.watched.v1';
    function watchedLocal() { try { return JSON.parse(localStorage.getItem(WK)) || []; } catch (e) { return []; } }
    function addWatched(tmdb) {
        var l = watchedLocal().filter(function (x) { return x !== tmdb; });
        l.push(tmdb);
        try { localStorage.setItem(WK, JSON.stringify(l.slice(-600))); } catch (e) { /* silent */ }
    }

    // Films marked "Not interested": never offered again, with or without Trakt.
    var NK = 'settle.notinterested.v1';
    function dismissed() { try { return JSON.parse(localStorage.getItem(NK)) || []; } catch (e) { return []; } }
    function dismiss(tmdb) {
        var l = dismissed().filter(function (x) { return x !== tmdb; });
        l.push(tmdb);
        try { localStorage.setItem(NK, JSON.stringify(l.slice(-600))); } catch (e) { /* silent */ }
        forget(tmdb);
    }

    function say(m) { var e = new Error(m); e.friendly = true; return e; }       // a message the panel may show as is
    function refresh(force, manual) {
        if (!KEY) return manual ? Promise.reject(say('Needs a TMDB key')) : undefined;
        var src = source(), c = load(), T = window.Trakt, WL = 20, wlAll = [], wlTop = [];
        if (force !== true && c && c.region === REG && c.src === src && c.day === today()) return manual ? Promise.resolve() : undefined;
        var ready = window.Platform ? window.Platform.ready() : Promise.resolve();
        var seen = {};
        function unseen(id) { return !seen[id]; }
        function loadSeen() {
            watchedLocal().concat(dismissed()).forEach(function (id) { seen[id] = 1; });
            if (src !== 'trakt' || !T.watchedIds) return Promise.resolve();
            return T.watchedIds().then(function (ids) { ids.forEach(function (id) { seen[id] = 1; }); }, function () { /* the local list still applies */ });
        }
        var POOL = 2 * N + 4;                         // more candidates than slots, so the ones you can stream here can win
        return ready.catch(function () {}).then(loadSeen).then(function () {
            if (src !== 'trakt') return popularIds(nextPage()).then(function (ids) { return freshPick(ids.filter(unseen), POOL); });
            // Rail order: your watchlist (newest first), then Trakt's picks, then popular titles to fill.
            return Promise.all([T.watchlist().catch(function () { return []; }), traktIds().catch(function () { return []; })]).then(function (r) {
                wlAll = r[0]; wlTop = wlAll.filter(unseen).slice(0, WL);
                // Your watchlist stays; everything else is drawn fresh from a bigger pool of Trakt's picks, then popular titles.
                var need = POOL;                                                      // a full For tonight row and then some: ranked below
                var picks = freshPick(r[1].filter(function (x) { return wlTop.indexOf(x) < 0 && unseen(x); }), need), base = wlTop.concat(picks);
                if (picks.length >= need) return base;
                return popularIds(nextPage()).then(function (pop) {
                    if (!base.length && window.Settle) window.Settle.toast('Nothing on your Trakt watchlist or picks yet. Showing what’s popular.');
                    var more = freshPick(pop.filter(function (x) { return base.indexOf(x) < 0 && unseen(x); }), need - picks.length);
                    return base.concat(more);
                });
            });
        }).then(function (ids) {
            return Promise.all(ids.map(detail));
        }).then(function (items) {
            items = items.filter(Boolean);
            items.forEach(function (r) { if (traktOf[r.tmdb]) r.trakt = traktOf[r.tmdb]; });
            if (src !== 'trakt') return rank(items.filter(function (r) { return r.art; })).slice(0, N);
            items = items.filter(function (r) { return r.art; });
            items.forEach(function (r) { r.wl = wlAll.indexOf(r.tmdb) >= 0; });
            var mine = items.filter(function (r) { return wlTop.indexOf(r.tmdb) >= 0; })
                .sort(function (a, b) { return wlTop.indexOf(a.tmdb) - wlTop.indexOf(b.tmdb); });          // watchlist first, as listed
            var rest = items.filter(function (r) { return wlTop.indexOf(r.tmdb) < 0; });
            rest = rank(rest);                                                     // streaming on your apps first, then rent on them, then elsewhere
            return mine.concat(rest.slice(0, N));                                  // the watchlist row, then a full For tonight row
        }).then(function (items) {
            if (!items.length) { if (manual) throw say('Nothing new found'); if (window.Settle && window.Settle.recsFailed) window.Settle.recsFailed(); return; }
            shownAdd(items.filter(function (r) { return !r.wl; }).map(function (r) { return r.tmdb; }));
            save({ t: Date.now(), day: today(), region: REG, src: src, items: items });
            if (window.Settle) window.Settle.setRecs(items, manual === true);
        }).catch(function (e) {
            if (manual) throw (e && e.friendly ? e : say('Could not refresh'));
            if (window.Settle && window.Settle.recsFailed) window.Settle.recsFailed();      // only shows anything when the rail is empty
        });
    }

    // Keep the cached copy in step with a watchlist toggle so a reload shows the same state.
    // A title you just added moves to the front, so it leads the rail next time it is built.
    function setWl(tmdb, on) {
        var c = load();
        if (!c || !c.items) return;
        var i = -1;
        c.items.forEach(function (r, k) { if (r.tmdb === tmdb) { r.wl = !!on; i = k; } });
        if (on && i > 0 && c.src === 'trakt') c.items.unshift(c.items.splice(i, 1)[0]);
        save(c);
    }

    // A title the user logged as watched stays out of the cached rail too.
    function forget(tmdb) {
        var c = load();
        if (!c || !c.items) return;
        c.items = c.items.filter(function (r) { return r.tmdb !== tmdb; });
        save(c);
    }

    /* IMDb rating for the movie panel. TMDB has only the IMDb id (imdb_id, or /movie/{id}/external_ids for a rail cached
       before it was kept); the rating comes from OMDb (www.omdbapi.com/?i=<imdb id>&apikey=<key>  ->  imdbRating), which
       needs a free key in config.local.js as keys.omdb. No key: no rating, nothing is asked. Asked only for the title
       in focus, kept for 7 days. */
    var OMDB = (C.keys || {}).omdb, IK = 'settle.imdb.v1', IMDB_TTL = 7 * 86400000;
    function imdbStore() { try { return JSON.parse(localStorage.getItem(IK)) || {}; } catch (e) { return {}; } }
    function imdbKeep(id, v) {
        var m = imdbStore(), ks;
        m[id] = [v, Date.now()];
        ks = Object.keys(m);
        if (ks.length > 300) ks.sort(function (a, b) { return m[a][1] - m[b][1]; }).slice(0, ks.length - 300).forEach(function (k) { delete m[k]; });
        try { localStorage.setItem(IK, JSON.stringify(m)); } catch (e) { /* silent */ }
    }
    function imdbId(r) {
        if (r.imdb) return Promise.resolve(r.imdb);
        if (!r.tmdb || !KEY) return Promise.resolve('');
        return get('/movie/' + r.tmdb + '/external_ids', '').then(function (j) { r.imdb = j.imdb_id || ''; return r.imdb; });
    }
    // cb('7.8') when there is a rating; nothing otherwise.
    function imdb(r, cb) {
        if (!OMDB || !r || r.connect) return;
        imdbId(r).then(function (id) {
            if (!id) return;
            var hit = imdbStore()[id];
            if (hit && Date.now() - hit[1] < IMDB_TTL) { if (hit[0]) cb(hit[0]); return; }
            return fetch('https://www.omdbapi.com/?i=' + encodeURIComponent(id) + '&apikey=' + encodeURIComponent(OMDB)).then(function (x) {
                if (!x.ok) throw new Error('omdb ' + x.status);
                return x.json();
            }).then(function (j) {
                var v = j && j.Response !== 'False' && /^\d+(\.\d)?$/.test(j.imdbRating || '') ? j.imdbRating : '';
                imdbKeep(id, v);                                                  // "N/A" is remembered too, so it is not asked again
                if (v) cb(v);
            });
        }).catch(function () { /* no rating shown */ });
    }

    /* The details popup: one TMDB call per title, only when the popup opens (movie/{id} with credits and watch
       providers appended), kept in memory for the session (the last 20). */
    var more = {}, moreIds = [];
    // The YouTube id of the film's trailer: an official trailer first, then any trailer, then a teaser.
    function trailerOf(list) {
        var yt = (list || []).filter(function (v) { return v.site === 'YouTube' && v.key; });
        function score(v) { return (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 2 : 4) + (v.official ? 0 : 1); }
        yt = yt.filter(function (v) { return v.type === 'Trailer' || v.type === 'Teaser'; }).sort(function (a, b) { return score(a) - score(b); });
        return yt.length ? yt[0].key : '';
    }
    function details(r) {
        if (!r || !r.tmdb || !KEY) return Promise.resolve(null);
        if (more[r.tmdb]) return Promise.resolve(more[r.tmdb]);
        return get('/movie/' + r.tmdb, 'append_to_response=credits,watch/providers,recommendations,videos&language=en-US').then(function (d) {
            var wp = (d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results[REG]) || {};
            var crew = (d.credits && d.credits.crew) || [], cast = (d.credits && d.credits.cast) || [];
            function tag(list) { return names(list).map(function (n) { return { name: n, onTv: onTv(n) }; }); }
            var lang = '';
            try { lang = d.original_language ? new Intl.DisplayNames(['en'], { type: 'language' }).of(d.original_language) : ''; } catch (e) { lang = d.original_language || ''; }
            var x = {
                tagline: d.tagline || '', overview: d.overview || '',
                genres: (d.genres || []).map(function (g) { return g.name; }),
                released: d.release_date || '', runtime: runtime(d.runtime), language: lang,
                directors: crew.filter(function (c) { return c.job === 'Director'; }).map(function (c) { return c.name; }).slice(0, 2),
                cast: cast.slice(0, 5).map(function (c) { return c.name; }),
                stream: tag(wp.flatrate), rent: tag((wp.rent || []).concat(wp.buy || [])),
                trailer: trailerOf(d.videos && d.videos.results),
                // More like this: TMDB's recommendations for the film, minus anything watched or dismissed here
                like: ((d.recommendations && d.recommendations.results) || []).filter(function (m) {
                    return m.poster_path && !m.adult && watchedLocal().indexOf(m.id) < 0 && dismissed().indexOf(m.id) < 0;
                }).slice(0, 8).map(function (m) { return { tmdb: m.id, title: m.title || m.original_title, art: IMG + m.poster_path }; })
            };
            more[r.tmdb] = x; moreIds.push(r.tmdb);
            if (moreIds.length > 20) delete more[moreIds.shift()];
            return x;
        }).catch(function () { return null; });
    }

    // A full rail item for any film (a "More like this" pick): the same call and shape the rail uses.
    function item(tmdb) { return KEY ? detail(tmdb) : Promise.resolve(null); }

    window.Recs = { imdb: imdb, details: details, item: item, dismiss: dismiss, forget: forget, addWatched: addWatched, short: short, cached: cached, refresh: refresh, refreshNow: function () { return refresh(true, true); }, setWl: setWl, hasKey: !!KEY };
    window.addEventListener('load', function () { refresh(); });
    // Back from another app: refresh if the day changed, or if we were away long enough that picks may have moved.
    document.addEventListener('visibilitychange', function () { if (document.hidden) hiddenAt = Date.now(); });
    (window.onWake = window.onWake || []).push(function () { refresh(hiddenAt && Date.now() - hiddenAt > AWAY ? true : undefined); });
})();
