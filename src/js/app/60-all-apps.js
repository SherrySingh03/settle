/* All apps: every installed app, A-Z, 6 columns. Icons are decoded for the visible rows plus one ahead only. */
var COLS = 6, ROWS = 3, ROW_PITCH = 284;
var aItems = [], aCells = [], aSel = 0, aTop = 0, aLoaded = {};

function appsLoad(fromRow, toRow) {
    for (var r = fromRow; r <= toRow; r++) {
        for (var c = 0; c < COLS; c++) {
            var i = r * COLS + c;
            if (i >= aItems.length || aLoaded[i]) continue;
            aLoaded[i] = 1;
            paintTile(aCells[i].firstChild, aItems[i]);
        }
    }
}

function appsPaint() {
    var row = Math.floor(aSel / COLS), grid = $('a-grid'), cell = aCells[aSel];
    if (row < aTop) aTop = row; else if (row > aTop + ROWS - 1) aTop = row - ROWS + 1;       // whole rows, focused tile always in view
    grid.style.transform = 'translateY(' + (24 - aTop * ROW_PITCH) + 'px)';
    appsLoad(aTop, aTop + ROWS);                                                               // the visible rows + one ahead
    setOn('ap', cell);
}

function markDock() {                                           // a number on every app that is on the dock
    var ids = P.dockIds();
    aCells.forEach(function (c, i) {
        var pos = ids.indexOf(aItems[i].id);
        if (pos >= 0) { c.classList.add('indock'); c.setAttribute('data-pos', pos + 1); }
        else { c.classList.remove('indock'); c.removeAttribute('data-pos'); }
    });
}

function buildAppsGrid(sel) {
    aItems = mockIcons(P.allInstalled());
    var grid = $('a-grid');
    grid.textContent = ''; aCells = []; aLoaded = {};
    aItems.forEach(function (it, i) {
        var c = h('div', 'cell acell'), t = h('div', 'tile atile');
        c.style.setProperty('--r', Math.min(Math.floor(i / COLS), 3));          // rows rise in 25 ms apart
        c.appendChild(t);
        c.appendChild(h('div', 'albl', it.label));
        grid.appendChild(c); aCells.push(c);
    });
    aSel = Math.max(0, Math.min(sel, aItems.length - 1));
    markDock();
}
function rebuildApps() { buildAppsGrid(aSel); if (aCells.length) appsPaint(); }

function openApps() {
    aTop = 0;
    buildAppsGrid(0);
    S.zone = 'apps';
    $('apps').classList.add('open');
    paint();
    if (aCells.length) appsPaint();
    // Drawn at once from what we know; the TV is asked again, and a newly installed app joins the grid in place
    // (focus stays on the same app).
    P.refresh().then(function (changed) {
        if (!changed || S.zone !== 'apps') return;
        var keep = aItems[aSel] && aItems[aSel].id;
        buildAppsGrid(0);
        var i = keep ? aItems.map(function (x) { return x.id; }).indexOf(keep) : 0;
        aSel = i < 0 ? 0 : i;
        if (aCells.length) appsPaint();
    });
}

function teardownApps() {
    $('apps').classList.remove('open');
    setOn('ap', null);
    $('a-grid').textContent = ''; aCells = []; aLoaded = {};
}

function closeApps() {                                          // back to the dock, focus on the Apps tile (S.di is untouched)
    teardownApps();
    S.zone = 'dock';
    paint();
}

function appsKey(d) {
    var n = aItems.length, col = aSel % COLS, row = Math.floor(aSel / COLS), rows = Math.ceil(n / COLS);
    if (d === 'B') return closeApps();
    if (!n) return;
    if (d === 'L') { if (col > 0) aSel--; }                                     // no wrapping, no bump: focus simply stays
    else if (d === 'R') { if (col < COLS - 1 && aSel < n - 1) aSel++; }
    else if (d === 'U') { if (row > 0) aSel -= COLS; }
    else if (d === 'D') { if (row < rows - 1) aSel = Math.min(aSel + COLS, n - 1); }   // into a short last row: its last tile
    else if (d === 'OK') { return; }                                           // launches on key release (a long press opens the options)
    appsPaint();
}
