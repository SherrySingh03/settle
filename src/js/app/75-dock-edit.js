/* Move mode: hold OK on a dock app, then Left / Right to reposition it */
var moveFrom = 0;
function startMove() {
    moveFrom = S.di; S.zone = 'move'; clearTimeout(idleT);
    toast('Left / Right to move · OK to place · Back to cancel');
    paint();
}
function swapDock(i, j) {
    var t = dockItems[i]; dockItems[i] = dockItems[j]; dockItems[j] = t;
    var c = dCells[i]; dCells[i] = dCells[j]; dCells[j] = c;
    dCells.forEach(function (x) { dock.appendChild(x); });      // re-seat the tiles in their new order; the glass pill stays first
}
function moveKey(d) {
    var n = dockItems.length;
    if (d === 'L' && S.di > 0) { swapDock(S.di, S.di - 1); S.di--; }
    else if (d === 'R' && S.di < n - 1) { swapDock(S.di, S.di + 1); S.di++; }
    else if (d === 'OK') { P.setDock(dockItems.map(function (x) { return x.id; })); S.zone = 'dock'; armIdle(); toast('Dock saved.'); }
    else if (d === 'B') { applyDock(); S.di = moveFrom; S.zone = 'dock'; armIdle(); }          // put everything back
    paint();
}

/* Options for an app in All apps: add to the dock, replace one, or remove it. The dock holds P.maxApps. */
var shIt = null, shMode = 'menu', shSel = 0, shRows = [], shOpts = [];

function sheetPaint() {
    var ids = P.dockIds(), on = ids.indexOf(shIt.id) >= 0, full = ids.length >= P.maxApps, list = $('sh-list');
    list.textContent = ''; shRows = []; shOpts = [];
    if (shMode === 'menu') {
        $('sh-title').textContent = shIt.label;
        $('sh-sub').textContent = 'Dock ' + ids.length + ' of ' + P.maxApps + (on ? ' · on your dock at position ' + (ids.indexOf(shIt.id) + 1) : (full ? ' · full' : ''));
        shOpts.push({ t: 'Open', k: 'open' });
        if (!on && !full) shOpts.push({ t: 'Add to dock', k: 'add' });
        if (!on) shOpts.push({ t: 'Replace an app on the dock…', k: 'pick' });
        if (on && ids.length > 1) shOpts.push({ t: 'Remove from dock', k: 'remove' });
        shOpts.push({ t: 'Hide from All apps', k: 'hide' });
        shOpts.push({ t: 'App info', k: 'info' });
        if (window.Vetro && window.Vetro.uninstall && P.canUninstall(shIt.id)) shOpts.push({ t: 'Uninstall…', k: 'uninstall' });
        if (P.hiddenCount() > 0) shOpts.push({ t: 'Show hidden apps (' + P.hiddenCount() + ')', k: 'unhide' });
        if (P.hasSavedDock()) shOpts.push({ t: 'Reset the dock to the default apps', k: 'reset' });
        shOpts.push({ t: 'Cancel', k: 'cancel' });
    } else if (shMode === 'confirm') {                           // uninstalling cannot be undone: asked once more
        $('sh-title').textContent = 'Uninstall ' + shIt.label + '?';
        $('sh-sub').textContent = 'It is deleted from the TV with its data and sign-in. This can’t be undone.';
        shOpts.push({ t: 'Uninstall ' + shIt.label, k: 'unok' });
        shOpts.push({ t: 'Cancel', k: 'cancel' });
    } else if (shMode === 'info') {
        var inf = P.appInfo(shIt.id) || {};
        $('sh-title').textContent = shIt.label;
        $('sh-sub').textContent = 'App details';
        [['App ID', shIt.id], ['Package', inf.pkg || shIt.pkg || 'n/a'], ['Version', inf.version || 'n/a'],
         ['On the dock', on ? 'Position ' + (ids.indexOf(shIt.id) + 1) : 'No'],
         ['Icon', (window.Icons && window.Icons.status[shIt.id]) || (shIt.icon ? 'not loaded' : 'none')]]
            .forEach(function (l) { shOpts.push({ t: l[0], k: 'line', r: l[1] }); });
    } else {
        $('sh-title').textContent = 'Replace which app?';
        $('sh-sub').textContent = 'It will be swapped for ' + shIt.label + ', in the same spot.';
        dockItems.forEach(function (d, i) { shOpts.push({ t: d.label, k: 'swap', i: i, r: 'Position ' + (i + 1) }); });
    }
    shOpts.forEach(function (o) {
        var r = h('div', 'erow');
        r.appendChild(h('span', null, o.t));
        if (o.r) r.appendChild(h('span', 'off', o.r));
        list.appendChild(r); shRows.push(r);
    });
    shSel = Math.max(0, Math.min(shSel, shRows.length - 1));
    setOn('sh', shRows[shSel]);
}
function openSheet(it) {
    shIt = it; shMode = 'menu'; shSel = 0; S.zone = 'sheet';
    $('sheet').classList.add('open');
    sheetPaint();
}
function closeSheet() {
    $('sheet').classList.remove('open');
    setOn('sh', null);
    S.zone = 'apps';
    paint();
}
function commitDock(ids, msg) {                                 // save, rebuild the dock behind the screen, keep the grid's focus bar
    P.setDock(ids);
    applyDock();
    S.di = dockItems.length;                                    // the Apps tile has moved if the dock grew or shrank
    closeSheet();
    markDock();
    if (aCells.length) appsPaint();
    toast(msg);
}
function sheetKey(d) {
    var o = shOpts[shSel], ids = P.dockIds();
    if (d === 'B') { if (shMode !== 'menu') { shMode = 'menu'; shSel = 0; return sheetPaint(); } return closeSheet(); }
    if (d === 'U') { if (shSel > 0) shSel--; }
    else if (d === 'D') { if (shSel < shRows.length - 1) shSel++; }
    else if (d === 'OK' && o) {
        if (o.k === 'cancel') return closeSheet();
        if (o.k === 'line') return;
        if (o.k === 'open') { P.launch(shIt.id); return closeSheet(); }
        if (o.k === 'info') { shMode = 'info'; shSel = 0; return sheetPaint(); }
        if (o.k === 'uninstall') { shMode = 'confirm'; shSel = 1; return sheetPaint(); }      // Cancel is focused first
        if (o.k === 'unok') { var it = shIt; closeSheet(); return uninstallApp(it); }
        if (o.k === 'hide') { P.hideApp(shIt.id); closeSheet(); rebuildApps(); return toast('Hidden from All apps.'); }
        if (o.k === 'unhide') { P.unhideAll(); closeSheet(); rebuildApps(); return toast('Hidden apps are back.'); }
        if (o.k === 'reset') return commitDock(null, 'Dock reset to the default apps.');
        if (o.k === 'pick') { shMode = 'pick'; shSel = 0; return sheetPaint(); }
        if (o.k === 'add') { if (ids.length >= P.maxApps) return toast('The dock is full: ' + P.maxApps + ' apps.'); ids.push(shIt.id); return commitDock(ids, 'Added ' + shIt.label + ' to the dock.'); }
        if (o.k === 'remove') { ids.splice(ids.indexOf(shIt.id), 1); return commitDock(ids, 'Removed ' + shIt.label + ' from the dock.'); }
        if (o.k === 'swap') { var was = dockItems[o.i].label; ids[o.i] = shIt.id; return commitDock(ids, 'Replaced ' + was + ' with ' + shIt.label + '.'); }
    }
    sheetPaint();
}

/* Uninstall through Vetro (a web app may not). Afterwards the TV's own app list decides: gone means done, and the app
   leaves the dock too; still there means the TV refused, and what it said is shown (and kept for Diagnostics). */
function uninstallApp(it) {
    var inf = P.appInfo(it.id) || {};
    toast('Uninstalling ' + it.label + '…');
    window.Vetro.uninstall(inf.pkg || it.pkg || it.id, it.id).then(function (res) {
        return P.refresh().then(function () {
            if (P.installedIds().indexOf(it.id) < 0) {
                var ids = P.dockIds(), k = ids.indexOf(it.id);
                if (k >= 0) { ids.splice(k, 1); P.setDock(ids.length ? ids : null); }
                applyDock();
                if (S.zone === 'apps') rebuildApps();
                toast(it.label + ' is uninstalled');
            } else {
                P.note('uninstall', it.id, res.output);
                toast('The TV kept ' + it.label + ': ' + (res.output.split(/\r?\n/).filter(Boolean).slice(-2).join(' · ') || 'no answer'));
            }
        });
    }, function (e) { toast('Couldn’t uninstall ' + it.label + ': ' + ((e && e.message) || e)); });
}

function mockIcons(list) {                                      // browser preview only: stand-in icon paths
    if (MOCK && MOCK.icons) list.forEach(function (x) { if (MOCK.icons[x.label] && !x.brandFirst) x.icon = MOCK.icons[x.label]; });
    return list;
}

function applyDock() {                                          // (re)build the dock from the saved layout
    dockItems = mockIcons(P.layout(C));
    if (window.Icons && P.source() === 'live') window.Icons.prune(P.installedIds());     // only a real list may drop cached icons
    buildDock();
    if (window.AppInfo) window.AppInfo.refresh(dockItems.map(function (x) { return x.label; }));
}
