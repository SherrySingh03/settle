/* App profiles: what the TV does when you open a particular app from Settle, undone when you come back.
     picture  a picture mode code (only the TV's confirmed modes, config.controlCenter.pictureModes), or null: leave it
     perf     true: Performance mode while the app is open
     close    true: close the other open apps first (more memory for this one)
   Set from All apps: hold OK on an app (or the blue key) -> App profile…  Kept on this TV.
   Settle only sees apps it opens itself, so a profile applies when the app is opened from the dock, All apps, search
   or the switcher (not from a title on a rail, and not when you jump from one app straight to another). On the way back to Settle the previous
   picture mode and Performance mode come back (Performance mode stays on when you chose it in the Control Center). */
var PROF_KEY = 'settle.profiles.v1', PROF_UNDO = 'settle.profile.undo.v1';
function profiles() { try { return JSON.parse(localStorage.getItem(PROF_KEY)) || {}; } catch (e) { return {}; } }
function profileOf(id) { var p = profiles()[id]; return p && (p.picture != null || p.perf || p.close) ? p : null; }
function saveProfile(id, p) {
    var all = profiles();
    if (p && (p.picture != null || p.perf || p.close)) all[id] = p; else delete all[id];
    try { localStorage.setItem(PROF_KEY, JSON.stringify(all)); } catch (e) { /* silent */ }
}
function profUndo(v) {
    try { if (v === undefined) return JSON.parse(localStorage.getItem(PROF_UNDO)); if (v) localStorage.setItem(PROF_UNDO, JSON.stringify(v)); else localStorage.removeItem(PROF_UNDO); } catch (e) { return null; }
}
function pictureModes() { var V = window.Vetro; return V && V.adapter ? V.adapter.options('p.mode') : []; }

// Before the app opens: note what to put back, then change it. Best effort; the launch never waits for it.
function applyProfile(id) {
    var p = profileOf(id), V = window.Vetro;
    if (!p || !V || !V.adapter) return;
    var A = V.adapter, undo = profUndo() || {}, first = !undo.app;
    undo.app = id;
    var read = A.read().catch(function () { return {}; }), gov = V.perfState ? V.perfState().catch(function () { return 'unknown'; }) : Promise.resolve('unknown');
    Promise.all([read, gov]).then(function (x) {
        var st = x[0] || {}, cur = st['p.mode'] && st['p.mode'].current;
        if (first) { undo.picture = cur != null ? cur : null; undo.perf = x[1]; }        // the state before the first profiled app
        profUndo(undo);
        var steps = [];
        if (p.picture != null && String(p.picture) !== String(cur)) steps.push(A.act('p.mode', p.picture));
        if (p.perf && x[1] !== 'on') steps.push(V.perf(true));
        return Promise.all(steps.map(function (s) { return s.catch(function (e) { console.warn('[profile]', e); }); }));
    });
    if (p.close) P.running().then(function (list) {
        list.forEach(function (x) { if (x.it.id !== id) P.kill(x.ctx, x.it.id).catch(function () { /* stays open */ }); });
    }).catch(function () { /* no list: nothing closed */ });
}
// Back at Settle: put the picture mode and Performance mode back as they were.
function undoProfile() {
    var u = profUndo(), V = window.Vetro;
    if (!u || !u.app || !V || !V.adapter) return;
    profUndo(null);
    if (u.picture != null) V.adapter.act('p.mode', u.picture).catch(function () { /* the TV keeps the app's mode */ });
    if (u.perf === 'off' && !perfChosen()) V.perf(false).catch(function () { /* stays on; the tile shows it */ });
}
(window.onWake = window.onWake || []).push(undoProfile);
(function () {
    var raw = P.launch;
    P.launch = function (id, onFail) {
        if (!id) return raw(id, onFail);
        applyProfile(id);
        return raw(id, function (e) { undoProfile(); if (onFail) onFail(e); });     // didn't open: put things back now
    };
})();

/* The editor: three choices and Save, in the confirmation dialog's frame. Up/Down move, Left/Right change a choice. */
function openProfile(it) {
    var p = profiles()[it.id] || {}, modes = pictureModes();
    var pic = [{ id: null, label: 'Leave as it is' }].concat(modes.map(function (m) { return { id: Number(m.id), label: m.label }; }));
    var fields = [
        { label: 'Picture mode', opts: pic, i: Math.max(0, pic.map(function (o) { return String(o.id); }).indexOf(String(p.picture))) },
        { label: 'Performance mode', opts: [{ id: false, label: 'Leave as it is' }, { id: true, label: 'On' }], i: p.perf ? 1 : 0 },
        { label: 'Close other apps first', opts: [{ id: false, label: 'No' }, { id: true, label: 'Yes' }], i: p.close ? 1 : 0 }
    ];
    if (!modes.length) fields.shift();                                // no Vetro picture modes known: that choice is left out
    openForm({ title: it.label + ' profile', fields: fields, note: 'When you open ' + it.label + ' from Settle. Back at Settle, the picture and Performance mode go back to how they were.', yes: 'Save', no: 'Cancel' }, function (vals) {
        var np = { picture: null, perf: false, close: false };
        fields.forEach(function (f, k) {
            var v = f.opts[vals[k]].id;
            if (f.label === 'Picture mode') np.picture = v; else if (f.label === 'Performance mode') np.perf = v; else np.close = v;
        });
        saveProfile(it.id, np);
        toast(profileOf(it.id) ? it.label + ' profile saved.' : it.label + ' has no profile now.');
    });
}
