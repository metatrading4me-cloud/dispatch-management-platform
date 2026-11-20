// DialFlow shared library (dashboard + Voice page). Pure helpers, no DOM access.

// ---------------- settings defaults ----------------
const CFG_DEFAULTS = {
  delay: 1, maxCall: 0, startTimeout: 20, ringLimit: 0,
  hoursOn: false, hoursStart: 8, hoursEnd: 21, hoursMode: 'defer',
  dncOn: true, recentOn: false, recentDays: 7,
  requeueOn: true, requeueMax: 1, chime: true, goal: 100,
  voiceInCall: 'all', theme: 'dark', follow: true, sortMode: 'file',
};
const PROFILE_DEFAULT = { trucks: ['Box truck'], minMo: 0, maxMo: 24, fleetMax: 10, states: [] };
const CUES_DEFAULT = {
  truck: {
    'Box truck': 'Confirm box length (24-26 ft), liftgate and dock access, and preferred lanes.',
    'Hotshot': 'Ask trailer length, weight capacity and how far they like to run.',
    'Cargo van / Sprinter': 'Confirm van size and payload before talking about loads.',
    'Dry van': 'Ask about lanes, number of trucks and how they find freight today.',
    'Reefer': 'Ask temperature range, lanes and recent reefer experience.',
    'Flatbed': 'Ask about tarps, straps and securement capability.',
    'Semi (tractor + trailer)': 'Ask trailer type and the lanes they want to run weekly.',
    'default': 'Ask what equipment they run and where they want freight.',
  },
  age: {
    'new': 'New authority: lead with steady freight and fast payment; ask who books their loads today.',
    'young': 'Under a year in business: ask whether they are still building their customer base.',
    'mature': 'Established authority: ask about current broker relationships and what they would change.',
  },
};

// ---------------- icon set (24px, stroke) ----------------
const ICONS = {
  logo: '<path d="M6 4.5h3.2l1.6 4-2 1.3a9 9 0 004.4 4.4l1.3-2 4 1.6V17a2 2 0 01-2 2C9.9 19 5 14.1 5 8.5a2 2 0 011-4z"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  grid: '<rect x="4" y="4" width="7" height="8" rx="1.5"/><rect x="13" y="4" width="7" height="5" rx="1.5"/><rect x="13" y="12" width="7" height="8" rx="1.5"/><rect x="4" y="15" width="7" height="5" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M4 20h16M7 20v-7M12 20V5M17 20v-10"/>',
  shield: '<path d="M12 3l8 3v6c0 4.6-3.4 7.8-8 9-4.6-1.2-8-4.4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
  micoff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M4 4l16 16"/>',
  skip: '<path d="M5 5l10 7-10 7V5z"/><path d="M19 5v14"/>',
  play: '<path d="M7 4.5l12 7.5-12 7.5v-15z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  hangup: '<path d="M3 13.5c5-4.5 13-4.5 18 0l-2.2 2.6-3.4-1.4v-2.6c-2-.7-4-.7-6 0v2.6L5.2 16.1 3 13.5z"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  download: '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/>',
  upload: '<path d="M12 16V5m0 0L8 9m4-4l4 4M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  bell: '<path d="M6 16v-5a6 6 0 1112 0v5l2 2H4l2-2z"/><path d="M10 21h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  note: '<path d="M6 3h8l5 5v13H6V3z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4L4 5z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.6M20 4v7h-7"/>',
  truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  pin: '<path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  zap: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  min: '<path d="M6 12h12"/>',
  max: '<path d="M6 12h12M12 6v12"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  alert: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17.5h.01"/>',
};
const IC = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;
const LOGO = (s = 36) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><defs><linearGradient id="dfLg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4F7CFF"/><stop offset="1" stop-color="#22C3A6"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#dfLg)"/><path transform="translate(8 10) scale(1.5)" fill="#fff" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/><path d="M44 22l8 10-8 10" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------------- CSV / lead import ----------------
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function normalizeNumber(raw) {
  const d = String(raw).replace(/[^\d+]/g, ''), digits = d.replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (d.startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return '+' + digits;
}
function buildLeads(rows) {
  const looksPhone = v => String(v).replace(/\D/g, '').length >= 7;
  const header = (rows[0] || []).map(h => h.trim());
  let phoneCol = header.findIndex(h => /phone|number|mobile|cell|tel/i.test(h));
  let hasHeader = phoneCol >= 0, data;
  if (!hasHeader) {
    const cols = Math.max(...rows.map(r => r.length)); let best = 0, bestN = -1;
    for (let c = 0; c < cols; c++) { const n = rows.filter(r => looksPhone(r[c] || '')).length; if (n > bestN) { bestN = n; best = c; } }
    phoneCol = best; hasHeader = !looksPhone(rows[0][phoneCol] || '');
  }
  const width = Math.max(...rows.map(r => r.length));
  const columns = hasHeader ? header.map((h, i) => h || 'Column ' + (i + 1)) : Array.from({ length: width }, (_, i) => 'Column ' + (i + 1));
  while (columns.length < width) columns.push('Column ' + (columns.length + 1));
  data = hasHeader ? rows.slice(1) : rows;
  const nameCol = columns.findIndex((h, i) => i !== phoneCol && /name|company|carrier|business/i.test(h));
  const seen = new Set(), leads = [];
  for (const r of data) {
    const n = normalizeNumber(r[phoneCol] || ''); if (!n || seen.has(n)) continue; seen.add(n);
    const f = {}; columns.forEach((c, i) => { if ((r[i] || '').trim() !== '') f[c] = r[i].trim(); });
    leads.push({ n, name: nameCol >= 0 ? (r[nameCol] || '').trim() : '', f });
  }
  return { leads, columns, phoneColumn: columns[phoneCol], nameColumn: nameCol >= 0 ? columns[nameCol] : null };
}

// ---------------- carrier card ----------------
const FIELD_DEFS = [
  ['name', 'Company name', [/legal.?name|company|carrier|business|dba/i, /^name$/i]],
  ['officer', 'Officer / owner', [/officer|owner|principal/i, /contact/i]],
  ['mc', 'MC number', [/\bmc\b|docket/i]],
  ['dot', 'DOT number', [/\bdot\b|usdot/i]],
  ['date', 'Authority / registered date', [/authority|regist|since|issued|effective/i, /date/i]],
  ['truck', 'Truck type', [/truck.?type|equipment.?type|vehicle|unit.?type|^type$/i]],
  ['equip', 'Equipment (straight/tractor/trailer)', [/equipment|straight|tractor/i]],
  ['fleet', 'Fleet size', [/fleet|power.?units|drivers|^trucks?$/i]],
  ['city', 'City', [/\bcity\b/i]],
  ['state', 'State', [/\bstate\b|^st$/i]],
  ['loc', 'Location (City, ST)', [/location|address/i]],
  ['email', 'Email', [/e-?mail/i]],
];
function detectMap(columns) {
  const map = {}, used = new Set();
  for (const [key, , pats] of FIELD_DEFS) { map[key] = ''; outer: for (const p of pats) for (const c of columns) if (!used.has(c) && p.test(c)) { map[key] = c; used.add(c); break outer; } }
  return map;
}
const _p2 = n => String(n).padStart(2, '0');
function parseDate(s) {
  s = String(s || '').trim(); if (!s) return ''; let m;
  if ((m = s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) return `${m[1]}-${_p2(m[2])}-${_p2(m[3])}`;
  if ((m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) { let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000; if (a > 12 && b <= 12) [a, b] = [b, a]; return `${y}-${_p2(a)}-${_p2(b)}`; }
  const d = new Date(s); return isNaN(d) ? '' : `${d.getFullYear()}-${_p2(d.getMonth() + 1)}-${_p2(d.getDate())}`;
}
function ageOf(iso) {
  if (!iso) return null;
  const [y, mo, d] = iso.split('-').map(Number), start = new Date(y, mo - 1, d), now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (isNaN(start) || start > today) return null;
  let m = (today.getFullYear() - y) * 12 + today.getMonth() - (mo - 1), anchor = new Date(y, mo - 1 + m, d);
  if (anchor > today) { m--; anchor = new Date(y, mo - 1 + m, d); }
  return { months: m, days: Math.round((today - anchor) / 864e5), total: Math.round((today - start) / 864e5) };
}
const fmtAge = a => !a ? '-' : (a.months ? `${a.months} mo ${a.days} d` : `${a.days} days`);
function parseEquip(t) {
  t = String(t || ''); const g = re => { const m = t.match(re); return m ? +m[1] : 0; };
  const e = { straight: g(/(\d+)\s*straight/i), tractor: g(/(\d+)\s*tractor/i), trailer: g(/(\d+)\s*trailer/i) };
  e.has = !!(e.straight || e.tractor || e.trailer || /straight|tractor|trailer/i.test(t)); return e;
}
function inferTruck(explicit, hint, eq) {
  if (String(explicit || '').trim()) return { label: explicit.trim(), inferred: false };
  const h = String(hint || '').toLowerCase();
  const rules = [[/hot ?shot/, 'Hotshot'], [/reefer|refrigerat/, 'Reefer'], [/flat ?bed|step ?deck/, 'Flatbed'], [/sprinter|cargo van/, 'Cargo van / Sprinter'], [/dry ?van/, 'Dry van'], [/box ?truck|straight ?truck/, 'Box truck'], [/power ?only/, 'Power only'], [/dump/, 'Dump truck'], [/tow|wrecker/, 'Tow'], [/car ?haul|auto ?transport/, 'Car hauler'], [/tanker/, 'Tanker']];
  for (const [re, label] of rules) if (re.test(h)) return { label, inferred: true };
  if (eq && eq.has) { if (eq.tractor > 0) return { label: eq.trailer > 0 ? 'Semi (tractor + trailer)' : 'Tractor / power only', inferred: true }; if (eq.straight > 0) return { label: 'Box truck', inferred: true }; }
  return { label: 'Unknown', inferred: true, unknown: true };
}
function fleetCount(c) { const m = String(c.fleet || '').match(/\d+/); return m ? +m[0] : 0; }
function scoreLead(c, prof, hist) {
  prof = { ...PROFILE_DEFAULT, ...(prof || {}) }; let s = 0;
  if (prof.trucks.length && prof.trucks.includes(c.truck)) s += 40;
  const a = ageOf(c.date); if (a && a.months >= prof.minMo && a.months <= prof.maxMo) s += 25;
  const f = fleetCount(c); if (f && f <= prof.fleetMax) s += 15;
  if (prof.states.length && prof.states.includes(c.state)) s += 10;
  if (c.officer) s += 5; if (c.email) s += 5;
  if (hist && hist.c) s -= 10 * Math.min(3, hist.c);
  return Math.max(0, Math.min(100, s));
}
const scoreLabel = s => s >= 70 ? 'Hot' : s >= 45 ? 'Warm' : 'Cool';
function makeCard(l, map, prof, hist) {
  const g = k => (map[k] ? (l.f[map[k]] || '') : '');
  let city = g('city'), state = g('state').toUpperCase().slice(0, 2), loc = g('loc');
  if ((!city || !state) && loc) { const m = loc.match(/([^,]+?),\s*([A-Za-z]{2})\b/); if (m) { city = city || m[1].trim(); state = state || m[2].toUpperCase(); } else if (!city) city = loc; }
  const name = g('name') || l.name || '', eq = parseEquip(g('equip') + ' ' + g('fleet'));
  const t = inferTruck(g('truck'), name + ' ' + g('equip'), eq);
  const c = { name, officer: g('officer'), mc: g('mc'), dot: g('dot'), date: parseDate(g('date')), city, state, truck: t.label, inferred: !!t.inferred, unknown: !!t.unknown, fleet: g('fleet'), equip: g('equip'), email: g('email') };
  c.score = scoreLead(c, prof, hist); return c;
}
function pitchCue(c, cues) {
  cues = cues || CUES_DEFAULT; const out = [], tc = (cues.truck || {});
  out.push(tc[c.truck] || tc['default'] || CUES_DEFAULT.truck.default);
  const a = ageOf(c.date); if (a) out.push((cues.age || {})[a.months < 6 ? 'new' : a.months < 12 ? 'young' : 'mature']);
  return out.filter(Boolean);
}
function carrierLinks(c) {
  const dot = String(c.dot || '').replace(/\D/g, ''), mc = String(c.mc || '').replace(/\D/g, ''), L = [];
  if (dot) L.push(['SAFER snapshot', `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${dot}`]);
  else if (mc) L.push(['SAFER snapshot', `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mc}`]);
  if (dot) L.push(['Full carrier report', `https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/Overview.aspx`]);
  if (dot || mc) L.push(['Authority & insurance', `https://li-public.fmcsa.dot.gov/LIVIEW/pkg_carrquery.prc_carrlist?p_begin=1&p_end=10&s_prefix=MC&n_docketno=${mc}&n_dotno=${dot}&s_legalname=&s_dbaname=&s_state=&pv_vpath=LIVIEW`]);
  return L;
}

// ---------------- calling hours (carrier local time) ----------------
const NY = 'America/New_York', CH = 'America/Chicago', DN = 'America/Denver', LA = 'America/Los_Angeles';
const STATE_TZ = { AL: CH, AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: CH, CA: LA, CO: DN, CT: NY, DE: NY, DC: NY, FL: NY, GA: NY, HI: 'Pacific/Honolulu', ID: 'America/Boise', IL: CH, IN: 'America/Indiana/Indianapolis', IA: CH, KS: CH, KY: NY, LA: CH, ME: NY, MD: NY, MA: NY, MI: 'America/Detroit', MN: CH, MS: CH, MO: CH, MT: DN, NE: CH, NV: LA, NH: NY, NJ: NY, NM: DN, NY: NY, NC: NY, ND: CH, OH: NY, OK: CH, OR: LA, PA: NY, RI: NY, SC: NY, SD: CH, TN: CH, TX: CH, UT: DN, VT: NY, VA: NY, WA: LA, WV: NY, WI: CH, WY: DN, PR: 'America/Puerto_Rico' };
function localHour(state, now) {
  const tz = STATE_TZ[String(state || '').toUpperCase()]; if (!tz) return null;
  try { const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now || new Date()); const h = +p.find(x => x.type === 'hour').value % 24, m = +p.find(x => x.type === 'minute').value; return h + m / 60; } catch (e) { return null; }
}
function localTimeLabel(state, now) {
  const tz = STATE_TZ[String(state || '').toUpperCase()]; if (!tz) return '';
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(now || new Date()); } catch (e) { return ''; }
}
// true = allowed, false = outside hours, null = unknown state (allowed)
function hoursAllowed(state, start, end, now) { const h = localHour(state, now); return h === null ? null : (h >= start && h < end); }

// ---------------- queue / outcome helpers ----------------
function queueNextOrder(order, index, leadId, active) {
  const o = order.slice(); const at = o.indexOf(leadId, 0);
  let idx = index; if (at !== -1) { o.splice(at, 1); if (at < idx) idx--; }
  const pos = Math.min(o.length, idx + (active ? 1 : 0)); o.splice(pos, 0, leadId); return { order: o, index: idx };
}
function defaultCallbackTime() { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d.getTime(); }
function applyDispositionData(notes, dnc, leadId, num, disp) {
  notes = { ...notes }; dnc = dnc.slice();
  const n = { ...(notes[leadId] || {}) }; n.disp = disp;
  if (disp === 'Callback' && !n.cb) { n.cb = defaultCallbackTime(); n.cbDone = false; }
  if (disp === 'Do not call' && num && !dnc.includes(num)) dnc.push(num);
  notes[leadId] = n; return { notes, dnc };
}

// ---------------- voice commands (you set the phrase, DialFlow provides the action) ----------------
const VOICE_ACTIONS = [
  ['endCall', 'End call (hang up, then dial next)', ['end call']],
  ['skip', 'Skip this lead', ['skip lead']],
  ['endStop', 'End call and pause dialing', ['end and stop']],
  ['pause', 'Pause dialing', ['pause dialing']],
  ['resume', 'Resume dialing', ['resume dialing']],
  ['dashboard', 'Open dashboard', ['open dashboard']],
  ['hideCard', 'Collapse the carrier card', ['hide card']],
  ['showCard', 'Expand the carrier card', ['show card']],
  ['note', 'Save a note (say the phrase, then your note)', ['note']],
  ['d_Interested', 'Outcome: Interested', ['mark interested']],
  ['d_Callback', 'Outcome: Callback', ['mark callback']],
  ['d_Not interested', 'Outcome: Not interested', ['mark not interested']],
  ['d_No answer', 'Outcome: No answer', ['mark no answer']],
  ['d_Voicemail', 'Outcome: Voicemail', ['mark voicemail']],
  ['d_Wrong number', 'Outcome: Wrong number', ['mark wrong number']],
  ['d_Do not call', 'Outcome: Do not call (adds to DNC list)', ['mark do not call']],
];
const VOICE_LIMITED = ['endCall', 'skip', 'endStop', 'note'];
function voiceCfg(raw) {
  raw = raw || {}; const cmds = {};
  VOICE_ACTIONS.forEach(([k, , d]) => { cmds[k] = raw.cmds && Array.isArray(raw.cmds[k]) ? raw.cmds[k] : d; });
  return { enabled: !!raw.enabled, lang: raw.lang || 'en-US', mode: raw.mode || 'exact', fast: raw.fast !== false, wake: raw.wake || '', cmds };
}
const voiceNorm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
// -> { key, rest } | null
function voiceMatch(cfg, text) {
  let t = voiceNorm(text);
  if (cfg.wake) { const w = voiceNorm(cfg.wake); if (t === w || t.startsWith(w + ' ')) t = t.slice(w.length).trim(); else return null; }
  const all = [];
  for (const [k] of VOICE_ACTIONS) for (const p of cfg.cmds[k] || []) { const n = voiceNorm(p); if (n) all.push([k, n]); }
  all.sort((a, b) => b[1].length - a[1].length);
  for (const [k, p] of all) {
    if (k === 'note') { if (t.startsWith(p + ' ') && t.length > p.length + 1) return { key: 'note', rest: t.slice(p.length + 1) }; continue; }
    if (cfg.mode === 'exact' ? t === p : (' ' + t + ' ').includes(' ' + p + ' ')) return { key: k, rest: '' };
  }
  return null;
}

// ---------------- importing an old call-tracker backup (merge, never overwrite) ----------------
function convertTracker(d) {
  const log = [], texts = []; let chat = 0, blank = 0;
  for (const c of (d.calls || [])) {
    const n = normalizeNumber(c.n || ''); if (!n) { blank++; continue; }
    if (c.v === 'chat') { chat++; texts.push({ n, t: c.t }); continue; }
    log.push({ i: -1, n, t: c.t, d: 0, td: 0, s: 'called', a: false, imp: true, nm: c.cn || '' });
  }
  log.sort((a, b) => a.t - b.t);
  const st = d.settings || {};
  return { format: 'dialflow-import', source: d.app || 'call tracker', exported: d.exported || '', log, texts, goal: st.dailyGoal || null, theme: st.mode === 'light' ? 'light' : 'dark',
    stats: { events: (d.calls || []).length, dials: log.length, texts: texts.length, skippedBlank: blank } };
}
function mergeImport(cur, imp) {
  const have = {}; for (const l of cur.log) (have[l.n] = have[l.n] || []).push(l.t);
  const keep = [];
  for (const e of imp.log || []) { const a = have[e.n]; if (a && a.some(t => Math.abs(t - e.t) < 120000)) continue; keep.push(e); }   // only skip calls DialFlow already logged itself
  let log = [...cur.log, ...keep].sort((a, b) => a.t - b.t); if (log.length > 5000) log = log.slice(log.length - 5000);
  const history = JSON.parse(JSON.stringify(cur.history || {})), last = {};
  for (const e of keep) {                         // dials within 2 minutes of each other count once
    if (last[e.n] && e.t - last[e.n] < 120000) { last[e.n] = e.t; continue; } last[e.n] = e.t;
    const h = history[e.n] || { c: 0 }; history[e.n] = { ...h, c: (h.c || 0) + 1, t: Math.max(h.t || 0, e.t) };
  }
  for (const x of imp.texts || []) { const h = history[x.n] || { c: 0 }; history[x.n] = { ...h, m: (h.m || 0) + 1, mt: Math.max(h.mt || 0, x.t) }; }
  return { log, history, added: keep.length };
}
