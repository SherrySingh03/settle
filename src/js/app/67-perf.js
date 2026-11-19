/* A confirmation dialog: a title, a few lines saying what will happen, and two buttons with the safe one focused first.
     openAsk({ title, lines: [...], yes: 'Turn on', no: 'Cancel' }, onYes)
   Left / Right choose, OK confirms the focused button, Back cancels. */
var ASK = null;
function openAsk(o, onYes) {
    ASK = { yes: onYes, b: 1, from: S.zone === 'ask' ? 'dock' : S.zone };   // b: 0 = yes, 1 = no (focused first)
    $('ask-title').textContent = o.title;
    var body = $('ask-body');
    body.textContent = '';
    o.lines.forEach(function (l) { body.appendChild(h('li', null, l)); });
    $('ask-yes').textContent = o.yes; $('ask-no').textContent = o.no || 'Cancel';
    clearTimeout(holdT); setPressing(null); okHold = null;
    S.zone = 'ask'; armIdle();
    $('ask').classList.add('open');
    askPaint();
}
function askPaint() { setOn('ask', ASK.b === 0 ? $('ask-yes') : $('ask-no')); }
function closeAsk() {
    $('ask').classList.remove('open');
    setOn('ask', null);
    var from = ASK ? ASK.from : 'dock';
    ASK = null;
    S.zone = from === null || from === 'cc' ? 'dock' : from; armIdle(); paint();
}
function askKey(d) {
    if (ASK && ASK.form) return formKey(d);
    if (d === 'B') return closeAsk();
    if (d === 'L' || d === 'R') { ASK.b = d === 'L' ? 0 : 1; askPaint(); return; }
    if (d === 'OK') { var yes = ASK.b === 0 ? ASK.yes : null; closeAsk(); if (yes) yes(); }
}

/* A small form in the same frame: a few choices, then Save / Cancel.
     openForm({ title, fields: [{ label, opts: [{ id, label }], i }], note, yes, no }, onSave(indexes))
   Up / Down move between the choices and the buttons, Left / Right change a choice (or pick a button). */
function openForm(o, onSave) {
    openAsk({ title: o.title, lines: [], yes: o.yes, no: o.no }, null);
    ASK.form = o.fields; ASK.fi = 0; ASK.save = onSave; ASK.b = 0;
    var body = $('ask-body');
    ASK.rows = o.fields.map(function (f) {
        var li = h('li', 'fld'), v = h('span', 'fv');
        li.appendChild(h('span', 'fl', f.label)); li.appendChild(v);
        body.appendChild(li);
        return { li: li, v: v };
    });
    if (o.note) body.appendChild(h('li', 'fnote', o.note));
    formPaint();
}
function formPaint() {
    ASK.form.forEach(function (f, k) { ASK.rows[k].v.textContent = '‹  ' + f.opts[f.i].label + '  ›'; });
    var onRow = ASK.fi < ASK.form.length;
    setOn('ask', onRow ? ASK.rows[ASK.fi].li : (ASK.b === 0 ? $('ask-yes') : $('ask-no')));
}
function formKey(d) {
    var n = ASK.form.length, f = ASK.form[ASK.fi];
    if (d === 'B') return closeAsk();
    if (d === 'U') { if (ASK.fi > 0) ASK.fi--; }
    else if (d === 'D') { if (ASK.fi < n) ASK.fi++; }
    else if ((d === 'L' || d === 'R') && f) f.i = (f.i + (d === 'R' ? 1 : f.opts.length - 1)) % f.opts.length;
    else if (d === 'L' || d === 'R') ASK.b = d === 'L' ? 0 : 1;
    else if (d === 'OK') {
        if (f) { ASK.fi++; }                                           // OK on a choice moves on to the next
        else { var save = ASK.b === 0 ? ASK.save : null, vals = ASK.form.map(function (x) { return x.i; }); closeAsk(); if (save) save(vals); return; }
    }
    formPaint();
}

/* Performance mode: the CPU stays at its full 1.7 GHz instead of slowing down when it can (the 'performance' CPU
   governor, set through Vetro). Measured on this TV during game streaming: CPU waiting at the 95th percentile fell
   from 69% to 31%, the temperature rose about 2 °C over 8 minutes (61 -> 63 °C) and the thermal throttle values never
   changed. Turning it on is asked first; off is immediate. The TV resets it on a restart, so Settle re-applies it at
   startup while it is chosen (kept on this TV). */
var PERF_KEY = 'settle.perf.v1';
function perfChosen() { try { return localStorage.getItem(PERF_KEY) === 'on'; } catch (e) { return false; } }
function setPerf(on) {
    if (!window.Vetro || !window.Vetro.perf) return Promise.reject(new Error('Vetro is not available'));
    return window.Vetro.perf(on).then(function () {
        try { localStorage.setItem(PERF_KEY, on ? 'on' : 'off'); } catch (e) { /* silent */ }
        toast(on ? 'Performance mode is on: the CPU stays at full speed' : 'Performance mode is off');
    }, function (e) {
        toast('Couldn’t change Performance mode: ' + ((e && e.message) || e));
        throw e;
    });
}
function askPerf() {
    if (S.zone === 'cc') closeCC();
    openAsk({
        title: 'Turn on Performance mode?',
        lines: [
            'The processor stays at full speed (1.7 GHz) all the time, instead of slowing down whenever it can. Apps, games and streaming respond faster.',
            'The TV uses a little more power and runs a little warmer. Measured on this TV while streaming a game: about 2 °C more over 8 minutes (61 to 63 °C), with no thermal throttling.',
            'It stays on, also after the TV restarts, until you turn it off with the same tile in the Control Center.'
        ],
        yes: 'Turn on Performance mode', no: 'Cancel'
    }, function () { setPerf(true).catch(function () { /* the notice says why */ }); });
}
// At startup: the TV is back on its own setting after a restart; put the chosen mode back (quietly, after boot).
if (perfChosen()) setTimeout(function () {
    if (window.Vetro && window.Vetro.perf) window.Vetro.perf(true).catch(function () { /* Vetro not up yet: the tile shows the real state */ });
}, 4000);
