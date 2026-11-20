// DialFlow Voice Lock: checks that a spoken command comes from the enrolled person.
// Lightweight on-device matching: loudness at your mic, pitch range and vocal tone. No audio leaves the browser from this code.
const VP_BANDS = 24, VP_FMIN = 150, VP_FMAX = 4200;
const VP_SENS = { strict: { z: 1.3, lv: 8, pm: 0.07 }, balanced: { z: 1.9, lv: 11, pm: 0.12 }, relaxed: { z: 2.7, lv: 15, pm: 0.18 } };
const vpMedian = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const vpPct = (a, p) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]; };
const vpStd = a => { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };

function vpFilters(sr, nfft) {
  const mel = f => 2595 * Math.log10(1 + f / 700), inv = m => 700 * (Math.pow(10, m / 2595) - 1), hz = sr / nfft;
  const pts = Array.from({ length: VP_BANDS + 2 }, (_, i) => inv(mel(VP_FMIN) + (mel(VP_FMAX) - mel(VP_FMIN)) * i / (VP_BANDS + 1)));
  const out = [];
  for (let b = 1; b <= VP_BANDS; b++) {
    const lo = pts[b - 1], mid = pts[b], hi = pts[b + 1], from = Math.max(1, Math.floor(lo / hz)), to = Math.min(nfft / 2 - 1, Math.ceil(hi / hz)), w = [];
    for (let k = from; k <= to; k++) { const f = k * hz; w.push(f < mid ? (f - lo) / (mid - lo) : (hi - f) / (hi - mid)); }
    out.push({ from, w: w.map(x => Math.max(0, x)) });
  }
  return out;
}

class VoiceMeter {
  constructor(stream) {
    this.stream = stream; this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.an = this.ctx.createAnalyser(); this.an.fftSize = 2048; this.an.smoothingTimeConstant = 0;
    this.ctx.createMediaStreamSource(stream).connect(this.an);
    this.sr = this.ctx.sampleRate; this.filters = vpFilters(this.sr, 2048);
    this.freq = new Float32Array(this.an.frequencyBinCount); this.time = new Float32Array(2048);
    this.frames = []; this.nf = null; this.dead = false;
    this.timer = setInterval(() => this.grab(), 30);
  }
  async resume() { try { if (this.ctx.state === 'suspended') await this.ctx.resume(); } catch (e) {} }
  stop() { this.dead = true; clearInterval(this.timer); try { this.stream.getTracks().forEach(t => t.stop()); this.ctx.close(); } catch (e) {} }
  grab() {
    if (this.dead) return; if (this.ctx.state === 'suspended') { this.ctx.resume(); return; }
    this.an.getFloatTimeDomainData(this.time); this.an.getFloatFrequencyData(this.freq);
    let s = 0; for (let i = 0; i < 2048; i++) s += this.time[i] * this.time[i];
    const db = 20 * Math.log10(Math.sqrt(s / 2048) + 1e-9);
    this.nf = this.nf === null ? db : (db < this.nf ? db : this.nf + 0.02);
    const voiced = db > Math.max(this.nf + 9, -52), fr = { t: performance.now(), db, voiced };
    if (voiced) {
      const logE = this.filters.map(f => { let e = 0; for (let j = 0; j < f.w.length; j++) e += f.w[j] * Math.pow(10, this.freq[f.from + j] / 10); return 10 * Math.log10(e + 1e-12); });
      const m = logE.reduce((a, b) => a + b, 0) / logE.length; fr.shape = logE.map(x => x - m); fr.f0 = this.pitch();
    }
    this.frames.push(fr); const cut = fr.t - 9000; while (this.frames.length && this.frames[0].t < cut) this.frames.shift();
  }
  pitch() {
    const D = Math.max(1, Math.round(this.sr / 12000)), n = Math.floor(2048 / D), x = new Float32Array(n), sre = this.sr / D; let m = 0;
    for (let i = 0; i < n; i++) { let a = 0; for (let k = 0; k < D; k++) a += this.time[i * D + k]; x[i] = a / D; m += x[i]; } m /= n; for (let i = 0; i < n; i++) x[i] -= m;
    let r0 = 0; for (let i = 0; i < n; i++) r0 += x[i] * x[i]; if (r0 < 1e-9) return null;
    const lmin = Math.floor(sre / 400), lmax = Math.min(n - 1, Math.ceil(sre / 70)); let best = 0, bl = 0;
    for (let l = lmin; l <= lmax; l++) { let r = 0; for (let i = 0; i + l < n; i++) r += x[i] * x[i + l]; r /= r0; if (r > best) { best = r; bl = l; } }
    return best > 0.45 ? sre / bl : null;
  }
  // summary of the last `ms` milliseconds (only the loudest voiced frames, so quiet background talk cannot dilute it)
  segment(ms, upTo) {
    const end = upTo || performance.now(), fr = this.frames.filter(f => f.voiced && f.t > end - ms && f.t <= end);
    if (fr.length < 3) return null;
    const top = Math.max(...fr.map(f => f.db)), keep = fr.filter(f => f.db >= top - 14); if (keep.length < 3) return null;
    const shape = Array.from({ length: VP_BANDS }, (_, b) => keep.reduce((a, f) => a + f.shape[b], 0) / keep.length);
    const f0s = keep.map(f => f.f0).filter(Boolean);
    return { n: keep.length, shape, f0: f0s.length >= 2 ? vpMedian(f0s) : null, level: vpMedian(keep.map(f => f.db)) };
  }
  currentLevel() { const f = this.frames[this.frames.length - 1]; return f ? f.db : -90; }
}
async function vpOpenMic() { return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } }); }

// build the profile from several utterance segments
function vpBuildProfile(segs) {
  segs = segs.filter(Boolean); if (segs.length < 4) return null;
  const mu = Array.from({ length: VP_BANDS }, (_, b) => segs.reduce((a, s) => a + s.shape[b], 0) / segs.length);
  const sd = Array.from({ length: VP_BANDS }, (_, b) => Math.max(3, vpStd(segs.map(s => s.shape[b]))));
  const f0 = segs.map(s => s.f0).filter(Boolean), lv = segs.map(s => s.level);
  return { v: 1, mu, sd, f0: f0.length >= 3 ? { med: vpMedian(f0), lo: vpPct(f0, 0.1), hi: vpPct(f0, 0.9) } : null, level: { med: vpMedian(lv), sd: Math.max(2.5, vpStd(lv)) }, n: segs.length, ts: Date.now() };
}
// -> { ok, pct, parts:{level,pitch,tone}, why:[] }
function vpVerify(profile, seg, cfg) {
  cfg = { sens: 'balanced', level: true, pitch: true, tone: true, ...(cfg || {}) };
  if (!seg) return { ok: false, pct: 0, parts: {}, why: ['no clear speech heard'] };
  const S = VP_SENS[cfg.sens] || VP_SENS.balanced, why = [], parts = {};
  const dv = Math.abs(seg.level - profile.level.med), lim = Math.max(S.lv, 2 * profile.level.sd);
  parts.level = Math.max(0, Math.round(100 * (1 - dv / (lim * 1.6)))); const levelOk = !cfg.level || dv <= lim; if (!levelOk) why.push(seg.level < profile.level.med ? 'too quiet (far from your mic)' : 'too loud');
  let pitchOk = true; parts.pitch = null;
  if (profile.f0 && seg.f0) { const lo = profile.f0.lo * (1 - S.pm), hi = profile.f0.hi * (1 + S.pm); pitchOk = !cfg.pitch || (seg.f0 >= lo && seg.f0 <= hi); const mid = profile.f0.med; parts.pitch = Math.max(0, Math.round(100 - 100 * Math.abs(Math.log(seg.f0 / mid)) / 0.35)); if (!pitchOk) why.push('pitch differs from yours'); }
  let z = 0; for (let b = 0; b < VP_BANDS; b++) z += Math.abs(seg.shape[b] - profile.mu[b]) / profile.sd[b]; z /= VP_BANDS;
  parts.tone = Math.max(0, Math.round(100 * (1 - z / (S.z * 1.8)))); const toneOk = !cfg.tone || z <= S.z; if (!toneOk) why.push('voice tone differs from yours');
  const used = [cfg.level && parts.level, cfg.pitch && parts.pitch != null && parts.pitch, cfg.tone && parts.tone].filter(x => x !== false && x !== null && x !== undefined);
  return { ok: levelOk && pitchOk && toneOk, pct: used.length ? Math.min(...used) : 100, parts, why, z, dv };
}
// Enrollment: listens, splits the stream into utterances and returns their segments
function vpCapture(meter, want, cb) {
  let state = 'idle', vs = 0, silent = 0, startT = 0; const segs = []; let stopped = false;
  const tick = setInterval(() => {
    const fr = meter.frames, last = fr[fr.length - 1]; if (!last) return;
    if (state === 'idle') { vs = last.voiced ? vs + 1 : 0; if (vs >= 3) { state = 'talk'; startT = last.t - 150; silent = 0; } }
    else { silent = last.voiced ? 0 : silent + 1; if (silent >= 22) {             // ~650 ms of silence ends the utterance
      state = 'idle'; vs = 0; const seg = meter.segment(last.t - startT, last.t);
      if (seg && seg.n >= 8) { segs.push(seg); cb && cb({ count: segs.length, seg }); if (segs.length >= want) { stopped = true; clearInterval(tick); done(segs); } } else cb && cb({ count: segs.length, tooShort: true }); } }
    cb && cb({ level: last.db, voiced: last.voiced, state });
  }, 30);
  let done = () => {}; const p = new Promise(r => { done = r; }); p.cancel = () => { if (!stopped) { stopped = true; clearInterval(tick); done(segs); } }; return p;
}
