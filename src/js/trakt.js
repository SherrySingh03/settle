/*
 * Trakt: OAuth device-code login (nothing to type on a D-pad), recommendations, watchlist.
 *
 * Login: POST /oauth/device/code -> show user_code; the user approves on a phone at
 * trakt.tv/activate; we poll /oauth/device/token at Trakt's interval ONLY while the code screen
 * is open (cancelled by Back, expiry, or the app being hidden). Tokens persist in localStorage and
 * are refreshed a day before expiry. If a refresh is refused the tokens are dropped and the
 * rail offers "Connect Trakt" again. Disabled (and invisible) without a client id. The client
 * secret is optional: apps registered for PKCE have none, and the device flow accepts that.
 */
(function () {
    'use strict';

    var C = window.LAUNCHER_CONFIG, K = C.keys || {}, ID = K.traktClientId, SEC = K.traktClientSecret;
    var API = 'https://api.trakt.tv', TK = 'settle.trakt.v1', OOB = 'urn:ietf:wg:oauth:2.0:oob';
    var enabled = !!ID, flow = null;                       // PKCE-style app: no client secret needed; used only if you have one

    function tok() { try { return JSON.parse(localStorage.getItem(TK)); } catch (e) { return null; } }
    function setTok(t) { try { localStorage.setItem(TK, JSON.stringify(t)); } catch (e) { /* silent */ } }
    function connected() { return enabled && !!tok(); }
    function disconnect() { try { localStorage.removeItem(TK); } catch (e) { /* silent */ } }

    function withSecret(o) { if (SEC) o.client_secret = SEC; return o; }

    function hdr(token) {
        var h = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': ID };
        if (token) h.Authorization = 'Bearer ' + token;
        return h;
    }
    function post(path, body, token) {
        return fetch(API + path, { method: 'POST', headers: hdr(token), body: JSON.stringify(body) });
    }

    /* ----- token lifecycle ----- */
    function refresh(t) {
        return post('/oauth/token', withSecret({ refresh_token: t.refresh_token, client_id: ID, redirect_uri: OOB, grant_type: 'refresh_token' }))
            .then(function (r) {
                if (r.status === 400 || r.status === 401) { disconnect(); throw new Error('revoked'); }   // back to "Connect Trakt"
                if (!r.ok) throw new Error('refresh');
                return r.json();
            })
            .then(function (j) { setTok(j); return j.access_token; });
    }
    function token() {
        var t = tok();
        if (!enabled || !t) return Promise.reject(new Error('auth'));
        return Date.now() < (t.created_at + t.expires_in) * 1000 - 86400000 ? Promise.resolve(t.access_token) : refresh(t);
    }
    function api(method, path, body) {
        return token().then(function (tk) {
            return fetch(API + path, { method: method, headers: hdr(tk), body: body ? JSON.stringify(body) : undefined });
        }).then(function (r) {
            if (r.status === 401) { disconnect(); throw new Error('unauthorised'); }
            if (!r.ok) throw new Error('trakt ' + r.status);
            return r.status === 204 ? null : r.json();
        });
    }

    /* ----- data ----- */
    function recommendations() { return api('GET', '/recommendations/movies?limit=60&ignore_collected=true'); }
    // tmdb ids on your watchlist, most recently added first
    function watchlist() {
        return api('GET', '/sync/watchlist/movies/added/desc').then(function (list) {
            return (list || []).map(function (e) { return e.movie && e.movie.ids && e.movie.ids.tmdb; }).filter(Boolean);
        });
    }

    // Resolves immediately when not connected (the app keeps the state locally); rejects on failure so the UI reverts.
    // tmdb ids of every film you have watched (one request per rail refresh), so none of them is offered again
    function watchedIds() {
        return api('GET', '/sync/watched/movies').then(function (list) {
            return (list || []).map(function (e) { return e.movie && e.movie.ids && e.movie.ids.tmdb; }).filter(Boolean);
        });
    }

    function setWatchlist(rec, on) {
        if (!connected() || !rec.tmdb) return Promise.resolve();
        return api('POST', on ? '/sync/watchlist' : '/sync/watchlist/remove', { movies: [{ ids: { tmdb: rec.tmdb } }] });
    }

    // Logs a watch (now) and, if given, a 1-10 rating. Trakt takes a watched title off your watchlist by itself.
    // Rejects on any failure so the UI can put the title back.
    function markWatched(rec, rating, fav) {
        if (!connected() || !rec.tmdb) return Promise.reject(new Error('auth'));
        var ids = { tmdb: rec.tmdb };
        return api('POST', '/sync/history', { movies: [{ ids: ids, watched_at: new Date().toISOString() }] }).then(function () {
            return api('POST', '/sync/watchlist/remove', { movies: [{ ids: ids }] }).catch(function () { /* best effort: Trakt usually does this itself */ });
        }).then(function () {
            if (!rating) return null;
            return api('POST', '/sync/ratings', { movies: [{ ids: ids, rating: rating }] });
        }).then(function () {
            // Favorites uses the same body as the watchlist. A refusal (it may need Trakt VIP) must not undo the watch: report it instead.
            if (!fav) return null;
            return api('POST', '/sync/favorites', { movies: [{ ids: ids }] }).then(function () { return null; }, function () { return 'fav'; });
        });
    }

    // "Not interested": hides the film from Trakt's recommendations for good (DELETE /recommendations/movies/{id}, 204).
    // That call takes a Trakt id; one the rail did not keep is looked up by tmdb id (GET /search/tmdb/{id}?type=movie).
    function hideRecommendation(rec) {
        if (!connected() || !rec.tmdb) return Promise.reject(new Error('auth'));
        var id = rec.trakt ? Promise.resolve(rec.trakt) : api('GET', '/search/tmdb/' + rec.tmdb + '?type=movie').then(function (l) {
            var m = (l || []).filter(function (x) { return x.movie && x.movie.ids && x.movie.ids.tmdb === rec.tmdb; })[0];
            if (!m) throw new Error('not on Trakt');
            return m.movie.ids.trakt;
        });
        return id.then(function (t) { return api('DELETE', '/recommendations/movies/' + t); });
    }

    /* ----- device-code login ----- */
    function cancel() { if (flow) { flow.stop = true; clearTimeout(flow.t); flow = null; } }

    // ui: { code(userCode, url), status(text), done() }
    function start(ui) {
        cancel();
        if (!enabled) return ui.status('Trakt is not configured.');
        ui.status('Contacting Trakt…');
        post('/oauth/device/code', { client_id: ID }).then(function (r) {
            if (!r.ok) throw new Error('code');
            return r.json();
        }).then(function (d) {
            var f = flow = { d: d, ui: ui, stop: false, t: 0, interval: (d.interval || 5) * 1000, expires: Date.now() + d.expires_in * 1000 };
            ui.code(d.user_code, (d.verification_url || 'https://trakt.tv/activate').replace(/^https?:\/\//, ''));
            ui.status('Waiting for approval…');
            poll(f, ui);
        }).catch(function () { ui.status('Could not reach Trakt. Press Back and try again.'); });
    }

    function poll(f, ui, first) {
        if (f.stop) return;
        f.t = setTimeout(function () {
            if (f.stop) return;
            if (Date.now() > f.expires) { flow = null; return ui.status('The code expired. Press Back and try again.'); }
            post('/oauth/device/token', withSecret({ code: f.d.device_code, client_id: ID })).then(function (r) {
                if (f.stop) return;
                if (r.status === 200) return r.json().then(function (j) { setTok(j); flow = null; ui.done(); });
                if (r.status === 429) f.interval += 5000;                      // asked to slow down
                if (r.status === 400 || r.status === 429) return poll(f, ui);  // still pending
                flow = null;
                ui.status(r.status === 418 ? 'Approval was declined.' : 'The code is no longer valid. Press Back and try again.');
            }).catch(function () { poll(f, ui); });                             // transient network error: keep trying until expiry
        }, first || f.interval);
    }

    // Hidden: clear the poll timer (nothing runs in the background). Visible again: resume the same
    // code, so approving in another tab or app does not lose the login.
    document.addEventListener('visibilitychange', function () {
        if (!flow || flow.stop) return;
        clearTimeout(flow.t);
        if (!document.hidden) poll(flow, flow.ui, 800);
    });

    window.Trakt = { enabled: enabled, connected: connected, disconnect: disconnect, start: start, cancel: cancel,
        recommendations: recommendations, watchlist: watchlist, setWatchlist: setWatchlist, markWatched: markWatched, watchedIds: watchedIds, hideRecommendation: hideRecommendation };
})();
