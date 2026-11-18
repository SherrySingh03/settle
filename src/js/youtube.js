/*
 * Trailers: play a film's YouTube trailer in the TV's own YouTube app.
 *
 * On Tizen 9 the YouTube app ignores a video id handed over at launch (DIAL  v=<id>  is dropped). What does play a
 * video is the cast protocol the YouTube phone app uses (the "Lounge"), with Settle acting as the phone:
 *   1. the YouTube app's screen id: from the TV's DIAL service while YouTube runs (read through Vetro, see
 *      Vetro.youtubeScreen), or set once as youtube.screenId in config.local.js; kept on this TV afterwards
 *   2. POST www.youtube.com/api/lounge/pairing/get_lounge_token_batch  screen_ids=<id>    -> screens[0].loungeToken
 *   3. POST .../api/lounge/bc/bind?RID=0&VER=8&CVER=1  (header X-YouTube-LoungeId-Token)   -> SID, gsessionid, and a
 *      loungeStatus listing the devices: the TV is ready once a LOUNGE_SCREEN device is in it (asked once a second)
 *   4. POST .../bc/bind?SID&gsessionid&RID=1  req0__sc=setPlaylist, req0__videoId=<trailer> ...   -> it plays
 * Request shapes from casttube (YouTubeSession.py) and pyytlounge (wrapper.py), and the field notes of a 2024 Tizen 9
 * TV where this played the clip. The protocol is Google's own and undocumented: if any step fails, YouTube is still
 * open and Settle says so when you come back.
 * Needs background-support (config.xml): YouTube takes the screen before the trailer is sent.
 */
(function () {
    'use strict';

    var C = window.LAUNCHER_CONFIG, P = window.Platform, LOUNGE = 'https://www.youtube.com/api/lounge/';
    var SK = 'settle.ytscreen.v1', IK = 'settle.ytremote.v1', pending = '', busy = false;

    function form(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
    function post(path, params, body, token) {
        var h = { 'content-type': 'application/x-www-form-urlencoded' };
        if (token) h['X-YouTube-LoungeId-Token'] = token;
        return fetch(LOUNGE + path + (params ? '?' + form(params) : ''), { method: 'POST', headers: h, body: form(body) }).then(function (r) {
            if (!r.ok) throw new Error('youtube ' + path.split('/').pop() + ' ' + r.status);
            return r.text();
        });
    }
    function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
    function remoteId() {                                                 // this TV's "phone": one id, kept
        var id = '';
        try { id = localStorage.getItem(IK) || ''; } catch (e) { /* silent */ }
        if (!id) { id = 'settle' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); try { localStorage.setItem(IK, id); } catch (e) { /* silent */ } }
        return id;
    }
    // The id set in config.local.js wins: the TV's DIAL service refuses requests made on the TV itself (401 from
    // 127.0.0.1, seen on the QN70F), so on such a TV the id can only be read once from a computer on the network.
    function savedScreen() {
        var cfg = (C.youtube && C.youtube.screenId) || '';
        if (cfg) return cfg;
        try { return localStorage.getItem(SK) || ''; } catch (e) { return ''; }
    }
    function saveScreen(id) { try { if (id) localStorage.setItem(SK, id); else localStorage.removeItem(SK); } catch (e) { /* silent */ } }

    // The screen id from DIAL, asked every 1.5 s while YouTube starts (up to 15 s).
    function discover() {
        if (!window.Vetro || !window.Vetro.youtubeScreen) return Promise.reject(new Error('no screen id: needs Vetro, or youtube.screenId in config.local.js'));
        var until = Date.now() + 15000;
        function again() {
            return window.Vetro.youtubeScreen().catch(function (e) {
                if (Date.now() > until) throw e;
                return wait(1500).then(again);
            });
        }
        return again().then(function (id) { saveScreen(id); return id; });
    }
    function token(screen) {
        return post('pairing/get_lounge_token_batch', null, { screen_ids: screen }).then(function (t) {
            var j = JSON.parse(t), s = j && j.screens && j.screens[0];
            if (!s || !s.loungeToken) throw new Error('no lounge token');
            return s.loungeToken;
        });
    }
    // Joins the screen's session the way pyytlounge's connect() does. The reply is "<length>\n<json>" chunks of
    // [eventId, [type, ...args]]: "c" carries the SID, "S" the gsessionid, and the last event id becomes AID.
    function bind(tok) {
        return post('bc/bind', { RID: 1, VER: 8, CVER: 1, auth_failure_option: 'send_error' }, {
            app: 'web', 'mdx-version': 3, name: 'Settle', id: remoteId(), device: 'REMOTE_CONTROL', capabilities: 'que,dsdtr,atp,vsp',
            magnaKey: 'cloudPairedDevice', ui: 'false', theme: 'cl', loungeIdToken: tok,
            deviceContext: 'user_agent=dunno&window_width_points=&window_height_points=&os_name=android&ms='
        }, tok).then(function (t) {
            var sid = /"c","(.*?)","/.exec(t), gs = /"S","(.*?)"]/.exec(t), ids = t.match(/\[(\d+),\["/g) || [];
            if (!sid || !gs) throw new Error('bind: no session');
            var aid = ids.length ? +/\d+/.exec(ids[ids.length - 1])[0] : 0;
            return { sid: sid[1], gs: gs[1], aid: aid, screen: t.indexOf('LOUNGE_SCREEN') >= 0 };
        });
    }
    // Cues the video. The TV's YouTube does not always list itself in the session it joined, so Settle does not wait
    // for it (a wait that never ended was why the trailer only opened YouTube): it gives a just-launched YouTube up to
    // 4 s to show up, then sends the command anyway, as pyytlounge does once it has a session.
    function cue(tok, video) {
        var start = Date.now();
        function again() {
            return bind(tok).then(function (s) {
                if (!s.screen && Date.now() - start < 4000) return wait(1000).then(again);
                // The command's own name is req0__sc (its key starts with "_"); every parameter is req0_<name>, ONE
                // underscore (pyytlounge _command). ofs counts commands; AID is the last event id seen.
                return post('bc/bind', {
                    name: 'Settle', loungeIdToken: tok, SID: s.sid, AID: s.aid, gsessionid: s.gs, device: 'REMOTE_CONTROL',
                    app: 'youtube-desktop', VER: 8, v: 2, RID: 2
                }, { count: 1, ofs: 1, req0__sc: 'setPlaylist', req0_videoId: video }, tok);
            });
        }
        return again();
    }

    // Plays `video` (a YouTube id) in the YouTube app. Resolves 'cued', or 'opened' when only the app could be opened.
    function play(video, title) {
        var app = P.providerApp('YouTube');
        if (!app) return Promise.reject(new Error('YouTube is not installed'));
        if (busy) return Promise.resolve('busy');
        busy = true;
        var screen = savedScreen();
        P.launch(app.id);                                                    // YouTube takes the screen meanwhile
        var tok = (screen ? token(screen).catch(function () { saveScreen(''); return null; }) : Promise.resolve(null)).then(function (t) {
            return t || discover().then(token);                              // no id yet, or a stale one: ask DIAL
        });
        return tok.then(function (t) { return cue(t, video); }).then(function () {
            P.note('trailer', video, 'cued in YouTube');
            busy = false;
            return 'cued';
        }, function (e) {
            P.note('trailer', video, (e && e.message) || String(e));
            pending = 'Couldn’t cue the ' + (title ? title + ' ' : '') + 'trailer, so YouTube just opened. (' + ((e && e.message) || 'error') + ')';
            busy = false;
            return 'opened';
        });
    }

    // Back in Settle after a cue that did not work: say so once.
    (window.onWake = window.onWake || []).push(function () {
        if (!pending || !window.Settle) return;
        var m = pending; pending = '';
        setTimeout(function () { window.Settle.toast(m); }, 600);
    });

    window.YouTubeCast = { play: play, forget: function () { saveScreen(''); } };
})();
