/*
 * The Control Center's launcher-side entries, kept apart from the TV (Vetro) adapter:
 *   Wallpaper        -> fetch a new photo now and crossfade it in
 *   Recommendations  -> refetch the rail now and repopulate it
 * compose(base) wraps the Vetro adapter so the panel still talks to ONE adapter. Both actions have a deadline,
 * so a tile can never sit on "Working…". A failure comes back as a short message the panel shows on the tile.
 */
(function () {
    'use strict';

    var DEADLINE = 15000;

    function within(p, ms) {
        return new Promise(function (ok, no) {
            var t = setTimeout(function () { no(new Error('Took too long')); }, ms);
            p.then(function (v) { clearTimeout(t); ok(v); }, function (e) { clearTimeout(t); no(e); });
        });
    }

    var EXTRA = [
        { id: 'wallpaper', label: 'Wallpaper', kind: 'run' },
        { id: 'recs', label: 'Recommendations', kind: 'run' },
        { id: 'screensaver', label: 'Screensaver', kind: 'choice' }
    ];
    var SS = [[0, 'Off'], [120000, '2 min'], [300000, '5 min'], [600000, '10 min'], [1800000, '30 min']];
    function ssView() {
        var S = window.Screensaver;
        if (!S) return { value: 'Not available', current: null };
        var st = S.status(), hit = SS.filter(function (o) { return o[0] === st.ms; })[0];
        var v = hit ? hit[1] : Math.round(st.ms / 60000) + ' min';
        if (st.ms && st.known && !st.app) v = 'Aerial not installed';
        else if (st.ms && st.off) v = 'Off for now';
        return { value: v, current: String(st.ms) };
    }
    var IDLE = { wallpaper: { value: 'New photo', current: null }, recs: { value: 'Refresh', current: null } };

    function merge(m) { m = m || {}; Object.keys(IDLE).forEach(function (k) { m[k] = IDLE[k]; }); m.screensaver = ssView(); return m; }

    // Recent apps: opens the app switcher (the panel closes first). It goes after Input, where Wi-Fi used to be.
    var RECENT = { id: 'recent', label: 'Recent apps', kind: 'run' };
    IDLE.recent = { value: 'See what’s open', current: null };

    function compose(base) {
        return {
            controls: function () { var c = base.controls(), i = c.map(function (x) { return x.id; }).indexOf('input') + 1; return c.slice(0, i).concat([RECENT], c.slice(i), EXTRA); },
            page: base.page,
            options: function (id) { return id === 'screensaver' ? SS.map(function (o) { return { id: String(o[0]), label: o[1] }; }) : base.options(id); },
            cached: function () { return merge(base.cached()); },
            read: function () { return base.read().then(merge, function () { return merge(base.cached()); }); },
            act: function (id, arg) {
                if (id === 'screensaver') {
                    var ms = parseInt(arg, 10);
                    if (!SS.some(function (o) { return o[0] === ms; })) return Promise.reject(new Error('unknown choice'));
                    window.Screensaver.setTimeoutMs(ms);
                    return Promise.resolve();
                }
                if (id === 'recent') {
                    if (!window.Settle || !window.Settle.openSwitcher) return Promise.reject(new Error('Not available'));
                    window.Settle.openSwitcher(true);
                    return Promise.resolve();
                }
                if (id === 'wallpaper') {
                    if (!window.Wallpaper) return Promise.reject(new Error('Not available'));
                    return within(window.Wallpaper.refreshNow(), DEADLINE).then(function () { return 'New photo set'; });
                }
                if (id === 'recs') {
                    if (!window.Recs || !window.Recs.refreshNow) return Promise.reject(new Error('Not available'));
                    return within(window.Recs.refreshNow(), DEADLINE).then(function () { if (window.AppInfo) window.AppInfo.invalidate(); return 'Refreshed'; });
                }
                return base.act(id, arg);
            }
        };
    }

    window.LauncherControls = { compose: compose };
})();
