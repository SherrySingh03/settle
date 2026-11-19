/* ---------- boot ---------- */

a1.innerHTML = PLAY + '<span></span>';
a2.innerHTML = PLUS + CHECK + '<span></span>';
a3.innerHTML = EYE + '<span>Mark as watched</span>';
a4.innerHTML = NOPE + '<span>Not interested</span>';
a5.innerHTML = INFO + '<span>Details, cast and more like this</span>';
$('dt-open').innerHTML = PLAY + '<span></span>';
$('dt-alt').innerHTML = '<span></span>';
$('dt-wl').innerHTML = PLUS + CHECK + '<span></span>';
$('dt-tr').innerHTML = '<svg width="26" height="24" viewBox="0 0 26 24" aria-hidden="true"><rect x="2" y="4" width="22" height="16" rx="4"/><path d="M11 9 L16 12 L11 15 Z" fill="currentColor"/></svg><span>Trailer</span>';
stage.classList.add('no-wx');
$('wx-rest').innerHTML = '<span></span><span></span>';
$('wx-full').innerHTML = '<span style="display:flex"></span><span></span>';
$('act-line').innerHTML = '<span id="al-d"></span><b class="dot"></b><span id="al-i" style="display:flex"></span><span id="al-w"></span>';

var haveKey = window.Recs && window.Recs.hasKey;
lastShows = (window.Recs && window.Recs.shows && window.Recs.shows()) || [];
applyRecs((window.Recs && window.Recs.cached()) || (!haveKey && MOCK && MOCK.recs) || []);    // both rows, from cache: no network
tick();
setWeather(wxText, wxShort, wxKind);
paint();

// The live app list replacing the cache (or the favourites): applied at once unless the user is rearranging the dock
// or browsing All apps, in which case it waits for Rest.
var dockPending = false;
function appsChanged() {
    if (['move', 'apps', 'sheet'].indexOf(S.zone) >= 0) { dockPending = true; return; }
    applyDock(); paint();
}
(window.onRest = window.onRest || []).push(function () { if (dockPending) { dockPending = false; applyDock(); paint(); } });
P.apps(C, appsChanged).then(function () {
    applyDock();
    paint();
});
armIdle();

window.Settle = { ask: function (o, yes) { closeCC(); openAsk(o, yes); }, openDiag: function () { closeCC(); openDiag(); }, setPerf: setPerf, askPerf: askPerf, setShows: setShows, openSwitcher: function () { closeCC(); openSwitcher(); }, recsFailed: function () { railEmpty(true); }, state: S, recs: function () { return recs; }, rows: function () { return [rows[0].list, rows[1].list, rows[2].list, rows[3].list]; }, upNext: function () { return upNext; }, setUpNext: unApply, refreshUpNext: unRefresh, setWeather: setWeather, setRecs: setRecs, toast: toast };
