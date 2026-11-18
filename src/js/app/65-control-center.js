/* Control Center: an overlay zone. Opening remembers the zone we came from; closing returns to it, so every
   focus index (dock tile, poster, hero button, grid tile) is exactly where it was. */
var cc = null, ccReturn = null;
function openCC() {
    if (!window.Vetro) return;
    if (!window.ControlCenter) { need(['js/controlcenter.js', 'js/launcher-controls.js'], function () { if (window.ControlCenter) openCC(); }); return; }
    if (!cc) cc = window.ControlCenter.create($('cc'), window.LauncherControls ? window.LauncherControls.compose(window.Vetro.adapter) : window.Vetro.adapter, {
        requestClose: closeCC, afterAction: closeCC,
        backdrop: function () {                                  // the wallpaper behind the panel (already decoded: baking costs one tiny canvas draw)
            var host = $('cc'), p = host.firstChild;
            return { source: $('wall'), stageWidth: 1920, rect: { x: host.offsetLeft, y: host.offsetTop, w: p ? p.offsetWidth : 784, h: p ? p.offsetHeight : 780 } };
        }
    });
    ccReturn = S.zone;
    clearTimeout(holdT); setPressing(null); okHold = null;
    S.zone = 'cc';
    stage.classList.add('cc-open');
    cc.open();
}
function closeCC() {
    if (S.zone !== 'cc') return;
    cc.close();
    stage.classList.remove('cc-open');
    S.zone = ccReturn;
    if (S.zone !== null) armIdle();
    paint();
}
