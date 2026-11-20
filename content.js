// DialFlow - dialer engine + on-page widget (voice.google.com)
const ID = Math.random().toString(36).slice(2);
const S = { busy: false, phase: 'idle', at: 0, cur: -1, tries: 0, msg: 'Ready', hbAt: 0, skipReq: false, connected: false, connAt: 0, timerSeen: false, noAnswer: false,
  lastDone: -1, lastDoneAt: 0, min: false, cbAt: 0, cbDue: [], cbSeen: {}, cardKey: null, dialKey: null, hist: null, chime: true, flashAt: 0 };
const DEF = { nums: [], order: [], index: 0, running: false, ...CFG_DEFAULTS };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getState = () => chrome.storage.local.get(DEF);
const orderOf = st => (st.order && st.order.length ? st.order : st.nums.map((_, i) => i));
const store = o => chrome.storage.local.set(o);

// ---------- page helpers ----------
const label = el => [el.getAttribute('aria-label'), el.getAttribute('data-tooltip'), el.title, el.textContent].filter(Boolean).join(' ').trim();
const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
const buttons = () => [...document.querySelectorAll('button,[role="button"]')].filter(b => visible(b) && !b.closest('#dfhost'));
const last10 = s => String(s).replace(/\D/g, '').slice(-10);
const endBtn = () => buttons().find(b => /\b(end call|hang ?up|end the call)\b/i.test(label(b)));
const dialInput = () => [...document.querySelectorAll('input')].filter(visible).find(i => {
  const t = (i.getAttribute('aria-label') || '') + ' ' + (i.placeholder || '');
  return /name or number|enter a number|dial/i.test(t) && !/message|search/i.test(t);
});
// Only ever the Call button that belongs to the dialer box (never thread or history buttons)
function dialerCallBtn(input) {
  const ir = input.getBoundingClientRect(), cx = ir.left + ir.width / 2, cy = ir.top + ir.height / 2;
  let zone = input.parentElement; for (let k = 0; k < 8 && zone && zone.parentElement; k++) zone = zone.parentElement;
  let best = null, bd = 1e9;
  for (const b of buttons()) {
    if (!/^call$/i.test((b.getAttribute('aria-label') || b.textContent || '').trim())) continue;
    if (zone && !zone.contains(b)) continue;
    const r = b.getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
    if (d < bd) { bd = d; best = b; }
  }
  return bd < 350 ? best : null;
}
// A running call timer (m:ss) next to the hang-up button means the line is connected
function timerSeen() {
  const b = endBtn(); if (!b) return false;
  let r = b; for (let k = 0; k < 7 && r.parentElement; k++) r = r.parentElement;
  for (const e of r.querySelectorAll('*')) if (e.childElementCount === 0 && /^\d{1,2}:\d{2}(:\d{2})?$/.test((e.textContent || '').trim()) && visible(e)) return true;
  return false;
}
const diag = () => 'dial box ' + (dialInput() ? 'found' : 'MISSING') + ', hang-up ' + (endBtn() ? 'visible' : 'idle');
function setValue(input, v) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  input.focus(); setter.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
}
function pressEnter(el) { for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); }
function deepLink(num, li) {
  sessionStorage.setItem('gvDial', String(li));
  const base = (location.pathname.match(/^\/u\/\d+/) || ['/u/0'])[0];
  location.href = 'https://voice.google.com' + base + '/calls?a=nc,' + encodeURIComponent(num);
}
async function dial(num, li) {
  S.msg = 'Dialing ' + num;
  let input = dialInput();
  if (!input) { const mk = buttons().find(b => /make a call/i.test(label(b))); if (mk) { mk.click(); await sleep(900); input = dialInput(); } }
  if (!input) { S.msg = 'Dial box not found, using call link'; deepLink(num, li); return; }
  setValue(input, num); await sleep(350);
  if (last10(input.value) !== last10(num)) { setValue(input, num); await sleep(350); }
  if (last10(input.value) !== last10(num)) { S.msg = 'Dial box rejected the number'; return; }
  const cb = dialerCallBtn(input);
  if (cb && !cb.disabled && cb.getAttribute('aria-disabled') !== 'true') cb.click(); else pressEnter(input);
}

// ---------- storage helpers ----------
async function setRes(li, patch) { const { results } = await chrome.storage.local.get({ results: {} }); results[li] = { ...(results[li] || {}), ...patch }; await store({ results }); }
async function pushLog(e) { const { log } = await chrome.storage.local.get({ log: [] }); log.push(e); if (log.length > 5000) log.splice(0, log.length - 5000); await store({ log }); }
async function addHistory(num, ts) { const { history } = await chrome.storage.local.get({ history: {} }); const h = history[num] || { c: 0 }; history[num] = { t: ts, c: h.c + 1 }; await store({ history }); }
async function applyOutcome(li, disp) {
  const st = await getState(); const { notes, dnc } = await chrome.storage.local.get({ notes: {}, dnc: [] });
  const r = applyDispositionData(notes, dnc, li, st.nums[li], disp); await store({ notes: r.notes, dnc: r.dnc });
  const c = CARDS[li]; return 'Marked ' + ((c && c.name) || st.nums[li]) + ' as ' + disp;
}
function targetLead(st) { const now = Date.now(); if (S.lastDone >= 0 && now - S.lastDoneAt < 8000) return S.lastDone; if (S.cur >= 0) return S.cur; return orderOf(st)[st.index]; }
async function queueNext(li) {
  const st = await getState(); const active = S.phase === 'dialing' || S.phase === 'incall';
  const r = queueNextOrder(orderOf(st), st.index, li, active); await store({ order: r.order, index: r.index });
}

// ---------- compliance gate ----------
async function gate(li, st) {
  const num = st.nums[li];
  const { results, history, dnc, cards } = await chrome.storage.local.get({ results: {}, history: {}, dnc: [], cards: [] });
  const r = results[li] || {};
  if (st.dncOn && dnc.includes(num)) return 'dnc';
  if (st.recentOn && !r.retry) { const h = history[num]; if (h && Date.now() - Math.max(h.t || 0, h.mt || 0) < st.recentDays * 864e5) return 'recent'; }
  if (st.hoursOn) { const c = cards[li]; if (hoursAllowed(c && c.state, st.hoursStart, st.hoursEnd) === false) return 'hours'; }
  return null;
}
const WHY = { dnc: 'on Do Not Call list', recent: 'contacted recently', hours: 'outside calling hours' };
async function blockLead(li, why, st, ord) {
  const { results } = await chrome.storage.local.get({ results: {} }); const r = results[li] || {};
  const upd = {}; if (ord[st.index] === li) upd.index = st.index + 1;
  if (why === 'hours' && st.hoursMode === 'defer' && !r.defers) { upd.order = [...ord, li]; await setRes(li, { s: 'deferred', why, defers: 1 }); S.msg = 'Deferred (outside hours)'; }
  else { await setRes(li, { s: 'blocked', why }); S.msg = 'Skipped: ' + WHY[why]; }
  await store(upd);
}

// ---------- engine ----------
async function finish(outcome) {
  const li = S.cur; if (li < 0) { S.phase = 'idle'; return; }
  S.phase = 'waiting'; sessionStorage.removeItem('gvDial');
  const st = await getState(), ord = orderOf(st);
  const { results } = await chrome.storage.local.get({ results: {} }); const r = results[li] || {};
  const now = Date.now(), dur = r.t ? Math.round((now - r.t) / 1000) : 0, td = S.connected && S.connAt ? Math.round((now - S.connAt) / 1000) : 0;
  await setRes(li, { s: outcome, d: dur, td, e: now, a: !!S.connected });
  await pushLog({ i: li, n: st.nums[li], t: r.t || now, d: dur, td, s: outcome, a: !!S.connected });
  await addHistory(st.nums[li], now);
  const { answerStat } = await chrome.storage.local.get({ answerStat: { calls: 0, seen: 0 } });
  await store({ answerStat: { calls: answerStat.calls + 1, seen: answerStat.seen + (S.timerSeen ? 1 : 0) } });
  const upd = {}; if (ord[st.index] === li) upd.index = st.index + 1;
  if (outcome === 'noanswer') {
    const { notes } = await chrome.storage.local.get({ notes: {} });
    if (!(notes[li] && notes[li].disp)) { notes[li] = { ...(notes[li] || {}), disp: 'No answer' }; await store({ notes }); }
    if (st.requeueOn && (r.tries || 0) < st.requeueMax) { upd.order = [...ord, li]; await setRes(li, { tries: (r.tries || 0) + 1, retry: true }); }
  }
  await store(upd);
  S.lastDone = li; S.lastDoneAt = now;
  S.msg = outcome === 'noanswer' ? 'No answer, moving on' : outcome === 'called' ? 'Call ended' : 'Skipped';
  S.cur = -1; S.connected = false; S.timerSeen = false; S.noAnswer = false;
  await sleep(Math.max(0, st.delay) * 1000);
  S.phase = 'idle';
}
async function isController() {
  const { owner } = await chrome.storage.local.get({ owner: null }); const now = Date.now();
  if (owner && owner.id !== ID && now - owner.ts < 4000) return false;
  if (!owner || owner.id !== ID || now - owner.ts > 1500) await store({ owner: { id: ID, ts: now } });
  return true;
}
async function checkCallbacks() {
  const { notes } = await chrome.storage.local.get({ notes: {} }); const now = Date.now(), due = [];
  for (const id in notes) { const n = notes[id]; if (n.cb && !n.cbDone && n.cb <= now) due.push(+id); }
  S.cbDue = due; for (const id of due) if (!S.cbSeen[id]) { S.cbSeen[id] = 1; if (S.chime) chime(); }
}
async function tick() {
  if (S.busy) return; S.busy = true;
  try {
    const st = await getState(); S.chime = st.chime;
    if (!(await isController())) { S.msg = 'Another Voice tab is running the dialer'; paint(st); return; }
    if (Date.now() - S.hbAt > 1000) { S.hbAt = Date.now(); store({ hb: Date.now(), msg: S.msg, diag: diag(), phase: S.phase }); }
    if (Date.now() - S.cbAt > 10000) { S.cbAt = Date.now(); await checkCallbacks(); }
    paint(st);
    const ord = orderOf(st);
    if (S.skipReq) {
      S.skipReq = false;
      if (st.running && S.cur >= 0) { await finish('skipped'); return; }
      await store({ index: st.index + 1 }); return;
    }
    if (!st.running) { if (S.phase === 'dialing' || S.phase === 'waiting') S.phase = 'idle'; S.msg = 'Paused'; return; }
    if (st.index >= ord.length) { S.msg = 'Queue complete'; await store({ running: false }); return; }
    const inCall = !!endBtn(), li = ord[st.index];

    if (S.phase === 'idle') {
      if (inCall) { S.phase = 'incall'; S.at = Date.now(); S.cur = li; S.connected = false; S.timerSeen = false; return; }
      let why = null; try { why = await gate(li, st); } catch (e) { why = null; }
      if (why) { await blockLead(li, why, st, ord); return; }
      S.cur = li; S.phase = 'dialing'; S.at = Date.now(); S.tries = 0; S.connected = false; S.timerSeen = false; S.noAnswer = false;
      await setRes(li, { s: 'dialing', t: Date.now(), d: null, td: null, a: false, why: null });
      if (sessionStorage.getItem('gvDial') === String(li)) { S.msg = 'Waiting for call to start'; return; }
      await dial(st.nums[li], li);
    } else if (S.phase === 'dialing') {
      if (inCall) { S.phase = 'incall'; S.at = Date.now(); S.msg = 'Ringing'; await setRes(S.cur, { s: 'ringing' }); }
      else if (S.tries < 1 && Date.now() - S.at > 5000) { S.tries++; await dial(st.nums[S.cur], S.cur); }
      else if (Date.now() - S.at > st.startTimeout * 1000) { S.msg = 'Call never started, skipped'; await finish('skipped'); }
    } else if (S.phase === 'incall') {
      if (!inCall) { await finish(S.noAnswer ? 'noanswer' : 'called'); return; }
      const el = Date.now() - S.at;
      if (!S.connected) {
        if (timerSeen()) { S.timerSeen = true; S.connected = true; S.connAt = Date.now(); S.msg = 'Connected'; S.flashAt = Date.now(); if (st.chime) chime(); await setRes(S.cur, { s: 'oncall', c: S.connAt }); }
        else if (st.ringLimit > 0 && el > st.ringLimit * 1000) { S.noAnswer = true; S.msg = 'No answer, hanging up'; endBtn().click(); }
        else if (el > 40000) { S.connected = true; S.connAt = S.at + 40000; await setRes(S.cur, { s: 'oncall', c: S.connAt }); }
      }
      if (st.maxCall > 0 && el > st.maxCall * 1000 && Date.now() - (S.lastEnd || 0) > 1500) { S.lastEnd = Date.now(); const eb = endBtn(); if (eb) eb.click(); }   // same as v2.2: counted from call start
    }
  } catch (e) { S.msg = 'Error: ' + e.message; }
  finally { S.busy = false; }
}
function skip() { const b = endBtn(); if (b) b.click(); else S.skipReq = true; }
let AC; function chime() {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    [880, 1318].forEach((f, i) => { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = f; o.connect(g); g.connect(AC.destination); const t = AC.currentTime + i * .13;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.16, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .28); o.start(t); o.stop(t + .3); });
  } catch (e) {}
}

// ---------- widget (shadow DOM so Google Voice styles can't touch it) ----------
let CARDS = [], CUES = null;
chrome.storage.local.get({ cards: [], cues: null }).then(s => { CARDS = s.cards || []; CUES = s.cues; S.cardKey = null; });
chrome.storage.onChanged.addListener(ch => { if (ch.cards) { CARDS = ch.cards.newValue || []; S.cardKey = null; } if (ch.cues) { CUES = ch.cues.newValue; S.cardKey = null; } });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtPhone = n => { const d = String(n).replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : n; };
const host = document.createElement('div'); host.id = 'dfhost'; host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483000';
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>
:host{all:initial}*{box-sizing:border-box}
.w{width:348px;background:#0E141F;color:#E7ECF5;font:12.5px/1.45 -apple-system,Segoe UI,Inter,system-ui,sans-serif;border:1px solid #223049;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.55);overflow:hidden}
.w.flash{animation:fl 1.4s}@keyframes fl{0%{box-shadow:0 0 0 0 rgba(46,194,126,.9)}100%{box-shadow:0 0 0 18px rgba(46,194,126,0)}}
.hd{display:flex;align-items:center;gap:9px;padding:10px 12px;background:#121A28;border-bottom:1px solid #1D2A40;cursor:move;user-select:none}
.hd b{font-size:13px;letter-spacing:.2px}.hd .q{margin-left:auto;color:#8794AB;font-variant-numeric:tabular-nums}
.ic{width:16px;height:16px;flex:none}.bd{padding:12px}
.top{display:flex;align-items:center;gap:8px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;background:#1B2638;color:#A9B6CC;border:1px solid #2A3A56}
.pill i{width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.ring{color:#7FB0FF;background:rgba(79,124,255,.14);border-color:rgba(79,124,255,.5)}.pill.ring i{animation:pu 1s infinite}
.pill.conn{color:#4ADE9A;background:rgba(46,194,126,.14);border-color:rgba(46,194,126,.5)}
.pill.hot{color:#FFB65C;background:rgba(229,166,58,.14);border-color:rgba(229,166,58,.5)}.pill.warm{color:#7FB0FF}
@keyframes pu{50%{opacity:.25}}
.num{font-size:22px;font-weight:700;letter-spacing:.3px;margin:9px 0 0;font-variant-numeric:tabular-nums}
.nm{font-size:13.5px;font-weight:600;margin-top:2px;color:#CBD5E6}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.chip{padding:2px 9px;border-radius:6px;font-size:11px;font-weight:600;background:#17233A;border:1px solid #28395A;color:#B9C7DE}
.chip.t{color:#5EE0C8;border-color:rgba(34,195,166,.5);background:rgba(34,195,166,.1)}.chip.w2{color:#F1B964;border-color:rgba(229,166,58,.5);background:rgba(229,166,58,.1)}
.g{display:grid;grid-template-columns:1fr 1fr;gap:7px}.g>div{background:#121A28;border:1px solid #1D2A40;border-radius:9px;padding:7px 10px;min-width:0}
small{display:block;color:#7D8BA3;font-size:10px;letter-spacing:.7px;text-transform:uppercase;font-weight:600}.g b{display:block;font-size:12.5px;margin-top:1px;word-break:break-word}.g em{display:block;font-style:normal;color:#7D8BA3;font-size:10.5px}
.big{font-size:17px!important;color:#7FB0FF}
.cue{margin-top:8px;padding:8px 10px;border-left:3px solid #4F7CFF;background:#111C30;border-radius:0 8px 8px 0;color:#C2CEE2;font-size:11.5px}
.links{display:flex;gap:12px;margin-top:8px;flex-wrap:wrap}.links a{color:#7FB0FF;text-decoration:none;font-size:11.5px;font-weight:600}.links a:hover{text-decoration:underline}
.cb{margin-top:8px;padding:8px 10px;border:1px solid rgba(229,166,58,.55);background:rgba(229,166,58,.1);border-radius:9px;display:none}
.cb .r{display:flex;gap:6px;margin-top:6px}
.bar{height:4px;background:#1B2638;border-radius:4px;margin:11px 0;overflow:hidden}.bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#4F7CFF,#22C3A6);transition:width .3s}
.ctl{display:flex;gap:6px}.ib{flex:1;height:34px;border:1px solid #28395A;background:#16223A;color:#E7ECF5;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.ib:hover{border-color:#4F7CFF}.ib.p{background:#3B66E8;border-color:#3B66E8}.ib.d{background:#7A2631;border-color:#A23545}.ib.on{background:#15724A;border-color:#1F9964}.ib.bad{background:#7A2631}
.oc{display:flex;gap:5px;margin-top:8px}.oc button{flex:1;padding:5px 0;border:1px solid #28395A;background:#121A28;color:#B9C7DE;border-radius:7px;font-size:10.5px;font-weight:600;cursor:pointer}.oc button:hover{border-color:#4F7CFF;color:#fff}
.ft{margin-top:8px;color:#7D8BA3;font-size:11px;min-height:15px}.ft b{color:#5EE0C8;font-weight:600}
.sm{padding:3px 9px;border:1px solid #3A4C70;background:#16223A;color:#fff;border-radius:6px;cursor:pointer;font-size:11px}
.mini .g,.mini .cue,.mini .links,.mini .oc{display:none}
</style><div class="w" id="w"><div class="hd" id="hd"><span id="lg"></span><b>DialFlow</b><span class="q" id="q"></span><button class="sm" id="mn" title="Collapse">${'' }</button></div>
<div class="bd" id="bd"><div class="top"><span class="pill" id="st"><i></i><span id="stt"></span></span><span class="pill" id="sc" style="display:none"></span></div>
<div class="num" id="num"></div><div id="card"></div><div class="cb" id="cb"></div>
<div class="bar"><i id="pg"></i></div><div class="ctl" id="ctl"></div><div class="oc" id="oc"></div><div class="ft" id="ft"></div></div></div>`;
const $ = s => root.querySelector(s);
$('#lg').innerHTML = LOGO(22); $('#mn').innerHTML = IC('min');
const ib = (icon, title, fn, cls = '') => { const b = document.createElement('button'); b.className = 'ib ' + cls; b.title = title; b.innerHTML = IC(icon); b.onclick = fn; $('#ctl').appendChild(b); return b; };
const bPlay = ib('play', 'Start / pause dialing', async () => { const s = await getState(); if (s.nums.length) store({ running: !s.running }); }, 'p');
ib('hangup', 'End call', () => { const b = endBtn(); if (b) b.click(); }, 'd');
ib('skip', 'Skip lead', skip);
const bMic = ib('micoff', 'Voice commands', () => { store({ voice: { ...voiceCfg(V.raw), enabled: !V.cfg.enabled } }); V.blocked = false; });
ib('grid', 'Open dashboard', () => chrome.runtime.sendMessage({ type: 'open-dashboard' }));
ib('panel', 'Open dashboard in side panel', () => chrome.runtime.sendMessage({ type: 'open-side' }));
[['Interested', 'Interested'], ['Callback', 'Callback'], ['No answer', 'No answer'], ['Not interested', 'Not interested'], ['Do not call', 'DNC']].forEach(([d, t]) => {
  const b = document.createElement('button'); b.textContent = t; b.title = 'Mark as ' + d;
  b.onclick = async () => { const st = await getState(), li = targetLead(st); if (li == null) return; flashMsg(await applyOutcome(li, d)); }; $('#oc').appendChild(b);
});
let msgAt = 0, msgTxt = ''; const flashMsg = t => { msgTxt = t; msgAt = Date.now(); S.msg = t; };
document.documentElement.appendChild(host);
$('#mn').onclick = () => { S.min = !S.min; S.cardKey = null; $('#w').classList.toggle('mini', S.min); $('#mn').innerHTML = IC(S.min ? 'max' : 'min'); };
$('#hd').onmousedown = e => {
  if (e.target.closest('button')) return;
  const r = host.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
  host.style.bottom = 'auto'; host.style.left = r.left + 'px'; host.style.top = r.top + 'px';
  const mv = ev => { host.style.left = Math.max(0, ev.clientX - dx) + 'px'; host.style.top = Math.max(0, ev.clientY - dy) + 'px'; };
  const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
};
function cardHTML(c, histInfo) {
  const a = ageOf(c.date), loc = [c.city, c.state].filter(Boolean).join(', '), lt = localTimeLabel(c.state);
  const tag = a && a.months < 3 ? '<span class="chip w2">Very new authority</span>' : a && a.months < 12 ? '<span class="chip w2">New authority</span>' : '';
  const ids = [c.mc && 'MC ' + String(c.mc).replace(/^mc[\s#-]*/i, ''), c.dot && 'DOT ' + String(c.dot).replace(/^dot[\s#-]*/i, '')].filter(Boolean).join('  /  ');
  const cue = pitchCue(c, CUES || CUES_DEFAULT).map(esc).join(' '), links = carrierLinks(c);
  return `<div class="nm">${esc(c.name)}</div><div class="chips"><span class="chip t">${esc(c.truck)}${c.inferred && !c.unknown ? ' (likely)' : ''}</span>${tag}</div>` + (S.min ? '' : `
  <div class="g"><div><small>Officer</small><b>${esc(c.officer || '-')}</b></div>
  <div><small>MC authority</small><b class="big">${esc(fmtAge(a))}</b><em>${a ? esc(c.date) + ' - ' + a.total + ' days' : 'date missing'}</em></div>
  <div><small>Location</small><b>${esc(loc || '-')}</b>${lt ? `<em>Local time ${esc(lt)}</em>` : ''}</div>
  <div><small>${c.fleet ? 'Fleet' : 'Authority'}</small><b>${esc(c.fleet || ids || '-')}</b><em>${esc(c.fleet ? ids : '')}</em></div></div>
  <div class="cue">${cue}</div>
  <div class="links">${links.map(([k, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(k)}</a>`).join('')}</div>
  <div style="color:#7D8BA3;font-size:11px;margin-top:7px">${histInfo && histInfo.c ? 'Dialed ' + histInfo.c + ' time' + (histInfo.c > 1 ? 's' : '') + ' before' : 'First dial'}</div>`);
}
function paint(st) {
  const ord = orderOf(st), total = ord.length, li = ord[st.index], num = li != null ? st.nums[li] : null, c = li != null ? CARDS[li] : null;
  const key0 = st.index + '|' + li; if (S.dialKey !== key0) { S.dialKey = key0; S.hist = null; if (num) chrome.storage.local.get({ history: {} }).then(h => { S.hist = h.history[num] || null; S.cardKey = null; }); }
  $('#q').textContent = total ? Math.min(st.index + 1, total) + ' / ' + total : '';
  $('#num').textContent = !st.nums.length ? 'No leads loaded' : num ? fmtPhone(num) : 'Queue complete';
  let t = 'Paused', cls = '';
  if (!st.nums.length) t = 'Import a list in the dashboard';
  else if (num == null) t = 'Done';
  else if (st.running) {
    if (S.phase === 'incall' && S.connected) { const s = Math.floor((Date.now() - S.connAt) / 1000); t = 'Connected ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); cls = 'conn'; }
    else if (S.phase === 'incall') { t = 'Ringing'; cls = 'ring'; } else if (S.phase === 'dialing') { t = 'Dialing'; cls = 'ring'; } else t = 'Next lead';
  }
  $('#stt').textContent = t; $('#st').className = 'pill ' + cls;
  const sc = $('#sc'); if (c && c.score != null) { const l = scoreLabel(c.score); sc.style.display = ''; sc.className = 'pill ' + l.toLowerCase(); sc.textContent = l + ' ' + c.score; } else sc.style.display = 'none';
  const key = st.index + '|' + li + '|' + S.min + '|' + (S.hist ? S.hist.c : '') + '|' + CARDS.length + '|' + (CUES ? 1 : 0);
  if (key !== S.cardKey) { S.cardKey = key; $('#card').innerHTML = num && c ? cardHTML(c, S.hist) : ''; }
  const cb = $('#cb');
  if (S.cbDue.length) { const id = S.cbDue[0], cc = CARDS[id], n = st.nums[id];
    cb.style.display = 'block'; cb.innerHTML = `<small style="color:#F1B964">Callback due</small><b>${esc((cc && cc.name) || n)}</b> <span style="color:#A9B6CC">${esc(fmtPhone(n))}</span><div class="r"><button class="sm" id="cbGo">Dial next</button><button class="sm" id="cbX">Dismiss</button></div>`;
    cb.querySelector('#cbGo').onclick = async () => { await queueNext(id); dismissCb(id); }; cb.querySelector('#cbX').onclick = () => dismissCb(id);
  } else cb.style.display = 'none';
  $('#pg').style.width = total ? Math.min(100, st.index / total * 100) + '%' : '0';
  bPlay.innerHTML = IC(st.running ? 'pause' : 'play');
  if (Date.now() - S.flashAt < 200) { $('#w').classList.remove('flash'); void $('#w').offsetWidth; $('#w').classList.add('flash'); }
  paintVoice(); const f = $('#ft');
  f.innerHTML = Date.now() - msgAt < 7000 && msgTxt ? '<b>' + esc(msgTxt) + '</b>' : (V.note && Date.now() - V.noteAt < 6000 ? esc(V.note) : esc(S.msg));
}
async function dismissCb(id) { const { notes } = await chrome.storage.local.get({ notes: {} }); notes[id] = { ...(notes[id] || {}), cbDone: true }; await store({ notes }); S.cbDue = S.cbDue.filter(x => x !== id); }

// ---------- voice commands ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const V = { rec: null, raw: null, cfg: voiceCfg(null), blocked: false, pending: null, lastFire: 0, note: '', noteAt: 0, errAt: 0, mode: 'all' };
function paintVoice() {
  const on = V.cfg.enabled; bMic.className = 'ib' + (on ? (V.blocked ? ' bad' : ' on') : ''); bMic.innerHTML = IC(on ? 'mic' : 'micoff');
  bMic.title = on && lockWanted() ? 'Listening with voice lock (only your voice). Click to turn off' : !SR ? 'Voice not supported in this browser' : on ? (V.blocked ? 'Microphone blocked: allow it for voice.google.com' : 'Listening. Click to turn off') : 'Turn voice commands on';
  if (on && V.blocked) { V.note = 'Allow the microphone for voice.google.com, then click the mic'; V.noteAt = Date.now(); }
}
function applyVoice() {
  V.cfg = voiceCfg(V.raw); syncLock();
  if (V.cfg.enabled && SR) { if (V.rec && V.rec.lang !== V.cfg.lang) { try { V.rec.stop(); } catch (e) {} } else startVoice(); } else stopVoice();
}
function stopVoice() { clearTimeout(V.pending); if (V.rec) { const r = V.rec; V.rec = null; r.onend = null; try { r.stop(); } catch (e) {} } }
function effCfg() { // while a call is connected, apply the "in call" safety mode
  if (!(S.phase === 'incall' && S.connected)) return V.cfg;
  if (V.mode === 'wake') return { ...V.cfg, wake: V.cfg.wake || 'dialflow' };
  return V.cfg;
}
function allowed(key) {
  if (!(S.phase === 'incall' && S.connected)) return true;
  if (V.mode === 'off') return false; if (V.mode === 'limited') return VOICE_LIMITED.includes(key); return true;
}

// ---------- voice lock: only the enrolled person's voice can trigger commands ----------
const VL = { meter: null, profile: null, cfg: { on: false, sens: 'balanced', level: true, pitch: true, tone: true }, starting: false, err: '' };
chrome.storage.local.get({ vprint: null, vpCfg: null }).then(s => { VL.profile = s.vprint; VL.cfg = { ...VL.cfg, ...(s.vpCfg || {}) }; syncLock(); });
chrome.storage.onChanged.addListener(ch => { if (ch.vprint) VL.profile = ch.vprint.newValue; if (ch.vpCfg) VL.cfg = { ...VL.cfg, ...(ch.vpCfg.newValue || {}) }; if (ch.vprint || ch.vpCfg) syncLock(); });
document.addEventListener('click', () => { if (VL.meter) VL.meter.resume(); }, true);
const lockWanted = () => !!(V.cfg.enabled && VL.cfg.on && VL.profile);
async function syncLock() {
  if (lockWanted()) {
    if (!VL.meter && !VL.starting) { VL.starting = true; try { VL.meter = new VoiceMeter(await vpOpenMic()); VL.meter.resume(); VL.err = ''; } catch (e) { VL.err = 'Voice lock inactive: microphone blocked'; } VL.starting = false; }
  } else if (VL.meter) { VL.meter.stop(); VL.meter = null; }
}
// true = the command was spoken by the enrolled person (or the lock is off)
function lockCheck(text) {
  if (!lockWanted()) return true;
  if (!VL.meter) { V.note = VL.err || 'Voice lock inactive, command accepted'; V.noteAt = Date.now(); return true; }
  const v = vpVerify(VL.profile, VL.meter.segment(2500), VL.cfg);
  if (v.ok) return true;
  const why = 'Ignored, not your voice (' + v.pct + '%): ' + (v.why[0] || 'no match');
  V.note = why; V.noteAt = Date.now(); flashMsg(why);
  store({ voiceLast: { text: (text || '').trim(), action: '', out: why, ts: Date.now(), blocked: true, pct: v.pct } }); return false;
}

function startVoice() {
  if (V.rec || !SR || !V.cfg.enabled || V.blocked) return;
  const r = new SR(); r.continuous = true; r.interimResults = true; r.maxAlternatives = 3; r.lang = V.cfg.lang;
  r.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], alts = [...res].map(a => a.transcript), text = alts[0] || '';
      const m = alts.map(a => voiceMatch(effCfg(), a)).find(Boolean) || null;
      clearTimeout(V.pending); V.pending = null;
      if (res.isFinal) {
        if (m) fireVoice(m, text);
        else if (text.trim()) { V.note = '"' + text.trim() + '" (no command)'; V.noteAt = Date.now(); store({ voiceLast: { text: text.trim(), action: '', ts: Date.now() } }); }
      } else if (m && m.key !== 'note' && V.cfg.fast) V.pending = setTimeout(() => fireVoice(m, text), 400);
    }
  };
  r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { V.blocked = true; stopVoice(); } else if (e.error === 'network') V.errAt = Date.now(); };
  r.onend = () => { V.rec = null; if (V.cfg.enabled && !V.blocked) setTimeout(startVoice, Date.now() - V.errAt < 4000 ? 3000 : 300); };
  try { r.start(); V.rec = r; } catch (e) {}
}
async function fireVoice(m, text) {
  const key = m.key, now = Date.now(); if (now - V.lastFire < 2000) return;
  if (!allowed(key)) { V.note = 'Ignored while on a call: ' + key.replace(/^d_/, ''); V.noteAt = now; return; }
  if (!lockCheck(text)) return;
  const { owner } = await chrome.storage.local.get({ owner: null });
  if (owner && owner.id !== ID && now - owner.ts < 4000) return;
  V.lastFire = now; const st = await getState(); let out = '';
  const lab = (VOICE_ACTIONS.find(a => a[0] === key) || [])[1] || key;
  if (key === 'endCall') { const b = endBtn(); if (b) { b.click(); out = 'Call ended'; } else out = 'No active call'; }
  else if (key === 'skip') { skip(); out = 'Skipped'; }
  else if (key === 'endStop') { const b = endBtn(); await store({ running: false }); if (b) b.click(); out = 'Call ended, dialing paused'; }
  else if (key === 'pause') { await store({ running: false }); out = 'Paused'; }
  else if (key === 'resume') { if (st.nums.length) await store({ running: true }); out = 'Resumed'; }
  else if (key === 'dashboard') { chrome.runtime.sendMessage({ type: 'open-dashboard' }); out = 'Dashboard opened'; }
  else if (key === 'hideCard' || key === 'showCard') { if (S.min !== (key === 'hideCard')) $('#mn').click(); out = key === 'hideCard' ? 'Card collapsed' : 'Card expanded'; }
  else if (key === 'note') {
    const li = targetLead(st); const { notes } = await chrome.storage.local.get({ notes: {} });
    const prev = (notes[li] && notes[li].note) || ''; const stamp = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    notes[li] = { ...(notes[li] || {}), note: (prev ? prev + '\n' : '') + '[' + stamp + '] ' + m.rest }; await store({ notes }); out = 'Note saved: ' + m.rest;
  } else if (key.startsWith('d_')) { const li = targetLead(st); out = await applyOutcome(li, key.slice(2)); }
  flashMsg(out); V.note = '"' + text.trim() + '" > ' + out; V.noteAt = Date.now();
  store({ voiceLast: { text: text.trim(), action: lab, out, ts: now } });
}
chrome.storage.local.get({ voice: null, voiceInCall: 'all' }).then(s => { V.raw = s.voice; V.mode = s.voiceInCall; applyVoice(); });
chrome.storage.onChanged.addListener(ch => { if (ch.voice) { V.raw = ch.voice.newValue; applyVoice(); } if (ch.voiceInCall) V.mode = ch.voiceInCall.newValue; });

document.addEventListener('keydown', e => { if (e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); skip(); } });
setInterval(tick, 400);
(function connect() {
  try {
    const p = chrome.runtime.connect({ name: 'tick' }); p.onMessage.addListener(() => tick());
    const ping = setInterval(() => { try { p.postMessage('p'); } catch (e) {} }, 15000);
    p.onDisconnect.addListener(() => { clearInterval(ping); setTimeout(connect, 1500); });
  } catch (e) {}
})();
