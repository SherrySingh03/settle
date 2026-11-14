/*
 * Weather from Open-Meteo (no key). Fetch once, cache 30 min in localStorage, never poll:
 * refreshed at boot and when the launcher comes back to the foreground, only if stale.
 * Any failure is silent; the last cached reading (up to 6 h old) keeps showing.
 *
 * Location, in order:
 *   1. weather.latitude/longitude in config (explicit override, nothing is looked up)
 *   2. a cached lookup (30 days: the TV does not move)
 *   3. one coarse IP lookup (geojs.io, no key), coordinates rounded to 2 decimals, then cached
 * navigator.geolocation is deliberately not used: a TV has no GPS and the prompt can hang.
 */
(function () {
    'use strict';

    var KEY = 'settle.wx.v2', LKEY = 'settle.loc.v1';
    var FRESH = 30 * 60 * 1000, USABLE = 6 * 60 * 60 * 1000, LOC_TTL = 30 * 24 * 60 * 60 * 1000;
    var C = window.LAUNCHER_CONFIG, W = C.weather || {};
    var loc = null;                                           // { lat, lon, label }

    function group(c) {
        if (c <= 1) return 'Clear';
        if (c <= 3) return 'Cloudy';
        if (c <= 48) return 'Fog';
        if (c <= 57) return 'Drizzle';
        if (c <= 67) return 'Rain';
        if (c <= 77) return 'Snow';
        if (c <= 84) return 'Showers';
        if (c <= 86) return 'Snow';
        return 'Thunderstorm';
    }

    function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
    function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* silent */ } }

    function getJSON(url, cb) {
        var ctl = window.AbortController ? new AbortController() : null;
        var to = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
        fetch(url, ctl ? { signal: ctl.signal } : undefined)
            .then(function (r) { return r.json(); })
            .then(function (j) { clearTimeout(to); cb(j); })
            .catch(function () { clearTimeout(to); cb(null); });
    }

    function resolveLocation(cb) {
        if (W.latitude != null && W.longitude != null) {
            loc = { lat: W.latitude, lon: W.longitude, label: W.label || '' };
            return cb(loc);
        }
        var c = load(LKEY);
        if (c && Date.now() - c.t < LOC_TTL) { loc = c; return cb(loc); }
        getJSON('https://get.geojs.io/v1/ip/geo.json', function (j) {
            var lat = j ? parseFloat(j.latitude) : NaN, lon = j ? parseFloat(j.longitude) : NaN;
            if (isNaN(lat) || isNaN(lon)) return cb(c || null);           // stale lookup beats none
            loc = { t: Date.now(), lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, label: j.city || '' };
            save(LKEY, loc);
            cb(loc);
        });
    }

    function show(r) {
        var short = r.temp + '° ' + r.label;
        window.Settle.setWeather(short + (r.place ? ' · ' + r.place : ''), short, r.label === 'Clear' ? (r.day ? 'sun' : 'moon') : 'cloud');
    }

    function sameSpot(r) { return loc && r.lat === loc.lat && r.lon === loc.lon; }

    function refresh() {
        resolveLocation(function (l) {
            if (!l) return;
            var c = load(KEY);
            if (c && sameSpot(c) && Date.now() - c.t < FRESH) return;
            getJSON('https://api.open-meteo.com/v1/forecast?latitude=' + l.lat + '&longitude=' + l.lon +
                '&current=temperature_2m,weather_code,is_day&timezone=auto', function (j) {
                var cur = j && j.current;
                if (!cur) return;                                   // silent: keep what is on screen
                var r = { t: Date.now(), lat: l.lat, lon: l.lon, place: l.label, temp: Math.round(cur.temperature_2m), label: group(cur.weather_code), day: !!cur.is_day };
                save(KEY, r);
                show(r);
            });
        });
    }

    function init() {
        var c = load(KEY), l = load(LKEY);
        if (W.latitude != null) l = { lat: W.latitude, lon: W.longitude };
        if (c && l && c.lat === l.lat && c.lon === l.lon && Date.now() - c.t < USABLE) { loc = l; show(c); }
        refresh();
        (window.onWake = window.onWake || []).push(refresh);
    }

    window.addEventListener('load', init);
})();
