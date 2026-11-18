/* One-line notice, top right. One-shot timer, no polling. */
var toastT = 0;
function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.style.opacity = 1; t.style.transform = 'none';
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.style.opacity = 0; t.style.transform = ''; }, 5000);
}

/* Trakt device-code screen */
function closeTrakt() {
    $('trakt').classList.remove('open');
    $('t-code').textContent = '';
}
function openTrakt() {
    S.zone = 'trk';
    clearTimeout(idleT);                                          // the user is on their phone; do not drop to Rest
    $('t-url').textContent = '';
    $('t-code').textContent = '';
    $('trakt').classList.add('open');
    window.Trakt.start({
        code: function (c, url) { $('t-code').textContent = c; $('t-url').textContent = url; },
        status: function (s) { $('t-status').textContent = s; },
        done: function () {
            closeTrakt();
            S.zone = 'dock'; armIdle();
            toast('Trakt connected. Loading your picks…');
            if (window.Recs) window.Recs.refresh(true);           // rebuild the rail from Trakt's picks
            if (window.Recs) { var c = window.Recs.cached(); if (!c) applyRecs(lastFilms.filter(function (r) { return !r.connect; })); }
            paint();
        }
    });
}
function trkKey(d) {
    if (d !== 'B') return;
    window.Trakt.cancel();
    closeTrakt();
    S.zone = 'rail'; armIdle();
    paint();
}
