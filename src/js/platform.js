/*
 * Tizen glue: installed apps, the dock layout, launching, HDMI sources.
 * In a desktop browser it runs the same code against a fake app list (config apps + MOCK.apps).
 *
 * Dock layout: the config's `apps` are the default. A layout the user saved from the editor
 * (localStorage settle.dock.v1, an ordered list of app ids) replaces it.
 *
 * The app list comes from Tizen's own tizen.application.getAppsInfo() (no Vetro, no root). It is cached, so the dock
 * and All apps draw from the cache on the first frame; the live list replaces it when it arrives. If the TV is still
 * busy starting up and the call fails or times out, it is asked again with backoff (1 s, 2 s, 4 s ... up to 60 s)
 * until it answers. With neither a cache nor a live list the dock shows the configured favourites, never nothing.
 */
(function () {
    'use strict';

    var HAS = typeof tizen !== 'undefined' && !!tizen.application;
    var VIEWER = 'org.tizen.tv-viewer', DOCK_KEY = 'settle.dock.v1', MAX_APPS = 7;
    var raw = [];                 // last getAppsInfo list (or the cached one, or the fake one)
    var APPS_KEY = 'settle.apps.v1', src = 'none', onChange = null, tries = 0, retryT = 0, booted = false;
    var catalog = [];             // every app we may launch, decorated: config matches + consumer apps
    var dockIds = [];

    // Every failure of the app-list and launch calls, with the error's name and message, for Diagnostics and captures.
    var errs = [];
    function note(kind, id, e) {
        errs.push({ t: new Date().toTimeString().slice(0, 8), kind: kind, id: id || '', name: (e && e.name) || 'Error', message: (e && e.message) || String(e) });
        if (errs.length > 8) errs.shift();
    }

    function timeout(p, ms) {
        return new Promise(function (res, rej) {
            var t = setTimeout(function () { rej(new Error('timeout')); }, ms);
            p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
        });
    }

    function selfId() {
        try { return tizen.application.getCurrentApplication().appInfo.id; } catch (e) { return null; }
    }

    /* ---------- which installed apps count ---------- */

    // A name match must be the app itself, not a background service (e.g. Plex's ContinueWatchingService).
    var NOISE = /service|worker|preview|promotion|plugin|launcher|sdk|daemon|agent|dummy|factory|e-?manual/i;
    var NOISE2 = /test|account|privacy|security|adplayer|^ep[ -]/i;
    var STORE_ID = /^[A-Za-z0-9]{10}\.[A-Za-z0-9_-]+$/, NUMERIC_ID = /^\d{9,13}$/, MOCK_ID = /^mock\./;
    var PRELOADED = ['org.tizen.netflix-app', 'org.tizen.primevideo', 'org.tizen.apple.apple-music', 'org.tizen.browser', 'com.samsung.tv.aria-video'];
    var GUESS = [[/youtube|tizentube/i, 'youtube'], [/netflix/i, 'netflix'], [/prime ?video/i, 'primevideo'], [/spotify/i, 'spotify'],
                 [/plex/i, 'plex'], [/xbox/i, 'xbox'], [/disney/i, 'disneyplus'], [/apple ?tv|aria-video/i, 'appletv'],
                 [/stremio/i, 'stremio'], [/apple ?music|apple-music/i, 'applemusic'], [/ org\.tizen\.browser$/, 'samsunginternet']];

    // System/internal entries that carry store-style ids but are not apps a person opens.
    var INTERNAL = ['adplatform.ADPlayer', 'WykOS4t4F0.cmsWebApp', '25emanual3.emanual', 'ZODRT12q2l.WebAccountExtension', 'ByJlgt0XeD.CastSettingsApp',
                    'tv6pbVMQFF.PrivacyChoices', '2022ePop01.SmartTV', 'w2VwCK465D.OTApp', 'J9fZJDMi1v.SecurityCenter'];

    function isConsumer(a) {
        if (PRELOADED.indexOf(a.id) >= 0 || MOCK_ID.test(a.id)) return true;
        if (a.show === false || !a.name) return false;
        if (!STORE_ID.test(a.id) && !NUMERIC_ID.test(a.id)) return false;
        return !NOISE.test(a.id + ' ' + a.name) && !NOISE2.test(a.id + ' ' + a.name);
    }

    function shortName(n) { return (n.split(/\s+[-:|–]\s+/)[0] || n).trim(); }

    function entryFor(a, cfg) {
        return cfg.apps.filter(function (e) {
            return e.id ? e.id === a.id : (new RegExp(e.match, 'i').test(a.id) || new RegExp(e.match, 'i').test(a.name)) && !NOISE.test(a.id + ' ' + a.name);
        })[0];
    }

    // An installed app plus whatever the config knows about it (label, tile colour, brand, bundled logo).
    function decorate(a, cfg, entry) {
        entry = entry || entryFor(a, cfg) || {};
        var label = entry.label || shortName(a.name), brand = entry.brand;
        if (!brand) GUESS.some(function (g) { if (g[0].test(a.name + ' ' + a.id)) { brand = g[1]; return true; } });
        var B = brand && window.BRANDS && window.BRANDS[brand];
        var brandFirst = (entry.useBrand === true || (B && B.always === true)) && B;                    // the bundled logo wins over the TV's icon
        var own = entry.chip === true || !!brandFirst;                                  // config: this app has no real icon, show its name
        return {
            id: a.id, pkg: (own || entry.logo) ? '' : (a.packageId || ''), label: label, tone: entry.tone, brand: brand, brandFirst: !!brandFirst,
            icon: entry.logo || (own ? '' : (a.iconPath || ''))
        };
    }

    /* ---------- dock layout ---------- */

    // Apps the user chose to hide from All apps (they stay on the dock if they are on it).
    var HIDE_KEY = 'settle.hide.v1';
    function hiddenIds() { try { return JSON.parse(localStorage.getItem(HIDE_KEY)) || {}; } catch (e) { return {}; } }
    function hideApp(id) { var m = hiddenIds(); m[id] = 1; try { localStorage.setItem(HIDE_KEY, JSON.stringify(m)); } catch (e) { /* silent */ } }
    function unhideAll() { try { localStorage.removeItem(HIDE_KEY); } catch (e) { /* silent */ } }
    function appInfo(id) {
        var a = raw.filter(function (x) { return x.id === id; })[0];
        return a ? { id: a.id, pkg: a.packageId || '', version: a.version || '', icon: a.iconPath || '' } : null;
    }

    function savedDock() {
        try { var a = JSON.parse(localStorage.getItem(DOCK_KEY)); return Array.isArray(a) ? a : null; } catch (e) { return null; }
    }
    function setDock(ids) {
        try { if (ids) localStorage.setItem(DOCK_KEY, JSON.stringify(ids)); else localStorage.removeItem(DOCK_KEY); } catch (e) { /* silent */ }
    }

    // prefer: ['app.id', ...] in a config entry: the first of these that is installed wins over the other matches (a TV
    // with two YouTube apps: Samsung's own, signed in, and the old store one).
    function preferred(entry, used) {
        var ids = entry.prefer || [];
        for (var i = 0; i < ids.length; i++) {
            var a = raw.filter(function (x) { return x.id === ids[i] && !(used && used[x.id]); })[0];
            if (a) return a;
        }
        return null;
    }
    // An app that matches a config entry whose preferred app is installed, without being that app: a duplicate, left out
    // of All apps and never opened in its place.
    function isDupe(a, cfg) {
        return (cfg.apps || []).some(function (e) {
            if (!e.prefer || !e.match) return false;
            var p = preferred(e);
            if (!p || p.id === a.id) return false;
            var re = new RegExp(e.match, 'i'), n = norm(a.name);
            // same name only: YouTube Kids or YouTube TV match "youtube" too, but are other apps
            return (re.test(a.id) || re.test(a.name || '')) && (n === norm(p.name) || n === norm(e.label));
        });
    }

    function defaultDock(cfg) {
        var me = selfId(), used = {}, out = [];
        cfg.apps.forEach(function (entry) {
            var re = entry.match ? new RegExp(entry.match, 'i') : null;
            var hit = preferred(entry, used) || raw.filter(function (a) {
                if (used[a.id] || a.id === me) return false;
                if (entry.id) return a.id === entry.id;
                return (re.test(a.id) || re.test(a.name)) && !NOISE.test(a.id + ' ' + a.name);
            })[0];
            if (hit) { used[hit.id] = 1; out.push(decorate(hit, cfg, entry)); }
        });
        return out;
    }

    // No app list at all (first boot, the TV not answering yet): the configured favourites, drawn with their bundled
    // logo or as a name chip. They are replaced by the real apps as soon as the list arrives.
    function favourites(cfg) {
        return cfg.apps.map(function (e) {
            var b = e.useBrand === true && e.brand && window.BRANDS && window.BRANDS[e.brand];
            return { id: e.id || '', pkg: '', label: e.label, tone: e.tone, brand: b ? e.brand : '', brandFirst: !!b, icon: e.logo || '', placeholder: true };
        });
    }

    // The dock to draw right now: the saved layout if there is one, else the config default.
    function layout(cfg) {
        if (!raw.length) { var f = favourites(cfg).slice(0, MAX_APPS); dockIds = []; return f; }
        var saved = savedDock(), items;
        if (saved) {
            items = saved.map(function (id) { return raw.filter(function (a) { return a.id === id; })[0]; })
                .filter(Boolean).map(function (a) {                           // a duplicate saved earlier: its preferred twin instead
                    if (!isDupe(a, cfg)) return a;
                    var e = (cfg.apps || []).filter(function (x) { return x.prefer && preferred(x) && entryFor(a, cfg) === x; })[0];
                    return (e && preferred(e)) || a;
                })
                .filter(function (a, i, all) { return all.indexOf(a) === i; }).map(function (a) { return decorate(a, cfg); });
        } else {
            items = defaultDock(cfg);
        }
        if (!items.length) items = defaultDock(cfg);                    // a saved layout that matches nothing must not leave an empty dock
        items = items.slice(0, MAX_APPS);
        dockIds = items.map(function (i) { return i.id; });
        return items;
    }

    function buildCatalog(cfg) {
        var seen = {}, me = selfId(), out = [];
        defaultDock(cfg).concat(raw.filter(function (a) { return a.id !== me && isConsumer(a) && !isDupe(a, cfg); }).map(function (a) { return decorate(a, cfg); }))
            .forEach(function (it) { if (!seen[it.id]) { seen[it.id] = 1; out.push(it); } });
        catalog = out;
    }

    // Every app the TV lists as visible, A-Z by display name. Background services are left out;
    // everything else (system apps included) is an installed app.
    var lastCfg = null, lastStats = { shown: 0, hidden: [] };

    // An application a person would open: store/preloaded apps, minus services and internals.
    // config.allApps.include force-shows an id; config.allApps.hide hides anything matching a pattern.
    function isApp(a, cfg, pinned) {
        var o = cfg.allApps || {};
        if (hiddenIds()[a.id]) return false;
        if (pinned[a.id] || (o.include || []).indexOf(a.id) >= 0) return true;
        if ((o.hide || []).some(function (r) { return new RegExp(r, 'i').test(a.id + ' ' + a.name); })) return false;
        if (INTERNAL.indexOf(a.id) >= 0 || isDupe(a, cfg)) return false;
        return isConsumer(a);
    }

    // Every application, A-Z by display name.
    function allInstalled() {
        var me = selfId(), seen = {}, out = [], hidden = [], cfg = lastCfg || { apps: [] }, pinned = {};
        if (!raw.length) { lastStats = { shown: 0, hidden: [] }; return favourites(cfg); }        // no list yet: never an empty grid
        defaultDock(cfg).forEach(function (it) { pinned[it.id] = 1; });               // your configured favourites are always apps
        raw.forEach(function (a) {
            if (a.id === me || seen[a.id] || !a.name) return;
            seen[a.id] = 1;
            if (!isApp(a, cfg, pinned)) { if (a.show !== false) hidden.push(a.name); return; }
            out.push(decorate(a, cfg));
        });
        lastStats = { shown: out.length, hidden: hidden };
        return out.sort(function (x, y) { return x.label.replace(/^[^A-Za-z0-9]+/, '').localeCompare(y.label.replace(/^[^A-Za-z0-9]+/, ''), undefined, { sensitivity: 'base' }); });
    }


    var readyP = null;
    // cb (optional) is called each time the list changes after the first answer: the live list replacing the cache.
    function apps(cfg, cb) { lastCfg = cfg; onChange = cb || null; readyP = load(cfg); return readyP; }

    function compact(list) {
        return (list || []).map(function (a) { return { id: a.id, name: a.name, packageId: a.packageId || '', iconPath: a.iconPath || '', show: a.show !== false }; });
    }
    function cached() { try { var l = JSON.parse(localStorage.getItem(APPS_KEY)); return Array.isArray(l) && l.length ? l : null; } catch (e) { return null; } }
    function keep(list) { try { localStorage.setItem(APPS_KEY, JSON.stringify(list)); } catch (e) { /* quota: the live list still works */ } }

    function load(cfg) {
        if (!HAS) {
            raw = cfg.apps.map(function (a) { return { id: a.id || ('mock.' + a.label), name: a.label, packageId: '', iconPath: '', show: true }; })
                .concat(((window.MOCK && window.MOCK.apps) || []).map(function (n) { return { id: 'mock.' + n, name: n, packageId: '', iconPath: '', show: true }; }))
                .concat(((window.MOCK && window.MOCK.hidden) || []).map(function (id) { return { id: id, name: id, packageId: '', iconPath: '', show: true }; }));
            // Preview only: MOCK.tvApps ([{ id, name }], e.g. read from a TV) stands in for the TV's own list, to rebuild its exact state
            if (window.MOCK && window.MOCK.tvApps) raw = window.MOCK.tvApps.map(function (a) { return { id: a.id, name: a.name, packageId: '', iconPath: '', show: true }; });
            if (window.MOCK && window.MOCK.appsFail) return mockFailing(cfg);
            src = 'live'; buildCatalog(cfg);
            return Promise.resolve(layout(cfg));
        }
        var c = cached();
        if (c) { raw = c; src = 'cache'; buildCatalog(cfg); }
        var first = live(cfg);
        if (c) { booted = true; first.catch(function () { /* retrying */ }); return Promise.resolve(layout(cfg)); }
        return first.then(function () { booted = true; return layout(cfg); }, function () { booted = true; return layout(cfg); });
    }

    // Ask Tizen; on failure ask again later with backoff, until it answers.
    function live(cfg) {
        clearTimeout(retryT);
        return timeout(new Promise(function (ok, no) { tizen.application.getAppsInfo(ok, no); }), 8000).then(function (list) {
            var fresh = compact(list);
            if (!fresh.length) throw new Error('empty');
            var changed = JSON.stringify(fresh) !== JSON.stringify(raw);
            raw = fresh; tries = 0; keep(fresh);
            var was = src; src = 'live';
            buildCatalog(cfg);
            if (booted && onChange && (changed || was !== 'live')) onChange();      // after boot: tell the dock (before boot, load() returns it)
            return changed;
        }).catch(function (e) {
            note('getAppsInfo', '', e);
            var wait = Math.min(60000, 1000 * Math.pow(2, tries++));
            retryT = setTimeout(function () { live(cfg).catch(function () { /* the next retry is already scheduled */ }); }, wait);
            throw e;
        });
    }

    // Ask Tizen again now (All apps opening, an app installed or removed). Resolves true if the list changed.
    function refresh() {
        if (!HAS) {
            var extra = (window.MOCK && window.MOCK.installLater) || [];          // preview: apps "installed" while running
            var gone = (window.MOCK && window.MOCK.removeLater) || [];           // ... and "uninstalled"
            if (gone.length) { raw = raw.filter(function (a) { return gone.indexOf(a.id) < 0; }); window.MOCK.removeLater = []; if (!extra.length) { buildCatalog(lastCfg); return Promise.resolve(true); } }
            if (!extra.length) return Promise.resolve(false);
            raw = raw.concat(extra.map(function (n) { return { id: 'mock.' + n, name: n, packageId: '', iconPath: '', show: true }; }));
            window.MOCK.installLater = [];
            buildCatalog(lastCfg);
            return Promise.resolve(true);
        }
        if (!lastCfg) return Promise.resolve(false);
        return live(lastCfg).catch(function () { return false; });
    }
    // Tizen reports installs, updates and removals (packagemanager.info, already declared): re-read the list then.
    try {
        if (HAS && tizen.package && tizen.package.setPackageInfoEventListener) {
            tizen.package.setPackageInfoEventListener({
                oninstalled: function () { refresh(); },
                onupdated: function () { refresh(); },
                onuninstalled: function () { refresh(); }
            });
        }
    } catch (e) { note('packageListener', '', e); }

    // Preview only (MOCK.appsFail = n): the first n calls fail, to exercise the retry path.
    function mockFailing(cfg) {
        var all = raw; raw = []; src = 'none';
        function attempt() {
            if (window.MOCK.appsFail-- > 0) { retryT = setTimeout(attempt, Math.min(60000, 1000 * Math.pow(2, tries++))); return; }
            raw = all; src = 'live'; tries = 0; buildCatalog(cfg); if (onChange) onChange();
        }
        retryT = setTimeout(attempt, 50);
        return Promise.resolve(layout(cfg));
    }

    /* ---------- launching ---------- */

    // onFail(error) when the TV refuses; the failure is also recorded with its name and message.
    // When each app was opened from Settle (the app switcher's order and its "opened 12 min ago").
    function noteLaunch(id) {
        var t = launchTimes(), ks;
        t[id] = Date.now();
        ks = Object.keys(t);
        if (ks.length > 30) ks.sort(function (a, b) { return t[a] - t[b]; }).slice(0, ks.length - 30).forEach(function (k) { delete t[k]; });
        try { localStorage.setItem(TIMES_KEY, JSON.stringify(t)); } catch (e) { /* silent */ }
    }
    var TIMES_KEY = 'settle.launchedat.v1';
    function launchTimes() { try { var m = JSON.parse(localStorage.getItem(TIMES_KEY)); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } }

    function launch(id, onFail) {
        if (!id) return;                                                 // a favourite shown before the app list arrived
        noteLaunch(id);
        if (!HAS) { console.log('[launch]', id); return; }
        function fail(e) { note('launch', id, e); if (onFail) onFail(e); }
        try { tizen.application.launch(id, function () {}, fail); } catch (e) { fail(e); }
    }
    // The first of several app ids that launches; resolves with it, or rejects with the last error.
    function launchFirst(ids) {
        return ids.reduce(function (chain, id) {
            return chain.catch(function () {
                return new Promise(function (ok, no) {
                    if (!HAS) { console.log('[launch]', id); return ok(id); }
                    try { tizen.application.launch(id, function () { ok(id); }, function (e) { note('launch', id, e); no(e); }); } catch (e) { note('launch', id, e); no(e); }
                });
            });
        }, Promise.reject(new Error('none')));
    }

    // One launch attempt, not wrapped by the launch animation: resolves when the TV accepts it, rejects otherwise.
    function tryLaunch(id) {
        return new Promise(function (ok, no) {
            if (!HAS) { console.log('[launch]', id); return ok(id); }
            try { tizen.application.launch(id, function () { ok(id); }, function (e) { note('launch', id, e); no(e); }); } catch (e) { note('launch', id, e); no(e); }
        });
    }

    // Opens an app at a title: Samsung's deep-link convention (the one Smart Hub preview tiles use), an app control
    // with operation eden_resume and the data as  PAYLOAD = '{"values": "<data>"}'. Resolves when the TV accepts it;
    // whether the app then shows the title is up to the app.
    function launchDeep(id, data) {
        noteLaunch(id);
        return new Promise(function (ok, no) {
            if (!HAS) { console.log('[deeplink]', id, data); return ok(id); }
            try {
                var ctl = new tizen.ApplicationControl('http://samsung.com/appcontrol/operation/eden_resume', null, null, null,
                    [new tizen.ApplicationControlData('PAYLOAD', [JSON.stringify({ values: data })])]);
                tizen.application.launchAppControl(ctl, id, function () { ok(id); }, function (e) { note('deeplink', id, e); no(e); });
            } catch (e) { note('deeplink', id, e); no(e); }
        });
    }
    // The installed app for a "where to watch" provider name, or null.
    function providerApp(name) { return byLabel((window.LAUNCHER_CONFIG.providerApps || {})[name]) || byLabel(name) || null; }

    /* ---------- running apps (the app switcher) ---------- */

    // Never offered for closing: the launcher itself, Samsung's home (it restarts at once), the TV / HDMI viewer, Vetro.
    var KEEP_ID = /^(com\.samsung\.tv\.csfs|com\.samsung\.tv\.coba\.|org\.tizen\.tv-viewer)|tv-?viewer|hdmi|vetro/i;
    function keepOpen(a) {
        var home = window.LAUNCHER_CONFIG.samsungHome || [];
        return a.id === selfId() || home.indexOf(a.id) >= 0 || KEEP_ID.test(a.id) || /vetro/i.test(a.name || '');
    }

    // Open apps a person would recognise: a running context whose app is an installed, visible application (anything
    // else is a service), minus the ones above. Most recently opened from Settle first, the rest after.
    // Resolves [{ ctx, it }] where it is the decorated app (label, icon, tone) the dock uses.
    function running() {
        var ctxs = !HAS ? Promise.resolve(((window.MOCK && window.MOCK.running) || []).map(function (id, i) { return { id: 'ctx' + i, appId: id }; }))
            : new Promise(function (ok, no) { try { tizen.application.getAppsContext(ok, no); } catch (e) { no(e); } });
        return timeout(ctxs, 5000).then(function (list) {
            var cfg = lastCfg || window.LAUNCHER_CONFIG, mine = recent(), known = {}, seen = {}, out = [];
            catalog.forEach(function (c) { known[c.id] = 1; });
            (list || []).forEach(function (c) {
                var a = raw.filter(function (x) { return x.id === c.appId; })[0];
                if (!a || a.show === false || seen[a.id] || keepOpen(a)) return;
                if (!known[a.id] && !isConsumer(a) && mine.indexOf(a.id) < 0) return;   // visible, but platform plumbing
                seen[a.id] = 1;
                out.push({ ctx: c.id, it: decorate(a, cfg) });
            });
            return out.map(function (x, i) { var r = mine.indexOf(x.it.id); return { x: x, k: r < 0 ? 1000 + i : r }; })
                .sort(function (p, q) { return p.k - q.k; }).map(function (p) { return p.x; });
        }, function (e) { note('running', '', e); throw e; });
    }

    // Close one app by its context id. If the TV refuses, Vetro's app_launcher -k (logged as a fallback).
    function kill(ctx, appId) {
        var direct = !HAS ? Promise.resolve(window.MOCK && window.MOCK.running && (window.MOCK.running = window.MOCK.running.filter(function (x) { return x !== appId; }))) : new Promise(function (ok, no) { try { tizen.application.kill(ctx, ok, no); } catch (e) { no(e); } });
        return timeout(direct, 5000).catch(function (e) {
            note('kill', appId, e);
            console.warn('[switcher] kill() refused for ' + appId + ' (' + ((e && e.name) || 'Error') + '): trying Vetro');
            if (!window.Vetro || !window.Vetro.killApp) throw e;
            return window.Vetro.killApp(appId);
        });
    }

    function launchProvider(name) {
        var app = byLabel((window.LAUNCHER_CONFIG.providerApps || {})[name]) || byLabel(name);
        if (app) launch(app.id);
    }

    /* ---------- HDMI sources ---------- */

    function sources() {
        if (!HAS || !tizen.systeminfo) {
            return Promise.resolve([1, 2, 3, 4].map(function (n) { return { n: n, label: 'HDMI ' + n, on: n !== 3 }; }));
        }
        return timeout(new Promise(function (ok, no) { tizen.systeminfo.getPropertyValue('VIDEOSOURCE', ok, no); }), 8000)
            .then(function (info) {
                var list = [];
                (info.connected || []).forEach(function (s) { if (s.type === 'HDMI') list.push({ n: s.number, label: 'HDMI ' + s.number, on: true, src: s }); });
                (info.disconnected || []).forEach(function (s) { if (s.type === 'HDMI') list.push({ n: s.number, label: 'HDMI ' + s.number, on: false, src: s }); });
                return list.sort(function (a, b) { return a.n - b.n; });
            })
            .catch(function () { return []; });
    }

    function openSource(s) {
        if (!HAS || !s.src) { console.log('[source]', s.label); return; }
        try {
            tizen.tvwindow.setSource(s.src, function () { launch(VIEWER); }, function () {}, 'MAIN');
        } catch (e) { /* silent */ }
    }

    function exit() {
        try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* browser */ }
    }

    // App labels compared loosely ("ZEE5" = "Zee5", "Sony LIV" = "SonyLIV"): TMDB's provider names and app names differ in case.
    function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
    function byLabel(label) { var k = norm(label); return k ? catalog.filter(function (a) { return norm(a.label) === k; })[0] : null; }
    function isInstalled(label) { return !!byLabel(label); }
    function ready() { return readyP || Promise.resolve(); }

    window.Platform = {
        apps: apps, ready: ready, isInstalled: isInstalled, launch: launch, launchProvider: launchProvider,
        launchDeep: launchDeep, providerApp: providerApp,
        // Never offered for uninstalling: Settle itself and Vetro (Settle depends on both). The TV refuses its own apps.
        canUninstall: function (id) {
            var a = raw.filter(function (x) { return x.id === id; })[0];
            return !!a && (!HAS || !!a.packageId) && a.id !== selfId() && !/vetro/i.test(a.id + ' ' + (a.name || '')) && !/^SettleTv01\./.test(a.id);
        },
        sources: sources, openSource: openSource, exit: exit,
        // dock editing
        allInstalled: allInstalled, appStats: function () { return lastStats; },
        hideApp: hideApp, unhideAll: unhideAll, appInfo: appInfo, hiddenCount: function () { return Object.keys(hiddenIds()).length; },
        installedIds: function () { return raw.map(function (a) { return a.id; }); },
        source: function () { return src; }, refresh: refresh,
        findApp: function (re) { var a = raw.filter(function (x) { return re.test(x.id) || re.test(x.name || ''); })[0]; return a ? { id: a.id, name: a.name } : null; }, errors: function () { return errs.slice(); }, launchFirst: launchFirst,                                // 'live' | 'cache' | 'none' (favourites shown)
        dockIds: function () { return dockIds.slice(); },
        running: running, kill: kill, tryLaunch: tryLaunch, launchedAt: function (id) { return launchTimes()[id] || 0; },
        note: function (kind, id, msg) { note(kind, id, { name: 'Note', message: msg }); },
        layout: layout, setDock: setDock, hasSavedDock: function () { return !!savedDock(); }, maxApps: MAX_APPS
    };
})();
