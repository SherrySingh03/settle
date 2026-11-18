/* Sources screen */
/* Samsung's own home screen. The TV can accept a launch and still show nothing (a home component that is not the
   home itself), so "accepted" is not enough: each candidate in config.samsungHome is tried until Settle actually
   loses the screen (hidden, or focus taken by an overlay) within 1.5 s. Then Vetro's app_launcher for the first
   one. Every miss is noted for Diagnostics; if nothing works the notice lists what was tried. */
var homeTrying = false;
function openSamsungHome() {
    if (homeTrying) return;
    var ids = (C.samsungHome || []).slice(), tried = [];
    if (!ids.length) { toast('No Samsung Home app is configured'); return; }
    homeTrying = true;
    function gone() { return document.hidden || (document.hasFocus && !document.hasFocus()); }
    function done(ok) {
        homeTrying = false;
        if (ok) return;
        returnFx();
        toast('Samsung Home did not open. Tried: ' + tried.join(', '));
    }
    function check(id, next) {
        setTimeout(function () {
            if (gone()) return done(true);
            P.note('home', id, 'accepted, but nothing took the screen');
            next();
        }, 1500);
    }
    function attempt(k) {
        clearTimeout(fxUndo);                                     // the launch overlay stays while candidates are tried
        if (k >= ids.length) {
            if (!window.Vetro || !window.Vetro.launchApp) return done(false);
            tried.push('Vetro ' + ids[0]);
            return window.Vetro.launchApp(ids[0]).then(function () { check('vetro ' + ids[0], function () { done(false); }); }, function () { done(false); });
        }
        var id = ids[k];
        tried.push(id.replace('com.samsung.tv.', ''));
        P.tryLaunch(id).then(function () { check(id, function () { attempt(k + 1); }); }, function () { attempt(k + 1); });
    }
    launchFx(function () { attempt(0); });
}

function openSources() {
    S.zone = 'src'; S.si = 0;
    $('sources').classList.add('open');
    P.sources().then(function (list) {
        srcList = list;
        var box = $('s-list');
        box.textContent = ''; srcRows = [];
        list.forEach(function (s) {
            var r = h('div', 'srow');
            r.appendChild(h('span', null, s.label));
            r.appendChild(h('span', null, s.on ? 'Connected' : 'No signal'));
            box.appendChild(r); srcRows.push(r);
        });
        if (!list.length) box.appendChild(h('div', 'srow', 'No inputs reported'));
        setOn('s', srcRows[0] || null);
    });
}
function closeSources() {
    $('sources').classList.remove('open');
    setOn('s', null);
    S.zone = 'dock';
    paint();
}
function srcKey(d) {
    if (d === 'B') return closeSources();
    if (d === 'U' && S.si > 0) S.si--;
    else if (d === 'D' && S.si < srcRows.length - 1) S.si++;
    else if (d === 'OK' && srcList[S.si]) P.openSource(srcList[S.si]);
    setOn('s', srcRows[S.si] || null);
}
