/*
 * Deep links: open a film inside its app instead of at the app's home screen.
 *
 * TMDB knows where a film streams but not each service's own id for it. JustWatch does, and for every offer it gives the
 * Samsung TV deep link: deeplinkURL(platform: TIZENOS) -> '{"id":"<tizen app id>","action_data":"<payload>"}'. That
 * payload goes to the app as Samsung's eden_resume app control (Platform.launchDeep).
 *
 * Checked against apis.justwatch.com/graphql for India (Nov 2026):
 *   Prime Video   action_data = the title's gti (amzn1.dv.gti....)      reported opening the title on a 2024 Tizen 9 TV
 *   Apple TV      action_data = the tv.apple.com URL of the title
 *   Zee5          action_data = {"assetId": "..."}
 *   Netflix, JioHotstar, MUBI: action_data is empty: JustWatch has no title link for these apps on Samsung either, so
 *   they open at their home screen as before.
 * JustWatch's GraphQL API is public but unofficial (no key, undocumented): it may change. Any failure means a plain launch.
 *
 * One request per film, only when it is about to be needed (details open, or Open pressed), kept 3 days on this TV.
 */
(function () {
    'use strict';

    var C = window.LAUNCHER_CONFIG, REG = C.region || 'IN', URL = 'https://apis.justwatch.com/graphql';
    var DK = 'settle.deeplinks.v4', TTL = 3 * 86400000, mem = {};
    var QUERY = 'query S($country: Country!, $language: Language!, $first: Int!, $f: TitleFilter) { popularTitles(country: $country, first: $first, filter: $f) { edges { node { objectType content(country: $country, language: $language) { externalIds { tmdbId } } offers(country: $country, platform: WEB) { monetizationType package { clearName } tizen: deeplinkURL(platform: TIZENOS) } } } } }';

    function store() { try { return JSON.parse(localStorage.getItem(DK)) || {}; } catch (e) { return {}; } }
    function keep(tmdb, links) {
        var m = store(), ks;
        m[tmdb] = [links, Date.now()];
        ks = Object.keys(m);
        if (ks.length > 120) ks.sort(function (a, b) { return m[a][1] - m[b][1]; }).slice(0, ks.length - 120).forEach(function (k) { delete m[k]; });
        try { localStorage.setItem(DK, JSON.stringify(m)); } catch (e) { /* silent */ }
    }

    // [{ name, kind, app, data }] for the film: only offers that carry a payload.
    function lookup(r) {
        if (!r || !r.tmdb || !r.title) return Promise.resolve([]);
        var key = (r.type === 'tv' ? 'tv' : '') + r.tmdb, want = r.type === 'tv' ? 'SHOW' : 'MOVIE';     // film and show ids overlap
        if (mem[key]) return mem[key];
        var hit = store()[key];
        if (hit && Date.now() - hit[1] < TTL) return (mem[key] = Promise.resolve(hit[0]));
        var body = JSON.stringify({ operationName: 'S', query: QUERY, variables: { country: REG, language: 'en', first: 5, f: { searchQuery: r.title } } });
        var p = fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body }).then(function (x) {
            if (!x.ok) throw new Error('justwatch ' + x.status);
            return x.json();
        }).then(function (j) {
            var edges = (j && j.data && j.data.popularTitles && j.data.popularTitles.edges) || [], out = [];
            var node = edges.map(function (e) { return e.node; }).filter(function (n) {
                return n && n.objectType === want && n.content && n.content.externalIds && String(n.content.externalIds.tmdbId) === String(r.tmdb);
            })[0];
            ((node && node.offers) || []).forEach(function (o) {
                var t = null;
                try { t = o.tizen ? JSON.parse(o.tizen) : null; } catch (e) { t = null; }
                if (!t || !t.id) return;
                var name = window.Recs && window.Recs.short ? window.Recs.short(o.package.clearName) : o.package.clearName;
                if (out.some(function (x) { return x.app === t.id && x.kind === o.monetizationType; })) return;
                out.push({ name: name, kind: o.monetizationType, app: t.id, data: t.action_data || '' });
            });
            keep(key, out);                                                 // "none" is remembered too
            return out;
        }).catch(function () { delete mem[key]; return []; });
        mem[key] = p;
        return p;
    }

    // The deep link for this film on the provider Settle would open, or null: the provider's installed app first (by
    // app id), then by service name; included-in-subscription offers before rent and buy.
    function pick(links, provider) {
        var P = window.Platform, app = P && P.providerApp(provider);
        if (!app) return null;
        var rank = { FLATRATE: 0, FREE: 1, ADS: 1, RENT: 2, BUY: 3 };
        var mine = links.filter(function (l) { return l.data && (l.app === app.id || l.name === provider); })
            .sort(function (a, b) { return (rank[a.kind] == null ? 4 : rank[a.kind]) - (rank[b.kind] == null ? 4 : rank[b.kind]); });
        return mine.length ? { app: app.id, data: mine[0].data } : null;
    }

    // Resolves { app, data } or null. Never rejects; never waits longer than `ms`.
    function find(r, ms) {
        return new Promise(function (ok) {
            var t = setTimeout(function () { ok(null); }, ms || 2500);
            lookup(r).then(function (links) { clearTimeout(t); ok(pick(links, r.provider)); });
        });
    }

    window.DeepLinks = { find: find, prefetch: function (r) { if (r && !r.connect && r.streaming !== false) lookup(r); } };
})();
