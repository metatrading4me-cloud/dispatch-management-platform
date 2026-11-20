// DialFlow dashboard
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DEF = { leads: [], columns: [], phoneColumn: '', nums: [], order: [], index: 0, running: false, results: {}, notes: {}, log: [], history: {}, dnc: [], cards: [], map: {}, fileName: '',
  profile: PROFILE_DEFAULT, cues: null, voice: null, voiceLast: null, hb: 0, msg: '', diag: '', answerStat: { calls: 0, seen: 0 }, backups: [], filters: {}, vprint: null, vpCfg: null, ...CFG_DEFAULTS };
let ST = { ...DEF }, page = 'dialer', setTab = 'dialing', FS = { q: '', status: 'all', open: false }, openId = null, lastScroll = null;
const DISP = ['Interested', 'Callback', 'Not interested', 'No answer', 'Voicemail', 'Wrong number', 'Do not call'];
const TRUCKS = ['Box truck', 'Hotshot', 'Cargo van / Sprinter', 'Dry van', 'Reefer', 'Flatbed', 'Semi (tractor + trailer)', 'Tractor / power only', 'Power only', 'Dump truck', 'Tow', 'Car hauler', 'Tanker', 'Unknown'];
const isSide = new URLSearchParams(location.search).get('mode') === 'side';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = s => s == null ? '-' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
const fmtNum = n => { const d = String(n).replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : n; };
const fmtDT = t => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
const toLocalInput = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const dayStart = (off = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d.getTime(); };
const set = o => { Object.assign(ST, o); return chrome.storage.local.set(o); };
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2800); }
const ord = () => (ST.order && ST.order.length ? ST.order : ST.nums.map((_, i) => i));
const curId = () => { const o = ord(); return ST.index < o.length ? o[ST.index] : null; };
const res = id => ST.results[id] || {};
const note = id => ST.notes[id] || {};
const connected = () => ST.hb && Date.now() - ST.hb < 5000;
const sw = (id, on) => `<label class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label>`;
const WHYL = { dnc: 'DNC', recent: 'Recent', hours: 'Hours' };

function stat(id) {
  const r = res(id), cur = id === curId(), s = r.s;
  if (s === 'blocked') return { k: 'blocked', t: 'Blocked: ' + (WHYL[r.why] || 'rule') };
  if (s === 'deferred') return { k: 'deferred', t: 'Deferred' };
  if (cur && (s === 'dialing' || s === 'ringing' || s === 'oncall')) return { k: s, t: { dialing: 'Dialing', ringing: 'Ringing', oncall: 'Connected' }[s], live: true };
  if (s === 'called' || s === 'noanswer' || s === 'skipped') return { k: s, t: { called: 'Called', noanswer: 'No answer', skipped: 'Skipped' }[s] };
  if (cur) return { k: 'next', t: 'Up next' };
  return { k: 'pending', t: 'Pending' };
}
const badge = id => { const s = stat(id); return `<span class="badge ${s.k}">${s.live ? '<i class="pulse"></i>' : ''}${s.t}</span>`; };
const scoreBadge = c => c && c.score != null ? `<span class="badge ${scoreLabel(c.score).toLowerCase()}">${scoreLabel(c.score)} ${c.score}</span>` : '';
const authTxt = c => fmtAge(ageOf(c.date));

// ---------- derived numbers ----------
function kpis() {
  const t0 = dayStart(), L = ST.log.filter(l => l.t >= t0), calls = L.length, talk = L.reduce((a, l) => a + (l.td || 0), 0), conn = L.filter(l => l.a).length, real = L.filter(l => !l.imp).length;
  const interested = Object.values(ST.notes).filter(n => n.disp === 'Interested').length;
  return { calls, talk, conn, rate: real ? Math.round(conn / real * 100) : 0, real, interested, remaining: Math.max(0, ord().length - ST.index), L };
}
function recomputeCards() {
  const cards = ST.leads.map(l => makeCard(l, ST.map, ST.profile, ST.history[l.n])); return set({ cards });
}
function passFilters(i, f) {
  const c = ST.cards[i]; if (!c) return true; f = f || ST.filters || {};
  if (f.states && f.states.length && !f.states.includes(c.state)) return false;
  if (f.trucks && f.trucks.length && !f.trucks.includes(c.truck)) return false;
  const a = ageOf(c.date);
  if (f.minMo !== '' && f.minMo != null && (!a || a.months < +f.minMo)) return false;
  if (f.maxMo !== '' && f.maxMo != null && (!a || a.months > +f.maxMo)) return false;
  if (f.minScore && (c.score || 0) < +f.minScore) return false;
  return true;
}
function buildOrder(sortMode, filters) {
  const dnc = new Set(ST.dnc);
  const ids = ST.leads.map((_, i) => i).filter(i => res(i).s !== 'called' && !dnc.has(ST.nums[i]) && passFilters(i, filters));
  if ((sortMode || ST.sortMode) === 'score') ids.sort((a, b) => ((ST.cards[b] || {}).score || 0) - ((ST.cards[a] || {}).score || 0) || a - b);
  return ids;
}

// ---------- shell: nav + top bar ----------
const PAGES = [['dialer', 'Dialer', 'grid', 'Workspace'], ['leads', 'Leads', 'list'], ['callbacks', 'Callbacks', 'bell'], ['analytics', 'Analytics', 'chart', 'Insights'], ['log', 'Call log', 'clock'], ['dnc', 'Do not call', 'ban', 'Compliance'], ['settings', 'Settings', 'sliders', 'System']];
const TITLES = { dialer: ['Dialer', 'Live console for the active campaign'], leads: ['Leads', 'Your imported list, queue and filters'], callbacks: ['Callbacks', 'Follow-ups you scheduled'], analytics: ['Analytics', 'Performance and best times to call'], log: ['Call log', 'Every dial this device has made'], dnc: ['Do not call', 'Numbers that will never be dialed'], settings: ['Settings', 'Dialing rules, targeting, voice and data'] };
function dueCallbacks() { return Object.entries(ST.notes).filter(([, n]) => n.cb && !n.cbDone && n.cb <= Date.now()).map(([id]) => +id); }
function renderShell() {
  $('#brand').innerHTML = `${LOGO(38)}<div><b>DialFlow</b><small>Power dialer for Google Voice</small></div>`;
  let h = '', due = dueCallbacks().length;
  PAGES.forEach(([k, t, ic, grp]) => {
    if (grp) h += `<div class="nav-h">${grp}</div>`;
    const n = k === 'leads' ? ST.leads.length || '' : k === 'callbacks' ? (due || '') : k === 'dnc' ? (ST.dnc.length || '') : '';
    h += `<a href="#${k}" data-p="${k}" class="${page === k ? 'on' : ''}">${IC(ic)}${t}${n !== '' ? `<span class="n ${k === 'callbacks' && due ? 'hot' : ''}">${n}</span>` : ''}</a>`;
  });
  $('#nav').innerHTML = h; renderTop(); renderRailFoot();
}
function renderRailFoot() {
  const ok = connected();
  $('#railFoot').innerHTML = `<div class="row" style="gap:8px;color:var(--tx);font-weight:600"><i class="dot ${ok ? 'ok' : ''}"></i>${ok ? 'Voice tab connected' : 'Voice tab not connected'}</div><div style="margin-top:3px">${ok ? esc(ST.msg || 'Ready') : 'Open or refresh voice.google.com'}</div>`;
}
function renderTop() {
  const [t, sub] = TITLES[page], v = voiceCfg(ST.voice), ok = connected(), total = ord().length;
  $('#top').innerHTML = `<div><h1>${t}</h1><div class="sub">${sub}</div></div><span class="sp"></span>
   <span class="pill hide-s"><i class="dot ${ok ? 'ok' : ''}"></i>${ok ? 'Connected' : 'Offline'}</span>
   <span class="pill hide-s">${IC(v.enabled ? 'mic' : 'micoff', 'sm')}${v.enabled ? 'Voice on' : 'Voice off'}</span>
   ${ST.leads.length ? `<button class="btn" id="tSkip" ${ST.running ? '' : 'disabled'}>${IC('skip', 'sm')}Skip</button>
   <button class="btn pri" id="tRun">${IC(ST.running ? 'pause' : 'play', 'sm')}${ST.running ? 'Pause' : (ST.index > 0 && ST.index < total ? 'Resume' : 'Start dialing')}</button>` : ''}`;
  const run = $('#tRun'); if (run) run.onclick = () => set({ running: !ST.running, ...(ST.index >= ord().length ? { index: 0 } : {}) });
  const sk = $('#tSkip'); if (sk) sk.onclick = () => set({ index: ST.index + 1 });
}

// ---------- import ----------
const dropzone = () => `<div class="dz" id="dz">${IC('upload', 'lg')}<h3>Import your leads</h3><p>Drop a CSV here or choose a file. The phone column and carrier fields are detected automatically.</p><button class="btn pri" id="pick">${IC('upload', 'sm')}Choose CSV file</button></div>`;
function bindDZ(root) {
  const dz = $('#dz', root); if (!dz) return;
  $('#pick', dz).onclick = () => $('#fCsv').click();
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); };
}
async function importFile(f) {
  if (ST.leads.length && !confirm('Replace the current list? Progress, notes and callbacks for this list will be cleared. Your DNC list and call history are kept.')) return;
  const { leads, columns, phoneColumn } = buildLeads(parseCSV(await f.text()));
  if (!leads.length) return toast('No valid phone numbers found in that file');
  const map = detectMap(columns), cards = leads.map(l => makeCard(l, map, ST.profile, ST.history[l.n]));
  Object.assign(ST, { leads, columns, phoneColumn, map, cards, nums: leads.map(l => l.n), results: {}, notes: {}, fileName: f.name });
  await set({ leads, columns, phoneColumn, map, cards, nums: ST.nums, results: {}, notes: {}, fileName: f.name, running: false, index: 0 });
  await set({ order: buildOrder(ST.sortMode, {}) });
  toast(leads.length + ' leads imported'); location.hash = '#dialer'; if (Object.keys(ST.history).length) offerResume();
}
$('#fCsv').onchange = e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; };

// ---------- carrier detail block (shared by dialer + drawer) ----------
function carrierBlock(c, id) {
  if (!c) return '';
  const a = ageOf(c.date), loc = [c.city, c.state].filter(Boolean).join(', '), lt = localTimeLabel(c.state);
  const cell = (k, v, sub, cls = '') => `<div class="fld ${cls}"><span class="lab">${k}</span><b>${esc(v || '-')}</b>${sub ? `<em>${esc(sub)}</em>` : ''}</div>`;
  const h = ST.history[ST.nums[id]], cue = pitchCue(c, ST.cues || CUES_DEFAULT), links = carrierLinks(c);
  return `<div class="fields">
    ${cell('Truck type' + (c.inferred && !c.unknown ? ' (likely)' : ''), c.truck, '', 'hi')}
    ${cell('MC authority', fmtAge(a), a ? c.date + '  -  ' + a.total + ' days' : 'date missing', 'hi')}
    ${cell('Officer', c.officer)}${cell('Location', loc, lt ? 'Local time ' + lt : '')}
    ${cell('MC / DOT', [c.mc && 'MC ' + c.mc, c.dot && 'DOT ' + c.dot].filter(Boolean).join('  /  '))}
    ${c.fleet ? cell('Fleet', c.fleet) : ''}${c.email ? cell('Email', c.email) : ''}
    ${cell('Dial history', h ? 'Dialed ' + h.c + (h.c > 1 ? ' times' : ' time') : 'First dial', h ? 'Last ' + fmtDT(h.t) : '')}</div>
    <div class="cue">${cue.map(esc).join(' ')}</div>
    <div class="links">${links.map(([k, u]) => `<a href="${u}" target="_blank" rel="noopener">${IC('ext', 'sm')}${esc(k)}</a>`).join('')}</div>`;
}

// ---------- DIALER ----------
const kpi = (l, v, s, m) => `<div class="card kpi"><div class="lab">${l}</div><div class="v">${v}</div><div class="s">${s || ''}</div>${m != null ? `<div class="meter"><i style="width:${Math.min(100, m)}%"></i></div>` : ''}</div>`;
function timerText() { const r = res(curId()); return r.s === 'oncall' && r.c ? mmss((Date.now() - r.c) / 1000) : (r.s === 'dialing' || r.s === 'ringing') && r.t ? mmss((Date.now() - r.t) / 1000) : '0:00'; }
function renderDialer() {
  const el = $('#view');
  if (!ST.leads.length) { el.innerHTML = dropzone(); bindDZ(el); return; }
  const k = kpis(), o = ord(), id = curId(), L = id != null ? ST.leads[id] : null, c = id != null ? ST.cards[id] : null, done = id == null;
  const pct = o.length ? Math.min(100, ST.index / o.length * 100) : 0, goalPct = ST.goal ? k.calls / ST.goal * 100 : 0;
  const up = o.slice(ST.index + 1, ST.index + 9).map((lid, n) => { const cc = ST.cards[lid]; return `<li data-id="${lid}"><span class="i">${ST.index + 2 + n}</span><span class="n">${esc((cc && cc.name) || ST.leads[lid].name || fmtNum(ST.nums[lid]))}<small class="mono">${esc(fmtNum(ST.nums[lid]))}${cc && cc.truck ? '  -  ' + esc(cc.truck) : ''}</small></span>${scoreBadge(cc)}</li>`; }).join('');
  const dueN = dueCallbacks(), blocked = Object.values(ST.results).filter(r => r.s === 'blocked'), defer = Object.values(ST.results).filter(r => r.s === 'deferred').length;
  const by = w => blocked.filter(r => r.why === w).length;
  el.innerHTML = `<div class="grid k5" style="margin-bottom:16px">
    ${kpi('Calls today', k.calls, 'Goal ' + ST.goal, goalPct)}${kpi('Talk time', mmss(k.talk), 'Connected calls today')}${kpi('Connect rate', k.rate + '%', k.conn + ' of ' + k.real + ' tracked calls')}${kpi('Interested', k.interested, 'Leads marked interested')}${kpi('Queue', k.remaining, 'of ' + o.length + ' remaining', 100 - pct)}</div>
  <div class="grid c2"><div class="card hero">${done ? `<h3>${IC('check')}Queue complete</h3><p class="note">Every lead in the queue has been handled. Build a new queue from the Leads page or export your results.</p>` : `
    <div class="row"><span class="lab">Lead ${ST.index + 1} of ${o.length}</span>${badge(id)}${scoreBadge(c)}<span class="sp"></span><span class="timer" id="timer">${timerText()}</span></div>
    <div class="num">${esc(fmtNum(ST.nums[id]))}</div><div class="nm">${esc((c && c.name) || L.name || 'No name column')}</div><div class="meter"><i style="width:${pct}%"></i></div>
    ${carrierBlock(c, id)}
    <div class="row" style="margin-top:16px">${DISP.slice(0, 5).map(d => `<button class="btn sm" data-disp="${d}">${d}</button>`).join('')}<span class="sp"></span><button class="btn sm ghost" id="more">${IC('note', 'sm')}Notes and details</button></div>`}</div>
   <div class="grid" style="align-content:start">
    <div class="card"><h3>${IC('list')}Up next</h3><ul class="queue">${up || '<li class="note">Nothing queued</li>'}</ul></div>
    <div class="card"><h3>${IC('shield')}Compliance</h3>
      ${dueN.length ? `<div class="alert">${IC('bell')}<div><b>${dueN.length} callback${dueN.length > 1 ? 's' : ''} due</b><br><a href="#callbacks" style="color:#86AAFF">Open callbacks</a></div></div>` : ''}
      <div class="kv"><span>Do-not-call numbers</span><b>${ST.dnc.length}</b></div><div class="kv"><span>Skipped: on DNC list</span><b>${by('dnc')}</b></div><div class="kv"><span>Skipped: contacted recently</span><b>${by('recent')}</b></div><div class="kv"><span>Outside calling hours</span><b>${by('hours')} blocked, ${defer} deferred</b></div>
      <div class="kv"><span>Hours guard</span><b>${ST.hoursOn ? ST.hoursStart + ':00 - ' + ST.hoursEnd + ':00 local' : 'Off'}</b></div></div></div></div>`;
  $$('.queue li[data-id]', el).forEach(li => li.onclick = () => openLead(+li.dataset.id));
  const mb = $('#more', el); if (mb) mb.onclick = () => openLead(id);
  $$('[data-disp]', el).forEach(b => b.onclick = () => setOutcome(id, b.dataset.disp));
}
async function setOutcome(id, d) {
  const r = applyDispositionData(ST.notes, ST.dnc, id, ST.nums[id], d); await set({ notes: r.notes, dnc: r.dnc }); toast('Marked as ' + d + (d === 'Do not call' ? ' and added to DNC list' : ''));
}

// ---------- LEADS ----------
function renderLeads() {
  const el = $('#view');
  if (!ST.leads.length) { el.innerHTML = dropzone(); bindDZ(el); return; }
  const f = ST.filters || {}, states = [...new Set(ST.cards.map(c => c.state).filter(Boolean))].sort(), trucks = [...new Set(ST.cards.map(c => c.truck))].sort();
  const chip = (g, v, on) => `<button class="chip ${on ? 'on' : ''}" data-g="${g}" data-v="${esc(v)}">${esc(v)}</button>`;
  el.innerHTML = `<div class="tools"><div class="search">${IC('search', 'sm')}<input class="in" id="q" placeholder="Search company, number, officer, any field" value="${esc(FS.q)}"></div>
    <div class="chips">${['all', 'pending', 'called', 'blocked'].map(s => `<button class="chip ${FS.status === s ? 'on' : ''}" data-s="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div><span class="sp"></span>
    <button class="btn" id="bQ">${IC('filter', 'sm')}Build queue</button><button class="btn" id="bImp">${IC('upload', 'sm')}Import CSV</button><button class="btn pri" id="bExp">${IC('download', 'sm')}Export results</button></div>
  <div class="card" id="qb" style="margin-bottom:16px;display:${FS.open ? 'block' : 'none'}"><h3>${IC('target')}Queue builder<span class="sp"></span><span class="note">Only leads that are not yet called and not on the DNC list are queued</span></h3>
    <div class="grid c3"><div><div class="lab">States</div><div class="chips" style="margin-top:8px">${states.map(s => chip('states', s, (f.states || []).includes(s))).join('') || '<span class="note">No state data</span>'}</div></div>
    <div><div class="lab">Truck type</div><div class="chips" style="margin-top:8px">${trucks.map(s => chip('trucks', s, (f.trucks || []).includes(s))).join('')}</div></div>
    <div><div class="lab">Authority age (months) and score</div><div class="row" style="margin-top:8px"><input class="in" id="fMin" type="number" min="0" placeholder="Min" value="${f.minMo ?? ''}" style="width:80px"><input class="in" id="fMax" type="number" min="0" placeholder="Max" value="${f.maxMo ?? ''}" style="width:80px"><input class="in" id="fSc" type="number" min="0" max="100" placeholder="Min score" value="${f.minScore ?? ''}" style="width:100px"></div>
    <div class="lab" style="margin-top:12px">Order</div><select class="in" id="fSort" style="margin-top:8px;width:100%"><option value="file" ${ST.sortMode === 'file' ? 'selected' : ''}>File order</option><option value="score" ${ST.sortMode === 'score' ? 'selected' : ''}>Lead score, highest first</option></select></div></div>
    <div class="row" style="margin-top:14px"><button class="btn pri" id="bApply">Apply to queue</button><button class="btn" id="bClr">Clear filters</button><span class="note" id="qCount"></span></div></div>
  <div class="tw"><table><thead><tr><th>#</th><th>Number</th><th>Company</th><th>Score</th><th>Truck</th><th>Authority</th><th class="hide-s">Location</th><th>Status</th><th class="hide-s">Outcome</th><th class="hide-s">Callback</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  $('#q', el).oninput = e => { FS.q = e.target.value; renderRows(); };
  $$('[data-s]', el).forEach(b => b.onclick = () => { FS.status = b.dataset.s; $$('[data-s]', el).forEach(x => x.classList.toggle('on', x === b)); renderRows(); });
  $('#bImp', el).onclick = () => $('#fCsv').click(); $('#bExp', el).onclick = () => exportCSV();
  $('#bQ', el).onclick = () => { FS.open = !FS.open; $('#qb').style.display = FS.open ? 'block' : 'none'; updateQCount(); };
  $$('#qb .chip', el).forEach(b => b.onclick = () => { const g = b.dataset.g, cur = new Set((ST.filters || {})[g] || []); cur.has(b.dataset.v) ? cur.delete(b.dataset.v) : cur.add(b.dataset.v); ST.filters = { ...(ST.filters || {}), [g]: [...cur] }; b.classList.toggle('on'); updateQCount(); });
  const num = (id, k) => $(id, el).oninput = e => { ST.filters = { ...(ST.filters || {}), [k]: e.target.value }; updateQCount(); }; num('#fMin', 'minMo'); num('#fMax', 'maxMo'); num('#fSc', 'minScore');
  $('#fSort', el).onchange = e => set({ sortMode: e.target.value }); $('#bClr', el).onclick = () => { ST.filters = {}; set({ filters: {} }); renderLeads(); };
  $('#bApply', el).onclick = async () => { const order = buildOrder(ST.sortMode, ST.filters); if (!order.length) return toast('No leads match those filters'); await set({ order, index: 0, running: false, filters: ST.filters }); toast('Queue built: ' + order.length + ' leads. Dialing is paused.'); renderRows(); };
  renderRows(); updateQCount();
}
function updateQCount() { const q = $('#qCount'); if (q) q.textContent = buildOrder(ST.sortMode, ST.filters).length + ' leads match'; }
function renderRows() {
  const tb = $('#tb'); if (!tb) return; const o = ord(), pos = new Map(o.map((id, i) => [id, i])), q = FS.q.toLowerCase(), rows = [], cur = curId();
  ST.leads.forEach((l, i) => {
    const s = stat(i), c = ST.cards[i] || {};
    if (FS.status === 'pending' && !(s.k === 'pending' || s.k === 'next' || s.k === 'deferred')) return;
    if (FS.status === 'called' && !['called', 'noanswer', 'skipped'].includes(s.k)) return;
    if (FS.status === 'blocked' && s.k !== 'blocked') return;
    if (q && !(l.n + ' ' + l.name + ' ' + Object.values(l.f).join(' ')).toLowerCase().includes(q)) return;
    const n = note(i), isCur = i === cur;
    rows.push(`<tr data-id="${i}" class="${isCur ? 'cur' : ''} ${['called', 'noanswer', 'skipped', 'blocked'].includes(s.k) ? 'done' : ''}"><td class="mono">${pos.has(i) ? pos.get(i) + 1 : '-'}</td><td class="mono">${esc(fmtNum(l.n))}</td><td>${esc(c.name || l.name || '-')}</td><td>${scoreBadge(c)}</td><td>${esc(c.truck || '-')}</td><td class="mono">${esc(c.date ? authTxt(c) : '-')}</td><td class="hide-s">${esc([c.city, c.state].filter(Boolean).join(', ') || '-')}</td><td>${badge(i)}</td><td class="hide-s">${n.disp ? `<span class="badge">${esc(n.disp)}</span>` : '<span style="color:var(--mu2)">-</span>'}</td><td class="hide-s mono">${n.cb && !n.cbDone ? fmtDT(n.cb) : '-'}</td></tr>`);
  });
  tb.innerHTML = rows.join('') || '<tr><td colspan="10" class="empty">No leads match.</td></tr>';
  $$('tr[data-id]', tb).forEach(tr => tr.onclick = () => openLead(+tr.dataset.id));
  const cr = $('tr.cur', tb); if (cr && ST.follow && lastScroll !== ST.index) { lastScroll = ST.index; cr.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

// ---------- lead drawer ----------
function openLead(id) {
  const l = ST.leads[id]; if (!l) return; openId = id; const c = ST.cards[id], n = note(id), r = res(id), dnc = ST.dnc.includes(ST.nums[id]);
  $('#drawer').innerHTML = `<div class="row" style="align-items:flex-start"><div><div class="lab">Lead ${id + 1}</div><h2 class="mono" style="margin:2px 0">${esc(fmtNum(l.n))}</h2><div style="color:var(--mu);font-weight:550">${esc((c && c.name) || l.name)}</div></div><span class="sp"></span><button class="btn sm" id="dx">${IC('x', 'sm')}</button></div>
  <div class="row" style="margin:12px 0">${badge(id)}${scoreBadge(c)}${dnc ? '<span class="badge blocked">On DNC list</span>' : ''}<span class="note">${r.d != null ? 'Last call ' + mmss(r.d) + (r.td ? ', talk ' + mmss(r.td) : '') : ''}</span></div>
  ${carrierBlock(c, id)}
  <div class="lab" style="margin:20px 0 8px">Outcome</div><div class="chips" id="dch">${DISP.map(d => `<button class="chip ${n.disp === d ? 'on' : ''}" data-d="${d}">${d}</button>`).join('')}</div>
  <div class="lab" style="margin:20px 0 8px">Callback</div><div class="row"><input class="in" type="datetime-local" id="cbT" value="${n.cb ? toLocalInput(n.cb) : ''}"><button class="btn sm" id="cbS">Schedule</button><button class="btn sm ghost" id="cbC">Clear</button></div>
  <div class="lab" style="margin:20px 0 8px">Notes</div><textarea class="in" id="nt" placeholder="Truck details, callback context, anything useful">${esc(n.note || '')}</textarea>
  <details style="margin-top:16px"><summary class="lab" style="cursor:pointer">All CSV fields</summary><div class="fields" style="grid-template-columns:1fr 1fr">${Object.entries(l.f).map(([k, v]) => `<div class="fld"><span class="lab">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div></details>
  <div class="row" style="margin-top:20px"><button class="btn pri" id="dN">${IC('phone', 'sm')}Dial this next</button><button class="btn dng" id="dD">${IC('ban', 'sm')}${dnc ? 'Remove from DNC' : 'Add to DNC'}</button></div>`;
  $('#drawer').classList.add('open'); $('#scrim').classList.add('open');
  const save = patch => { const notes = { ...ST.notes, [id]: { ...(ST.notes[id] || {}), ...patch } }; set({ notes }); };
  $('#dx').onclick = closeDrawer;
  $$('#dch .chip').forEach(b => b.onclick = () => { const d = b.dataset.d; if (note(id).disp === d) { save({ disp: '' }); $$('#dch .chip').forEach(x => x.classList.remove('on')); } else { setOutcome(id, d); $$('#dch .chip').forEach(x => x.classList.toggle('on', x === b)); if (d === 'Callback') $('#cbT').value = toLocalInput(defaultCallbackTime()); } });
  $('#cbS').onclick = () => { const v = $('#cbT').value; if (!v) return toast('Pick a date and time'); save({ cb: new Date(v).getTime(), cbDone: false }); toast('Callback scheduled'); };
  $('#cbC').onclick = () => { save({ cb: null, cbDone: false }); $('#cbT').value = ''; };
  let t; $('#nt').oninput = e => { clearTimeout(t); t = setTimeout(() => save({ note: e.target.value }), 400); };
  $('#dN').onclick = async () => { const active = ['dialing', 'ringing', 'oncall'].includes(res(curId()).s); const r2 = queueNextOrder(ord(), ST.index, id, active); await set({ order: r2.order, index: r2.index }); closeDrawer(); toast('Lead ' + (id + 1) + ' will be dialed next'); };
  $('#dD').onclick = async () => { const num = ST.nums[id]; const dnc2 = ST.dnc.includes(num) ? ST.dnc.filter(x => x !== num) : [...ST.dnc, num]; await set({ dnc: dnc2 }); openLead(id); };
}
function closeDrawer() { openId = null; $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); }
$('#scrim').onclick = closeDrawer;

// ---------- CALLBACKS ----------
function renderCallbacks() {
  const el = $('#view'), now = Date.now(), items = Object.entries(ST.notes).filter(([, n]) => n.cb).map(([id, n]) => ({ id: +id, ...n }));
  const due = items.filter(n => !n.cbDone && n.cb <= now).sort((a, b) => a.cb - b.cb), up = items.filter(n => !n.cbDone && n.cb > now).sort((a, b) => a.cb - b.cb), dn = items.filter(n => n.cbDone).sort((a, b) => b.cb - a.cb).slice(0, 20);
  const tbl = (arr, title, ic) => `<div class="card" style="margin-bottom:16px"><h3>${IC(ic)}${title}<span class="badge">${arr.length}</span></h3>${arr.length ? `<div class="tw" style="box-shadow:none;max-height:none"><table><thead><tr><th>Company</th><th>Number</th><th>Scheduled</th><th></th></tr></thead><tbody>${arr.map(n => { const c = ST.cards[n.id] || {}; return `<tr data-id="${n.id}" style="cursor:default"><td>${esc(c.name || (ST.leads[n.id] || {}).name || '-')}</td><td class="mono">${esc(fmtNum(ST.nums[n.id] || ''))}</td><td><input class="in cbt" type="datetime-local" value="${toLocalInput(n.cb)}" data-id="${n.id}"></td><td><div class="row" style="justify-content:flex-end"><button class="btn sm" data-a="next" data-id="${n.id}">${IC('phone', 'sm')}Dial next</button><button class="btn sm" data-a="done" data-id="${n.id}">${IC('check', 'sm')}Done</button><button class="btn sm ghost" data-a="open" data-id="${n.id}">Details</button></div></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="note">Nothing here.</p>'}</div>`;
  el.innerHTML = (!ST.leads.length ? '<div class="empty">Import a list first.</div>' : tbl(due, 'Due now', 'bell') + tbl(up, 'Upcoming', 'cal') + (dn.length ? tbl(dn, 'Completed', 'check') : ''));
  $$('.cbt', el).forEach(i => i.onchange = () => { const id = +i.dataset.id; set({ notes: { ...ST.notes, [id]: { ...note(id), cb: new Date(i.value).getTime(), cbDone: false } } }); });
  $$('[data-a]', el).forEach(b => b.onclick = async () => { const id = +b.dataset.id, a = b.dataset.a;
    if (a === 'open') return openLead(id);
    if (a === 'done') return set({ notes: { ...ST.notes, [id]: { ...note(id), cbDone: true } } });
    const active = ['dialing', 'ringing', 'oncall'].includes(res(curId()).s), r = queueNextOrder(ord(), ST.index, id, active);
    await set({ order: r.order, index: r.index, notes: { ...ST.notes, [id]: { ...note(id), cbDone: true } } }); toast('Queued as the next call'); });
}

// ---------- ANALYTICS ----------
function bars(vals, labels, alt, fmt) {
  const mx = Math.max(...vals, 1);
  return `<div class="bars">${vals.map((v, i) => `<div class="b ${alt ? 'alt' : ''}" title="${esc(labels[i])}: ${fmt ? fmt(v) : v}"><em>${v ? (fmt ? fmt(v) : v) : ''}</em><i style="height:${v / mx * 78}%"></i><span>${esc(labels[i])}</span></div>`).join('')}</div>`;
}
function hbar(label, v, max, txt) { return `<div class="hb"><span>${esc(label)}</span><div class="t"><i style="width:${max ? v / max * 100 : 0}%"></i></div><b>${txt ?? v}</b></div>`; }
function renderAnalytics() {
  const el = $('#view'), log = ST.log, t0 = dayStart();
  if (!log.length && !ST.leads.length) { el.innerHTML = '<div class="empty">Analytics appear after your first calls.</div>'; return; }
  const hrs = Array.from({ length: 15 }, (_, i) => i + 7), hl = h => (h % 12 || 12) + (h < 12 ? 'a' : 'p');
  const today = hrs.map(h => log.filter(l => l.t >= t0 && new Date(l.t).getHours() === h).length);
  const days = Array.from({ length: 7 }, (_, i) => 6 - i), d7 = days.map(o => log.filter(l => l.t >= dayStart(-o) && l.t < dayStart(-o + 1)).length), dl = days.map(o => new Date(dayStart(-o)).toLocaleDateString([], { weekday: 'short' }));
  const rate = hrs.map(h => { const L = log.filter(l => !l.imp && new Date(l.t).getHours() === h); return L.length >= 3 ? Math.round(L.filter(l => l.a).length / L.length * 100) : 0; });
  const cnt = hrs.map(h => log.filter(l => new Date(l.t).getHours() === h).length);
  const bestI = rate.indexOf(Math.max(...rate)), best = Math.max(...rate) ? hl(hrs[bestI]) + ' (' + rate[bestI] + '% connect)' : 'Not enough data yet';
  const calls = log.length, realN = log.filter(l => !l.imp).length, talk = log.reduce((a, l) => a + (l.td || 0), 0), conn = log.filter(l => l.a).length;
  const outs = DISP.map(d => [d, Object.values(ST.notes).filter(n => n.disp === d).length]), mo = Math.max(...outs.map(o => o[1]), 1);
  el.innerHTML = `<div class="grid k5" style="margin-bottom:16px">${kpi('Total calls', calls, 'All time on this device')}${kpi('Connected', conn, realN ? Math.round(conn / realN * 100) + '% connect rate (tracked calls)' : 'No connect data yet')}${kpi('Talk time', mmss(talk), 'Average ' + mmss(conn ? talk / conn : 0))}${kpi('Best time to call', best.includes('(') ? best.split(' ')[0] : '-', best.includes('(') ? best.slice(best.indexOf('(')) : 'Needs 3+ calls in an hour')}${kpi('Callbacks open', Object.values(ST.notes).filter(n => n.cb && !n.cbDone).length, 'Scheduled follow-ups')}</div>
  <div class="grid c2e" style="margin-bottom:16px"><div class="card"><h3>${IC('chart')}Calls today by hour</h3>${bars(today, hrs.map(hl))}</div><div class="card"><h3>${IC('chart')}Last 7 days</h3>${bars(d7, dl, true)}</div></div>
  <div class="grid c2e"><div class="card"><h3>${IC('clock')}Best time to call<span class="sp"></span><span class="note">Connect rate by hour, hours with 3+ calls</span></h3>${bars(rate, hrs.map(hl), true, v => v + '%')}<div class="note" style="margin-top:8px">Calls per hour: ${cnt.map((c, i) => hl(hrs[i]) + ' ' + c).join(' / ')}</div></div>
  <div class="card"><h3>${IC('target')}Outcomes</h3>${outs.map(([d, n]) => hbar(d, n, mo)).join('')}</div></div>`;
}

// ---------- LOG ----------
function renderLog() {
  const el = $('#view'), rows = ST.log.slice().reverse().slice(0, 600);
  el.innerHTML = `<div class="tools"><span class="note">${ST.log.length} calls recorded. Showing the latest ${rows.length}.</span><span class="sp"></span><button class="btn dng" id="bClr">${IC('trash', 'sm')}Clear log</button></div>
  <div class="tw"><table><thead><tr><th>Time</th><th>Number</th><th>Company</th><th>Result</th><th>Talk time</th><th>Total</th><th>Outcome</th></tr></thead><tbody>${rows.map(l => { const c = ST.cards[l.i] || {}, n = note(l.i); return `<tr style="cursor:default"><td>${fmtDT(l.t)}</td><td class="mono">${esc(fmtNum(l.n))}</td><td>${esc(c.name || l.nm || '-')}</td><td><span class="badge ${l.s}">${{ called: 'Called', noanswer: 'No answer', skipped: 'Skipped' }[l.s] || l.s}</span></td><td class="mono">${l.a ? mmss(l.td) : (l.imp ? 'imported' : '-')}</td><td class="mono">${mmss(l.d)}</td><td>${esc(n.disp || '-')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">No calls yet.</td></tr>'}</tbody></table></div>`;
  $('#bClr', el).onclick = () => { if (confirm('Clear the call log? Dial history used for "contacted recently" is kept.')) set({ log: [] }); };
}

// ---------- DO NOT CALL ----------
function parseNumbers(text) { return [...new Set(String(text).split(/[\n,;\t]+/).map(normalizeNumber).filter(Boolean))]; }
function renderDnc() {
  const el = $('#view'), name = n => { const i = ST.nums.indexOf(n); return i >= 0 ? ((ST.cards[i] || {}).name || ST.leads[i].name) : ''; };
  el.innerHTML = `<div class="grid c2"><div class="card"><h3>${IC('ban')}Blocked numbers<span class="badge">${ST.dnc.length}</span></h3>${ST.dnc.length ? `<div class="tw" style="box-shadow:none;max-height:460px"><table><thead><tr><th>Number</th><th>Company</th><th></th></tr></thead><tbody>${ST.dnc.map(n => `<tr style="cursor:default"><td class="mono">${esc(fmtNum(n))}</td><td>${esc(name(n) || '-')}</td><td style="text-align:right"><button class="btn sm ghost" data-rm="${esc(n)}">${IC('x', 'sm')}Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="note">No numbers yet. Marking a lead "Do not call" adds it here automatically.</p>'}</div>
  <div class="card"><h3>${IC('plus')}Add numbers</h3><textarea class="in" id="dIn" placeholder="Paste numbers, one per line or comma separated" style="width:100%;min-height:130px"></textarea>
  <div class="row" style="margin-top:12px"><button class="btn pri" id="dAdd">Add to list</button><button class="btn" id="dImp">${IC('upload', 'sm')}Import file</button><button class="btn" id="dExp" ${ST.dnc.length ? '' : 'disabled'}>${IC('download', 'sm')}Export</button></div>
  <p class="note" style="margin-top:14px">The dialer never calls these numbers while "Enforce Do Not Call list" is on in Settings. The list is kept when you import a new lead file.</p></div></div>`;
  $('#dAdd', el).onclick = async () => { const add = parseNumbers($('#dIn').value); if (!add.length) return toast('No valid numbers found'); await set({ dnc: [...new Set([...ST.dnc, ...add])] }); toast(add.length + ' number(s) added'); };
  $('#dImp', el).onclick = () => $('#fDnc').click();
  $('#dExp', el).onclick = () => download('dialflow-dnc.csv', 'number\n' + ST.dnc.join('\n'), 'text/csv');
  $$('[data-rm]', el).forEach(b => b.onclick = () => set({ dnc: ST.dnc.filter(x => x !== b.dataset.rm) }));
}
$('#fDnc').onchange = async e => { const f = e.target.files[0]; if (!f) return; const add = parseNumbers(await f.text()); await set({ dnc: [...new Set([...ST.dnc, ...add])] }); toast(add.length + ' numbers imported'); e.target.value = ''; };

// ---------- data helpers ----------
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }
function resultRows() {
  const cols = [...ST.columns, 'Status', 'Outcome', 'Callback', 'Notes', 'Talk time (s)', 'Total (s)', 'Called at', 'Lead score'];
  const rows = ST.leads.map((l, i) => { const r = res(i), n = note(i), s = stat(i); return [...ST.columns.map(c => l.f[c] || ''), s.t, n.disp || '', n.cb ? new Date(n.cb).toISOString() : '', (n.note || '').replace(/\n/g, ' | '), r.td ?? '', r.d ?? '', r.t ? new Date(r.t).toISOString() : '', (ST.cards[i] || {}).score ?? '']; });
  return { cols, rows };
}
function exportCSV() { const { cols, rows } = resultRows(), q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"'; download('dialflow-results.csv', [cols, ...rows].map(r => r.map(q).join(',')).join('\n'), 'text/csv'); toast('Results exported'); }
async function copySheets() { const { cols, rows } = resultRows(); const tsv = [cols, ...rows].map(r => r.map(v => String(v ?? '').replace(/[\t\n]/g, ' ')).join('\t')).join('\n'); try { await navigator.clipboard.writeText(tsv); toast('Copied. Paste into Google Sheets (Ctrl+V)'); } catch (e) { download('dialflow-sheets.tsv', tsv, 'text/tab-separated-values'); toast('Clipboard blocked, downloaded a TSV instead'); } }
async function backupJSON() { const all = await chrome.storage.local.get(null); ['hb', 'msg', 'diag', 'phase', 'owner', 'backups', 'voiceLast'].forEach(k => delete all[k]); download('dialflow-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(all), 'application/json'); toast('Backup downloaded'); }
$('#fRestore').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text()), imp = d.app === 'jds-call-tracker' ? convertTracker(d) : d.format === 'dialflow-import' ? d : null;
    if (imp) {                                   // old call-tracker data: merge, never overwrite
      const r = mergeImport({ log: ST.log, history: ST.history }, imp);
      await set({ log: r.log, history: r.history, ...(imp.goal && ST.goal === CFG_DEFAULTS.goal ? { goal: imp.goal } : {}) });
      if (ST.leads.length) await recomputeCards();
      toast(r.added + ' past calls imported'); await offerResume(); return;
    }
    if (!d.leads && !d.dnc) throw 0;
    if (!confirm('Restore this backup? It replaces your current data.')) return;
    await chrome.storage.local.set(d); toast('Backup restored');
  } catch (err) { toast('That file is not a DialFlow backup or a call-tracker export'); }
};
// mark leads that history says were already dialed, and rebuild the queue so dialing resumes where you stopped
function dialedLeadIds() { return ST.leads.map((l, i) => i).filter(i => { const h = ST.history[ST.nums[i]], r = res(i); return h && h.c && !r.s; }); }
async function markDialed(ids) {
  const results = { ...ST.results }; ids.forEach(i => { const h = ST.history[ST.nums[i]]; results[i] = { s: 'called', d: 0, td: 0, t: h.t, e: h.t, a: false, imp: true }; });
  await set({ results }); await set({ order: buildOrder(ST.sortMode, ST.filters || {}), index: 0, running: false });
}
async function offerResume() {
  const ids = dialedLeadIds(); if (!ids.length) return;
  if (confirm(ids.length + ' leads in your current list were already dialed according to your history.\n\nMark them as Called and rebuild the queue so dialing resumes with the first lead not yet dialed?')) { await markDialed(ids); toast(ids.length + ' leads marked as called. Queue rebuilt.'); }
}

// ---------- SETTINGS ----------
const LANGS = [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'], ['en-PK', 'English (Pakistan)'], ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)'], ['es-US', 'Spanish (US)'], ['hi-IN', 'Hindi'], ['ur-PK', 'Urdu']];
const row2 = (t, d, ctl) => `<div><div>${t}</div>${d ? `<div class="d">${d}</div>` : ''}</div><div>${ctl}</div>`;
const numIn = (k, v, min = 0, step = 1) => `<input class="in" type="number" data-cfg="${k}" min="${min}" step="${step}" value="${v}">`;
const swc = (k, on) => `<label class="sw"><input type="checkbox" data-cfg="${k}" ${on ? 'checked' : ''}><span></span></label>`;
const STABS = [['dialing', 'Dialing', 'phone'], ['compliance', 'Compliance', 'shield'], ['targeting', 'Targeting', 'target'], ['voice', 'Voice', 'mic'], ['data', 'Data', 'db'], ['look', 'Appearance', 'eye']];
function lastHeard() { const l = ST.voiceLast; if (!l) return '<span class="note">Nothing heard yet. Turn the mic on from the widget on your Voice tab.</span>'; return `"${esc(l.text)}" ${l.action ? '&rarr; <b style="color:var(--ac2)">' + esc(l.out || l.action) + '</b>' : '<span class="note">(no command matched)</span>'} <span class="note">${new Date(l.ts).toLocaleTimeString()}</span>`; }
function tabDialing() {
  const a = ST.answerStat, ok = a.calls ? Math.round(a.seen / a.calls * 100) : null;
  return `<div class="grid c2e"><div class="card"><h3>${IC('phone')}Call flow</h3><div class="set">
   ${row2('Pause between calls', 'Seconds to wait after a call ends', numIn('delay', ST.delay, 0, .5))}
   ${row2('Auto hang up after', 'Seconds from the moment the call starts. 0 = never. Use it to skip voicemail greetings', numIn('maxCall', ST.maxCall))}
   ${row2('Hang up if nobody answers', 'Seconds of ringing before hanging up. 0 = off. Needs working answer detection', numIn('ringLimit', ST.ringLimit))}
   ${row2('Give up if the call never starts', 'Seconds before a lead is marked Skipped', numIn('startTimeout', ST.startTimeout, 5))}
   ${row2('Re-queue unanswered leads', 'Unanswered leads (from the ring limit) go to the end of the queue', swc('requeueOn', ST.requeueOn))}
   ${row2('Maximum retries per lead', '', numIn('requeueMax', ST.requeueMax, 0))}</div></div>
  <div class="grid" style="align-content:start"><div class="card"><h3>${IC('bell')}Alerts and goals</h3><div class="set">
   ${row2('Answer chime', 'Sound when a line connects or a callback is due', swc('chime', ST.chime))}
   ${row2('Daily call goal', 'Shown on the Dialer page', numIn('goal', ST.goal, 1))}
   ${row2('Follow dialer in lead list', 'Scroll to the lead being dialed', swc('follow', ST.follow))}</div>
   <div style="margin-top:14px"><button class="btn sm" id="tChime">${IC('bell', 'sm')}Test chime</button></div></div>
  <div class="card"><h3>${IC('zap')}Answer detection</h3><p class="note" style="margin:0 0 8px">DialFlow knows a call connected when Google Voice shows the running call timer. This powers the chime, talk time and the no-answer rule.</p><div class="kv"><span>Timer detected on</span><b id="ansStat">${a.calls ? a.seen + ' of ' + a.calls + ' calls (' + ok + '%)' : 'No calls yet'}</b></div></div></div></div>`;
}
function tabCompliance() {
  return `<div class="grid c2e"><div class="card"><h3>${IC('clock')}Calling hours guard</h3><div class="set">
   ${row2('Enforce calling hours', 'Uses each carrier\'s local time from its state', swc('hoursOn', ST.hoursOn))}
   ${row2('Earliest hour', '24-hour clock, local to the carrier', numIn('hoursStart', ST.hoursStart, 0))}
   ${row2('Latest hour', 'No dials at or after this hour', numIn('hoursEnd', ST.hoursEnd, 1))}
   ${row2('When outside hours', '', `<select class="in" data-cfg="hoursMode"><option value="defer" ${ST.hoursMode === 'defer' ? 'selected' : ''}>Move to end of queue</option><option value="skip" ${ST.hoursMode === 'skip' ? 'selected' : ''}>Skip permanently</option></select>`)}</div>
   <p class="note" style="margin-top:14px">States that span two time zones use their larger zone, so keep a small margin. Leads without a state are dialed normally.</p></div>
  <div class="grid" style="align-content:start"><div class="card"><h3>${IC('ban')}Do not call</h3><div class="set">${row2('Enforce Do Not Call list', 'Never dial numbers on the list (' + ST.dnc.length + ' now)', swc('dncOn', ST.dncOn))}</div></div>
  <div class="card"><h3>${IC('refresh')}Already contacted</h3><div class="set">${row2('Skip recently dialed numbers', 'Uses your dial history, kept across lists', swc('recentOn', ST.recentOn))}${row2('Within the last (days)', '', numIn('recentDays', ST.recentDays, 1))}</div></div></div></div>`;
}
function tabTargeting() {
  const p = { ...PROFILE_DEFAULT, ...ST.profile }, cues = ST.cues || CUES_DEFAULT;
  return `<div class="grid c2e"><div class="card"><h3>${IC('target')}Lead scoring profile<span class="sp"></span><span class="note">Scores 0-100; Hot 70+, Warm 45+</span></h3>
   <div class="lab">Preferred truck types (+40)</div><div class="chips" style="margin:8px 0 16px">${TRUCKS.map(t => `<button class="chip ${p.trucks.includes(t) ? 'on' : ''}" data-truck="${esc(t)}">${esc(t)}</button>`).join('')}</div>
   <div class="set">${row2('Ideal authority age, from (months)', '+25 when inside the range', `<input class="in" type="number" min="0" id="pMin" value="${p.minMo}">`)}${row2('Ideal authority age, to (months)', '', `<input class="in" type="number" min="0" id="pMax" value="${p.maxMo}">`)}${row2('Small fleet up to (trucks)', '+15', `<input class="in" type="number" min="1" id="pFleet" value="${p.fleetMax}">`)}${row2('Preferred states', 'Comma separated, +10', `<input class="in" id="pStates" value="${esc(p.states.join(', '))}" style="width:150px">`)}</div></div>
  <div class="card"><h3>${IC('note')}Pitch cues<span class="sp"></span><button class="btn sm" id="cuesReset">Reset</button></h3><p class="note" style="margin:0 0 10px">One line shown on the card by truck type and authority age. Edit them to match your pitch.</p>
   ${Object.entries(cues.age).map(([k, v]) => `<div class="lab" style="margin-top:10px">Authority: ${k === 'new' ? 'under 6 months' : k === 'young' ? '6 to 12 months' : '12 months or more'}</div><input class="in cue-in" data-g="age" data-k="${k}" value="${esc(v)}" style="width:100%">`).join('')}
   <div class="lab" style="margin-top:14px">Truck type</div>${Object.entries(cues.truck).map(([k, v]) => `<div class="row" style="margin-top:6px;flex-wrap:nowrap"><span style="width:150px;flex:none;color:var(--mu);font-size:12px">${k === 'default' ? 'Any other type' : esc(k)}</span><input class="in cue-in" data-g="truck" data-k="${esc(k)}" value="${esc(v)}" style="flex:1"></div>`).join('')}</div></div>`;
}
function tabVoice() {
  const v = voiceCfg(ST.voice);
  return voiceLockCard() + `<div class="card" style="margin-top:16px"><div class="row"><h3 style="margin:0">${IC('mic')}Voice commands</h3><span class="badge next">beta</span><span class="sp"></span><span class="lab">Mic</span>${sw('vOn', v.enabled)}</div>
  <p class="note" style="margin:8px 0 16px">Control the dialer hands-free. DialFlow provides the actions, you choose the phrase for each. Separate several phrases for one action with commas.</p>
  <div class="grid c3" style="margin-bottom:16px"><div><div class="lab">Language / accent</div><select class="in" id="vLang" style="width:100%;margin-top:6px">${LANGS.map(([c, n]) => `<option value="${c}" ${v.lang === c ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
   <div><div class="lab">Matching</div><select class="in" id="vMode" style="width:100%;margin-top:6px"><option value="exact" ${v.mode === 'exact' ? 'selected' : ''}>Exact phrase only (safest)</option><option value="contains" ${v.mode === 'contains' ? 'selected' : ''}>Phrase anywhere in a sentence</option></select></div>
   <div><div class="lab">Wake word (optional)</div><input class="in" id="vWake" placeholder="e.g. dialflow" value="${esc(v.wake)}" style="width:100%;margin-top:6px"></div></div>
  <div class="set" style="margin-bottom:18px">${row2('While a call is connected', 'Protects your conversation from accidental commands', `<select class="in" data-cfg="voiceInCall"><option value="all" ${ST.voiceInCall === 'all' ? 'selected' : ''}>Keep everything on</option><option value="limited" ${ST.voiceInCall === 'limited' ? 'selected' : ''}>Only end call, skip and notes</option><option value="wake" ${ST.voiceInCall === 'wake' ? 'selected' : ''}>Require the wake word</option><option value="off" ${ST.voiceInCall === 'off' ? 'selected' : ''}>Turn commands off</option></select>`)}
   ${row2('Fast response', 'Act about 0.4 s after the phrase is heard clearly', sw('vFast', v.fast))}</div>
  <div class="set" style="grid-template-columns:1fr 1.2fr">${VOICE_ACTIONS.map(([k, lab]) => `<div>${lab}</div><input class="in vph" data-k="${k}" value="${esc((v.cmds[k] || []).join(', '))}" placeholder="(disabled)" style="width:100%">`).join('')}</div>
  <div class="card" style="background:var(--s2);margin-top:16px;padding:12px 14px"><div class="lab">Last heard</div><div id="vLast" style="margin-top:4px">${lastHeard()}</div></div>
  <div class="row" style="margin-top:14px"><button class="btn sm" id="vReset">Reset phrases to defaults</button></div>
  <p class="note" style="margin-top:14px">Use a headset so a prospect's voice cannot trigger commands, and pick the English variant closest to your accent. Chrome's speech service processes the audio (it is sent to Google). If call audio ever sounds worse with the mic on, turn it off here or with the widget's mic button.</p></div>`;
}
function tabData() {
  const fields = FIELD_DEFS.map(([k, lab]) => `<div><div class="lab">${lab}</div><select class="in mapsel" data-k="${k}" style="width:100%;margin-top:5px"><option value="">None</option>${ST.columns.map(c => `<option ${ST.map[k] === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>`).join('');
  return `<div class="grid c2e"><div class="card"><h3>${IC('download')}Export</h3><div class="row"><button class="btn pri" id="xCsv" ${ST.leads.length ? '' : 'disabled'}>${IC('download', 'sm')}Results CSV</button><button class="btn" id="xSheets" ${ST.leads.length ? '' : 'disabled'}>${IC('copy', 'sm')}Copy for Google Sheets</button></div>
   <p class="note" style="margin-top:12px">Includes every CSV column plus status, outcome, callback, notes, talk time and lead score.</p>
   <h3 style="margin-top:22px">${IC('db')}Backup, restore and import</h3><p class="note" style="margin:0 0 10px">Also accepts an old call-tracker export. Its calls are merged into your log and history without touching anything else.</p><div class="row"><button class="btn" id="xBackup">${IC('download', 'sm')}Download backup</button><button class="btn" id="xRestore">${IC('upload', 'sm')}Restore or import file</button><button class="btn" id="xResume" ${ST.leads.length ? '' : 'disabled'}>${IC('refresh', 'sm')}Resume from history</button></div>
   <div class="lab" style="margin:18px 0 6px">Automatic backups (every 30 min, latest 5)</div>${ST.backups.length ? ST.backups.slice().reverse().map((b, i) => `<div class="kv"><span>${fmtDT(b.ts)} - ${b.leads} leads</span><button class="btn sm" data-rb="${ST.backups.length - 1 - i}">Restore</button></div>`).join('') : '<p class="note">None yet. The first one is created after 30 minutes with a list loaded.</p>'}</div>
  <div class="grid" style="align-content:start"><div class="card"><h3>${IC('list')}Column mapping</h3>${ST.columns.length ? `<p class="note" style="margin:0 0 12px">Which CSV column feeds each carrier field. Detected automatically; change any that look wrong.</p><div class="grid c2e" style="gap:10px">${fields}</div>` : '<p class="note">Import a CSV first.</p>'}</div>
  <div class="card"><h3>${IC('alert')}Danger zone</h3><div class="row"><button class="btn dng" id="xReset">Reset progress</button><button class="btn dng" id="xWipe">Delete all data</button></div></div></div></div>`;
}
function tabLook() { return `<div class="card" style="max-width:560px"><h3>${IC('eye')}Theme</h3><div class="set">${row2('Colour theme', '', `<select class="in" data-cfg="theme"><option value="dark" ${ST.theme === 'dark' ? 'selected' : ''}>Dark</option><option value="light" ${ST.theme === 'light' ? 'selected' : ''}>Light</option></select>`)}</div></div>`; }
function renderSettings() {
  const el = $('#view'), body = { dialing: tabDialing, compliance: tabCompliance, targeting: tabTargeting, voice: tabVoice, data: tabData, look: tabLook }[setTab]();
  el.innerHTML = `<div class="tabs">${STABS.map(([k, t, ic]) => `<a href="#settings" data-t="${k}" class="${setTab === k ? 'on' : ''}">${IC(ic, 'sm')}${t}</a>`).join('')}</div>${body}`;
  $$('.tabs a', el).forEach(a => a.onclick = e => { e.preventDefault(); setTab = a.dataset.t; renderSettings(); });
  bindSettings(el);
}
function bindSettings(el) {
  const ch = $('#tChime', el); if (ch) ch.onclick = () => { try { const c = new AudioContext(); [880, 1318].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; o.connect(g); g.connect(c.destination); const t = c.currentTime + i * .13; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.16, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .28); o.start(t); o.stop(t + .3); }); } catch (e) {} };
  // targeting
  const savePro = patch => { const p = { ...PROFILE_DEFAULT, ...ST.profile, ...patch }; set({ profile: p }); recomputeCards(); };
  $$('[data-truck]', el).forEach(b => b.onclick = () => { const p = { ...PROFILE_DEFAULT, ...ST.profile }, t = b.dataset.truck, s = new Set(p.trucks); s.has(t) ? s.delete(t) : s.add(t); b.classList.toggle('on'); savePro({ trucks: [...s] }); });
  [['#pMin', 'minMo'], ['#pMax', 'maxMo'], ['#pFleet', 'fleetMax']].forEach(([id, k]) => { const i = $(id, el); if (i) i.onchange = () => savePro({ [k]: +i.value || 0 }); });
  const ps = $('#pStates', el); if (ps) ps.onchange = () => savePro({ states: ps.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) });
  $$('.cue-in', el).forEach(i => i.onchange = () => { const c = JSON.parse(JSON.stringify(ST.cues || CUES_DEFAULT)); c[i.dataset.g][i.dataset.k] = i.value; set({ cues: c }); });
  const cr = $('#cuesReset', el); if (cr) cr.onclick = () => { set({ cues: null }); renderSettings(); };
  // voice
  const v0 = $('#vOn', el); if (v0) {
    const save = patch => { const v = { ...voiceCfg(ST.voice), ...patch }; set({ voice: v }); };
    bindVoiceLock(el);
    v0.onchange = e => save({ enabled: e.target.checked }); $('#vLang', el).onchange = e => save({ lang: e.target.value }); $('#vMode', el).onchange = e => save({ mode: e.target.value });
    $('#vFast', el).onchange = e => save({ fast: e.target.checked }); $('#vWake', el).onchange = e => save({ wake: e.target.value.trim() });
    $$('.vph', el).forEach(i => i.onchange = () => { const cmds = { ...voiceCfg(ST.voice).cmds }; cmds[i.dataset.k] = i.value.split(',').map(s => s.trim()).filter(Boolean); save({ cmds }); toast('Phrases saved'); });
    $('#vReset', el).onclick = () => { save({ cmds: voiceCfg(null).cmds }); renderSettings(); toast('Defaults restored'); };
  }
  // data
  $$('.mapsel', el).forEach(s => s.onchange = async () => { const map = { ...ST.map, [s.dataset.k]: s.value }; await set({ map }); recomputeCards(); toast('Mapping updated'); });
  const b = (id, fn) => { const x = $(id, el); if (x) x.onclick = fn; };
  b('#xResume', async () => { const ids = dialedLeadIds(); if (!ids.length) return toast('No leads in this list match your dial history'); await markDialed(ids); toast(ids.length + ' leads marked as called. Queue rebuilt.'); }); b('#xCsv', exportCSV); b('#xSheets', copySheets); b('#xBackup', backupJSON); b('#xRestore', () => $('#fRestore').click());
  $$('[data-rb]', el).forEach(x => x.onclick = async () => { const bk = ST.backups[+x.dataset.rb]; if (bk && confirm('Restore the backup from ' + fmtDT(bk.ts) + '?')) { await chrome.storage.local.set(bk.data); toast('Backup restored'); } });
  b('#xReset', async () => { if (confirm('Reset progress? Statuses, notes and callbacks are cleared; your list and DNC list stay.')) { await set({ results: {}, notes: {}, index: 0, running: false, order: buildOrder(ST.sortMode, {}) }); toast('Progress reset'); } });
  b('#xWipe', async () => { if (confirm('Delete ALL DialFlow data, including leads, DNC list and history?')) { await chrome.storage.local.clear(); toast('All data deleted'); } });
}
// generic data-cfg controls
document.addEventListener('change', e => {
  const t = e.target; if (!t.dataset || !t.dataset.cfg) return; const k = t.dataset.cfg;
  const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (parseFloat(t.value) || 0) : t.value; set({ [k]: v }); if (k === 'theme') applyTheme();
});

// ---------- routing and sync ----------
const applyTheme = () => document.documentElement.classList.toggle('light', ST.theme === 'light');
const RENDER = { dialer: renderDialer, leads: renderLeads, callbacks: renderCallbacks, analytics: renderAnalytics, log: renderLog, dnc: renderDnc, settings: renderSettings };
function show() { const h = (location.hash || '#dialer').slice(1); page = RENDER[h] ? h : 'dialer'; closeDrawer(); applyTheme(); renderShell(); RENDER[page](); }
const QUIET = ['hb', 'msg', 'diag', 'phase', 'owner', 'voiceLast', 'answerStat', 'backups'];
chrome.storage.onChanged.addListener(ch => {
  const keys = Object.keys(ch); for (const k of keys) ST[k] = ch[k].newValue === undefined ? DEF[k] : ch[k].newValue;
  applyTheme(); renderRailFoot();
  if (keys.every(k => QUIET.includes(k))) {
    renderTop(); const vl = $('#vLast'); if (vl) vl.innerHTML = lastHeard(); const as = $('#ansStat'); if (as) as.textContent = ST.answerStat.calls ? ST.answerStat.seen + ' of ' + ST.answerStat.calls + ' calls (' + Math.round(ST.answerStat.seen / ST.answerStat.calls * 100) + '%)' : 'No calls yet'; return;
  }
  renderShell();
  if (page === 'settings') { const a = document.activeElement, typing = a && a.closest && a.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(a.tagName); if (!typing && !VPBUSY && keys.some(k => ['voice', 'backups', 'leads', 'theme', 'columns', 'vprint', 'vpCfg'].includes(k))) renderSettings(); return; }
  if (page === 'leads') { if (keys.some(k => ['leads', 'columns', 'cards'].includes(k))) renderLeads(); else renderRows(); }
  else RENDER[page]();
  if (openId != null && keys.some(k => ['dnc'].includes(k))) openLead(openId);
});
setInterval(() => { const t = $('#timer'); if (t) t.textContent = timerText(); renderRailFoot(); }, 1000);
window.addEventListener('hashchange', show);
if (isSide) document.body.classList.add('side-mode');
chrome.storage.local.get(DEF).then(async s => {
  ST = { ...DEF, ...s };
  if (ST.leads.length && (!ST.cards.length || !Object.keys(ST.map).length)) { ST.map = detectMap(ST.columns); await recomputeCards(); await set({ map: ST.map }); }
  if (ST.leads.length && !ST.order.length) await set({ order: buildOrder(ST.sortMode, {}) });
  show();
});


// ---------- voice lock settings ----------
let VPBUSY = false, VPS = null;
const vpCfgNow = () => ({ on: false, sens: 'balanced', level: true, pitch: true, tone: true, ...(ST.vpCfg || {}) });
function voiceLockCard() {
  const p = ST.vprint, c = vpCfgNow();
  return `<div class="card" id="vlCard"><div class="row"><h3 style="margin:0">${IC('shield')}Voice lock</h3><span class="badge next">beta</span><span class="sp"></span><span class="lab">Only my voice</span>${sw('vlOn', c.on && !!p)}</div>
  <p class="note" style="margin:8px 0 14px">Stops other people, a speaker, music or a colleague sitting next to you from triggering commands. DialFlow learns your voice from a short sample and ignores anything that is not you.</p>
  <div class="kv"><span>Voice profile</span><b>${p ? 'Saved ' + fmtDT(p.ts) + ' (' + p.n + ' samples)' : 'Not recorded yet'}</b></div>
  <div class="row" style="margin:14px 0"><button class="btn pri" id="vlEnroll">${IC('mic', 'sm')}${p ? 'Record again' : 'Record my voice'}</button><button class="btn" id="vlTest" ${p ? '' : 'disabled'}>${IC('eye', 'sm')}Test the lock</button><button class="btn dng" id="vlDel" ${p ? '' : 'disabled'}>${IC('trash', 'sm')}Delete profile</button></div>
  <div id="vlPanel"></div>
  <div class="grid c3" style="margin-top:6px"><div><div class="lab">Strictness</div><select class="in" id="vlSens" style="width:100%;margin-top:6px"><option value="strict" ${c.sens === 'strict' ? 'selected' : ''}>Strict (fewest false accepts)</option><option value="balanced" ${c.sens === 'balanced' ? 'selected' : ''}>Balanced</option><option value="relaxed" ${c.sens === 'relaxed' ? 'selected' : ''}>Relaxed (fewest false rejects)</option></select></div>
   <div><div class="lab">Checks</div><label class="row" style="margin-top:8px;gap:8px"><input type="checkbox" id="vlLv" ${c.level ? 'checked' : ''}>Loudness at my mic</label><label class="row" style="gap:8px"><input type="checkbox" id="vlPt" ${c.pitch ? 'checked' : ''}>Pitch of my voice</label><label class="row" style="gap:8px"><input type="checkbox" id="vlTn" ${c.tone ? 'checked' : ''}>Tone of my voice</label></div>
   <div class="note" style="padding-top:20px">Wear a headset with the mic close to your mouth. Loudness is the strongest check: voices from the room or speakers arrive much quieter than yours. Each person records their own voice on their own computer.</div></div></div>`;
}
function bindVoiceLock(el) {
  const sv = patch => set({ vpCfg: { ...vpCfgNow(), ...patch } });
  const on = $('#vlOn', el); if (!on) return;
  on.onchange = e => { if (e.target.checked && !ST.vprint) { e.target.checked = false; return toast('Record your voice first'); } sv({ on: e.target.checked }); };
  $('#vlSens', el).onchange = e => sv({ sens: e.target.value });
  [['#vlLv', 'level'], ['#vlPt', 'pitch'], ['#vlTn', 'tone']].forEach(([id, k]) => $(id, el).onchange = e => sv({ [k]: e.target.checked }));
  $('#vlDel', el).onclick = async () => { if (confirm('Delete your voice profile?')) { await set({ vprint: null, vpCfg: { ...vpCfgNow(), on: false } }); renderSettings(); } };
  $('#vlEnroll', el).onclick = () => vpEnroll(el); $('#vlTest', el).onclick = () => vpTest(el);
}
function vpStop() { if (VPS) { try { VPS.cap && VPS.cap.cancel(); VPS.timer && clearInterval(VPS.timer); VPS.meter && VPS.meter.stop(); } catch (e) {} VPS = null; } VPBUSY = false; }
async function vpEnroll(el) {
  vpStop(); const panel = $('#vlPanel', el), cmds = voiceCfg(ST.voice).cmds, first = k => (cmds[k] && cmds[k][0]) || VOICE_ACTIONS.find(a => a[0] === k)[2][0];
  const seq = []; [first('endCall'), first('skip'), first('d_Callback')].forEach(p => { for (let i = 0; i < 3; i++) seq.push(p); }); seq.push('Hello, this is dispatch calling about your truck');
  let stream; try { stream = await vpOpenMic(); } catch (e) { return toast('Allow microphone access for this page, then try again'); }
  VPBUSY = true; const meter = new VoiceMeter(stream); await meter.resume(); VPS = { meter };
  const draw = (n, lvl) => { panel.innerHTML = `<div class="card" style="background:var(--s2);margin-bottom:14px"><div class="lab">Sample ${Math.min(n + 1, seq.length)} of ${seq.length}</div><div style="font-size:24px;font-weight:700;margin:8px 0">"${esc(seq[Math.min(n, seq.length - 1)])}"</div><div class="note">Say it in your normal voice at your normal volume, then pause.</div>
    <div class="meter" style="height:10px;margin-top:14px"><i style="width:${Math.max(0, Math.min(100, (lvl + 70) / 50 * 100))}%"></i></div><div class="row" style="margin-top:14px"><button class="btn sm" id="vlCancel">Cancel</button></div></div>`; $('#vlCancel', panel).onclick = () => { vpStop(); panel.innerHTML = ''; }; };
  let n = 0, lvl = -70; draw(0, lvl);
  const cap = vpCapture(meter, seq.length, ev => { if (ev.count !== undefined && !ev.tooShort) { n = ev.count; draw(n, lvl); } if (ev.level !== undefined) { lvl = ev.level; const b = $('.meter i', panel); if (b) b.style.width = Math.max(0, Math.min(100, (lvl + 70) / 50 * 100)) + '%'; } });
  VPS.cap = cap; const segs = await cap; const ok = VPS && segs.length >= seq.length; const prof = ok ? vpBuildProfile(segs) : null; vpStop();
  if (prof) { await set({ vprint: prof, vpCfg: { ...vpCfgNow(), on: true } }); toast('Voice profile saved. Voice lock is on'); renderSettings(); } else if (panel.isConnected) panel.innerHTML = '';
}
async function vpTest(el) {
  vpStop(); const panel = $('#vlPanel', el); let stream; try { stream = await vpOpenMic(); } catch (e) { return toast('Allow microphone access for this page, then try again'); }
  VPBUSY = true; const meter = new VoiceMeter(stream); await meter.resume(); VPS = { meter };
  panel.innerHTML = `<div class="card" style="background:var(--s2);margin-bottom:14px"><div class="lab">Live test</div><div id="vtV" style="font-size:22px;font-weight:700;margin:8px 0">Speak now</div><div id="vtB" class="note"></div><div class="note" style="margin-top:6px">Ask a colleague to speak, or play a video nearby. It should say Rejected for them and Accepted for you.</div><div class="row" style="margin-top:12px"><button class="btn sm" id="vlStop">Stop test</button></div></div>`;
  $('#vlStop', panel).onclick = () => { vpStop(); panel.innerHTML = ''; };
  VPS.timer = setInterval(() => { const seg = meter.segment(1600); const t = $('#vtV', panel); if (!t) return vpStop(); if (!seg) { t.textContent = 'Speak now'; t.style.color = ''; $('#vtB', panel).textContent = ''; return; }
    const v = vpVerify(ST.vprint, seg, vpCfgNow()); t.textContent = (v.ok ? 'Accepted ' : 'Rejected ') + v.pct + '%'; t.style.color = v.ok ? 'var(--ok)' : 'var(--er)';
    $('#vtB', panel).textContent = 'Loudness ' + v.parts.level + '%   Pitch ' + (v.parts.pitch == null ? 'n/a' : v.parts.pitch + '%') + '   Tone ' + v.parts.tone + '%' + (v.why.length ? '   (' + v.why.join(', ') + ')' : ''); }, 150);
}
