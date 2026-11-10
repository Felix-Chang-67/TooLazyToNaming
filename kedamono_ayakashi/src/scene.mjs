// The lyric video itself: timeline, backgrounds, motifs, kinetic type, post-processing, HUD.
// Every frame is a pure function of time t, so frames can be rendered in any order / in parallel.
import {
  W, H, COL, E, ez, clamp, lerp, smooth, rnd, rr, noise1, canvas, layout, drawGlyphs, text, scrambleChar, scrambleFor,
  makeNoiseTiles, makeVignette, makeScanlines, scaledCanvas,
} from './lib.mjs';
import { BPM, BEAT0, SPB, Audio } from './audio.mjs';
import { parseLrc, DIRECTION } from './lyrics.mjs';

export const DISCLAIMER = '歌词与翻译为个人听译，可能有误，欢迎捉虫～';
const TITLE = 'KEDAMONO_AYAKASHI';
export const ARTIST = 'ヒトリエ';
const SONG_START = 0.1; // first transient of the official master
const FINAL_HIT = Audio.beatTime(394); // last hit before the music stops (~167.77 s)
const TAU = Math.PI * 2;

const STYLE = {
  intro: { shadow: 'dark', glow: 0.2, shake: 0.5, dust: 0.7, grain: 0.1, zoomPulse: 0.8 },
  verse1: { shadow: 'dark', glow: 0.22, glowCol: '#ffffff', shake: 0.15, osc: 0.3, dust: 1, grain: 0.09, zoomPulse: 0.45 },
  break1: { shadow: 'dark', glow: 0.3, glowCol: '#ffffff', shake: 0.05, osc: 0.55, dust: 0.7, grain: 0.1, zoomPulse: 0.1 },
  pre1: { shadow: 'dark', glow: 0.35, glowCol: COL.redHot, shake: 0.6, spectrum: 0.45, embers: 0.4, grain: 0.1, zoomPulse: 0.9 },
  chorus1: { shadow: 'dark', glow: 0.45, glowCol: COL.redHot, shake: 1, spectrum: 1, embers: 1, grain: 0.11, zoomPulse: 1.3, kickFlash: 0.1 },
  inter: { shadow: 'dark', glow: 0.3, glowCol: COL.redHot, shake: 0.35, spectrum: 1, embers: 0.6, grain: 0.1, zoomPulse: 0.8 },
  verse2: { shadow: 'light', glow: 0, shake: 0.2, grain: 0.13, zoomPulse: 0.5, paper: true },
  break2: { shadow: 'dark', glow: 0.45, glowCol: COL.redHot, shake: 0.6, spectrum: 0.5, grain: 0.1, zoomPulse: 0.9 },
  pre2: { shadow: 'dark', glow: 0.3, glowCol: '#ffffff', shake: 0.7, spectrum: 0.5, embers: 0.5, grain: 0.1, zoomPulse: 1 },
  bridge: { shadow: 'dark', glow: 0.35, glowCol: '#ffffff', shake: 0.3, osc: 0.4, dust: 0.6, grain: 0.11, zoomPulse: 0.5 },
  chorus2: { shadow: 'dark', glow: 0.5, glowCol: COL.redHot, shake: 1.1, spectrum: 1, embers: 1, grain: 0.12, zoomPulse: 1.4, kickFlash: 0.12 },
  gap: { shadow: 'dark', glow: 0.4, glowCol: COL.redHot, shake: 0.6, spectrum: 0.8, embers: 0.6, grain: 0.1, zoomPulse: 1.1 },
  outro: { shadow: 'dark', glow: 0.45, glowCol: COL.redHot, shake: 1, spectrum: 0.9, embers: 0.8, grain: 0.11, zoomPulse: 1.5, kickFlash: 0.08 },
  end: { shadow: 'dark', glow: 0.3, glowCol: COL.redHot, shake: 0.3, spectrum: 0.7, embers: 0.5, grain: 0.1, zoomPulse: 0.7 },
};

function buildSections(L) {
  const S = [
    ['intro', 0, 'INTRO'],
    ['verse1', L[0].t0, 'VERSE'],
    ['break1', L[8].t0, 'BREAK'],
    ['pre1', L[11].t0, 'PRE-CHORUS'],
    ['chorus1', L[13].t0, 'CHORUS'],
    ['inter', L[17].t1, 'INTERLUDE'],
    ['verse2', L[18].t0, 'VERSE'],
    ['break2', L[24].t0, 'BREAK'],
    ['pre2', L[26].t0, 'PRE-CHORUS'],
    ['bridge', L[28].t0, 'BRIDGE'],
    ['chorus2', L[31].t0, 'CHORUS'],
    ['gap', L[34].t1, 'NO SIDE'],
    ['outro', L[35].t0, 'OUTRO'],
    ['end', L[39].t1, 'END'],
  ].map(([id, t0, label], i) => ({ id, t0, label, n: i }));
  S.forEach((s, i) => (s.t1 = i + 1 < S.length ? S[i + 1].t0 : 1e9));
  return S;
}

// ------------------------------------------------------------------ glyph animation presets
function enterStyle(kind, u, g, size, seed, t) {
  switch (kind) {
    case 'rise': {
      if (u < 0) return null;
      const e = ez(E.outC, u / 0.55);
      return { dy: (1 - e) * size * 0.5, alpha: ez(E.outQ, u / 0.32), sy: lerp(1.18, 1, e) };
    }
    case 'drop': {
      if (u < 0) return null;
      const e = ez(E.outB, u / 0.42, 2.2);
      return { dy: -(1 - e) * size * 1.2, alpha: ez(E.lin, u / 0.1), rot: (1 - ez(E.outC, u / 0.4)) * rr(-0.6, 0.6, seed, g.i) };
    }
    case 'slam': {
      if (u < 0) return null;
      const e = ez(E.outX, u / 0.2);
      const s = lerp(2.5, 1, e);
      return { sx: s, sy: s, alpha: ez(E.lin, u / 0.05) };
    }
    case 'zoom': {
      if (u < 0) return null;
      const e = ez(E.outB, u / 0.36, 2.4);
      return { sx: e, sy: e, alpha: ez(E.lin, u / 0.08) };
    }
    case 'flip': {
      if (u < 0) return null;
      const e = ez(E.outB, u / 0.42, 1.8);
      return { sy: Math.max(0.001, e), alpha: ez(E.lin, u / 0.08) };
    }
    case 'type': {
      if (u < 0) return null;
      return u < 0.07 ? { fill: COL.redHot, sx: 1.12, sy: 1.12 } : {};
    }
    case 'decode': {
      if (u < -0.32) return null;
      if (u < 0) return { ch: scrambleFor(g.font, seed, g.i, Math.floor(t * 24)), alpha: 0.8, fill: COL.redHot };
      return { sx: 1 + (1 - ez(E.outC, u / 0.2)) * 0.15 };
    }
    case 'scatter': {
      if (u < 0) return null;
      const e = ez(E.outC, u / 0.6);
      const a = rnd(seed, g.i, 1) * TAU;
      const r = (1 - e) * size * 2.5;
      return { dx: Math.cos(a) * r, dy: Math.sin(a) * r, rot: (1 - e) * rr(-2, 2, seed, g.i, 2), alpha: e };
    }
    default:
      return u < 0 ? null : {};
  }
}

function applyFx(st, fx, t, g, size, seed) {
  if (fx === 'jitter') {
    const k = Math.floor(t * 20);
    st.dx += (rnd(seed, g.i, k) - 0.5) * size * 0.06;
    st.dy += (rnd(seed, g.i, k, 1) - 0.5) * size * 0.06;
    if (rnd(seed, g.i, k, 2) < 0.05) st.ch = scrambleFor(g.font, seed, g.i, k);
  } else if (fx === 'glitch') {
    const k = Math.floor(t * 15);
    const r = rnd(seed, g.i, k);
    st.dx += (r - 0.5) * size * (r > 0.75 ? 0.35 : 0.06);
    if (rnd(seed, g.i, k, 3) < 0.12) st.ch = scrambleFor(g.font, seed, g.i, k);
    if (rnd(seed, g.i, k, 4) < 0.12) st.fill = COL.white;
    if (rnd(seed, g.i, k, 5) < 0.08) st.sx *= 1.5;
  } else if (fx === 'wobble') {
    st.rot += Math.sin(t * 5.2 + g.i * 0.9) * 0.13;
    st.dy += Math.sin(t * 4.1 + g.i * 1.3) * size * 0.07;
  } else if (fx === 'pulse') {
    const b = (t - BEAT0) / SPB;
    const p = Math.exp(-(b - Math.floor(b)) * 5);
    st.sx *= 1 + 0.07 * p;
    st.sy *= 1 + 0.07 * p;
  } else if (fx === 'shake') {
    const k = Math.floor(t * 30);
    st.dx += (rnd(seed, g.i, k, 6) - 0.5) * size * 0.05;
    st.dy += (rnd(seed, g.i, k, 7) - 0.5) * size * 0.05;
  } else if (fx === 'march') {
    const ph = (t - BEAT0) / SPB + (g.i % 2) * 0.5;
    st.dy -= Math.abs(Math.sin(Math.PI * ph)) * size * 0.16;
    st.rot += Math.sin(Math.PI * ph) * 0.1;
  }
}

function applyExit(st, kind, v, g, n, size, seed, t) {
  switch (kind) {
    case 'up': {
      st.dy -= E.inC(v) * size * 0.55;
      st.alpha *= 1 - E.outQ(v);
      break;
    }
    case 'fade':
      st.alpha *= 1 - v;
      break;
    case 'scatter': {
      const vv = clamp(v * 1.35 - (g.i / Math.max(1, n)) * 0.35);
      const e = E.inQ(vv);
      const a = rnd(seed, g.i, 9) * TAU;
      st.dx += Math.cos(a) * e * size * 3;
      st.dy += Math.sin(a) * e * size * 3 - e * size;
      st.rot += e * rr(-3, 3, seed, g.i, 8);
      st.alpha *= 1 - vv;
      break;
    }
    case 'glitch': {
      const k = Math.floor(t * 30);
      st.dx += (rnd(seed, g.i, k, 7) - 0.5) * size * v * 1.4;
      if (rnd(seed, g.i, k, 6) < v) st.alpha = 0;
      st.alpha *= 1 - v * 0.6;
      if (rnd(seed, g.i, k, 5) < v) st.ch = scrambleFor(g.font, seed, g.i, k);
      break;
    }
    case 'drop': {
      const vv = clamp(v * 1.4 - rnd(seed, g.i) * 0.4);
      st.dy += vv * vv * 700;
      st.rot += vv * rr(-1, 1, seed, g.i, 4);
      st.alpha *= 1 - vv;
      break;
    }
    case 'cut':
      if (v > 0) st.alpha = 0;
      break;
    case 'stretch':
      st.sx *= 1 + v * 3;
      st.sy *= 1 - v * 0.9;
      st.alpha *= 1 - v;
      break;
    default:
      st.alpha *= 1 - v;
  }
}

const base = () => ({ dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, alpha: 1 });

// ===================================================================================== Renderer
export class Renderer {
  constructor({ cover, audio, lrcText, scale = 1 }) {
    this.k = scale; // output resolution = 1920x1080 * k; all drawing code works in 1920x1080 units
    this.cv = cover;
    this.au = audio;
    this.L = parseLrc(lrcText);
    if (this.L.length !== DIRECTION.length) throw new Error(`direction table (${DIRECTION.length}) != lrc lines (${this.L.length})`);
    this.sections = buildSections(this.L);
    this.duration = audio.duration;
    const k = this.k;
    [this.S, this.s] = scaledCanvas(W, H, k);
    [this.T, this.tx] = scaledCanvas(W, H, k);
    [this.O, this.o] = scaledCanvas(W, H, k);
    [this.R, this.rx] = scaledCanvas(W, H, k);
    [this.Q, this.q] = canvas(W / 4, H / 4); // blur buffer, resolution-independent on purpose
    [this.M, this.mx] = scaledCanvas(W, 360, k);
    this.noise = makeNoiseTiles(8, 384);
    this.noisePat = this.noise.map((c) => this.o.createPattern(c, 'repeat'));
    this.staticPat = this.noise.map((c) => this.s.createPattern(c, 'repeat'));
    this.vignette = makeVignette(k);
    this.scan = makeScanlines(k);
    // vignette + scanlines pre-composited (one full-frame blend per frame instead of two)
    const overlay = (vig, scan) => {
      const [c, x] = scaledCanvas(W, H, k);
      x.globalAlpha = vig;
      x.drawImage(this.vignette, 0, 0, W, H);
      x.globalAlpha = scan;
      x.drawImage(this.scan, 0, 0, W, H);
      return c;
    };
    this.overlays = { normal: overlay(1, 0.28), paper: overlay(0.55, 0.28), crt: overlay(1, 0.75) };
    // at 4K every big bitmap draw is an upscale: bicubic buys nothing visible and costs ~30%
    if (k > 1) for (const c of [this.s, this.tx, this.o, this.rx, this.mx]) c.imageSmoothingQuality = 'medium';
    this.prepare();
  }

  // ------------------------------------------------------------------------------ preparation
  prepare() {
    const ctx = this.s;
    const L = this.L;
    L.forEach((l, i) => {
      const d = { exitDur: 0.3, rowGap: 140, x: W / 2, maxW: 1660, cnGap: null, ...DIRECTION[i] };
      l.d = d;
      const cps = [...l.jp];
      const total = cps.length;
      const dur = l.t1 - l.t0;
      const est = (a) => (a / total) * dur * 0.72;
      let rows = d.rows || [[{ r: [0, total] }]];
      if (d.layout === 'network') rows = d.words.map((w, k) => [{ r: w, at: d.wordAt[k] }]);
      if (d.layout === 'sides' && !d.rows) {
        const sp = cps.indexOf(' ');
        rows = [[{ r: [0, sp], at: 0 }, { r: [sp + 1, total], at: Math.max(0.45, est(sp + 1)) }]];
      }
      let gIndex = 0;
      const mk = (sg) => {
        const str = cps.slice(sg.r[0], sg.r[1]).join('');
        const seg = { font: d.font, size: d.size, fill: d.fill, enter: d.enter, stagger: d.stagger, tracking: d.tracking || 0, fx: d.fx, ...sg };
        seg.at = sg.at ?? est(sg.r[0]);
        seg.L = layout(ctx, str, seg.font, seg.size, { tracking: seg.tracking, space: l.en ? 0.3 : 0.5 });
        seg.gapBefore = sg.r[0] > 0 && cps[sg.r[0] - 1] === ' ' ? seg.size * (l.en ? 0.3 : 0.42) : 0;
        seg.pad = seg.fx === 'stamp' ? seg.size * 0.34 : 0;
        seg.g0 = gIndex;
        gIndex += seg.L.glyphs.length;
        return seg;
      };
      l.rows = rows.map((row) => {
        let segs = row.map(mk);
        let width = segs.reduce((a, s, k) => a + s.L.width + 2 * s.pad + (k ? s.gapBefore : 0), 0);
        if (d.layout !== 'network' && width > d.maxW) {
          const k = d.maxW / width;
          gIndex -= segs.reduce((a, s) => a + s.L.glyphs.length, 0);
          segs = row.map((sg) => mk({ ...sg, size: Math.floor((sg.size || d.size) * k) }));
          width = segs.reduce((a, s, j) => a + s.L.width + 2 * s.pad + (j ? s.gapBefore : 0), 0);
        }
        return { segs, width, size: Math.max(...segs.map((s) => s.L.size)) };
      });
      l.rows.forEach((row, k) => {
        let x = d.x - row.width / 2;
        row.segs.forEach((seg, j) => {
          if (j) x += seg.gapBefore;
          x += seg.pad;
          seg.px0 = x;
          seg.py0 = d.y + k * d.rowGap;
          x += seg.L.width + seg.pad;
        });
      });
      if (l.cn) l.cnL = layout(ctx, l.cn, d.cnFont || 'SC', d.cnSize || 40, { space: 0.45, tracking: 0.03 });
      if (d.layout === 'stairs') this.prepStairs(l, cps, est);
    });
    L.forEach((l, i) => {
      l.tExit = l.d.hold ? L[i + 1].t1 : l.t1;
    });
    this.buildNetwork();
    this.buildEvents();
  }

  prepStairs(l, cps, est) {
    const d = l.d;
    const pos = [];
    let p = 0;
    let phrase = 0;
    let j = 0;
    let phraseStart = 0;
    const size = d.size;
    cps.forEach((ch, k) => {
      if (ch === ' ') {
        p += 0.7;
        phrase++;
        j = 0;
        phraseStart = est(k + 1);
        return;
      }
      pos.push({ ch, x: 330 + p * 160, y: 255 + p * 58, at: phraseStart + j * 0.09, phrase, i: pos.length });
      const comma = '、，,。'.includes(ch);
      p += comma ? 0.55 : 1;
      j++;
      if (comma) {
        phrase++;
        j = 0;
        phraseStart = est(k + 1);
      }
    });
    l.stairs = { pos, size, w: layout(this.s, cps.join(''), d.font, size).glyphs };
  }

  buildNetwork() {
    const targets = [
      [480, 330], [1440, 400], [900, 690], [300, 790], // line 17
      [400, 250], [1500, 270], [560, 720], [1380, 700], // line 35
      [960, 200], [250, 520], [1670, 500], [980, 520], // line 36
    ];
    const nodes = targets.map(([x, y], k) => ({ x, y, k, ph: rnd('nph', k) }));
    let tries = 0;
    while (nodes.length < 40 && tries < 8000) {
      tries++;
      const x = rr(90, W - 90, 'nx', tries);
      const y = rr(110, H - 150, 'ny', tries);
      if (nodes.every((n) => Math.hypot(n.x - x, n.y - y) > 190)) nodes.push({ x, y, k: nodes.length, ph: rnd('nph', nodes.length) });
    }
    const edges = [];
    const seen = new Set();
    nodes.forEach((a) => {
      const near = nodes.filter((b) => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
      near.slice(0, 3).forEach((b) => {
        const key = a.k < b.k ? `${a.k}-${b.k}` : `${b.k}-${a.k}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ a, b, j: edges.length, len: Math.hypot(a.x - b.x, a.y - b.y) });
        }
      });
    });
    this.net = { nodes, edges, targets: { 17: [0, 1, 2, 3], 35: [4, 5, 6, 7], 36: [8, 9, 10, 11] } };
  }

  buildEvents() {
    const imp = [];
    const glitch = [];
    this.L.forEach((l) => {
      const d = l.d;
      if (d.impact) imp.push({ t: l.t0 + (d.impact.at ?? 0), ...d.impact });
      l.rows.forEach((row) =>
        row.segs.forEach((seg) => {
          if (seg.impact) imp.push({ t: l.t0 + seg.at, ...seg.impact });
          else if (d.perSegImpact) imp.push({ t: l.t0 + seg.at, amp: d.perSegImpact, flash: 0.14 });
          if (seg.fx === 'stamp') imp.push({ t: l.t0 + seg.at + 0.05, amp: 18, flash: 0.3, flashCol: COL.red });
        }),
      );
      if (d.layout === 'sides') imp.push({ t: l.t0 + l.rows[0].segs[1].at + 0.2, amp: 14, flash: 0.35 });
      if (d.exit === 'glitch') glitch.push({ t: l.tExit, g: 0.7, dur: d.exitDur + 0.1 });
    });
    imp.push({ t: this.cancelClickTime(this.L[28]), amp: 9, flash: 0.3, flashCol: COL.red });
    imp.push({ t: SONG_START, amp: 12, flash: 0.9 });
    imp.push({ t: Audio.beatTime(89), amp: 18, flash: 0.55, invert: 0.05 }); // pre-chorus 1 hit
    imp.push({ t: Audio.beatTime(141), amp: 12, flash: 0.45 }); // interlude crash
    imp.push({ t: this.L[34].t1, amp: 10, flash: 0.3 });
    imp.push({ t: 133.56, amp: 16, flash: 0.5, invert: 0.05 }); // outro bass drop
    imp.push({ t: FINAL_HIT, amp: 10, flash: 0.7 });
    imp.sort((a, b) => a.t - b.t);
    this.impacts = imp;
    for (const s of this.sections) if (s.t0 > 0) glitch.push({ t: s.t0 - 0.06, g: 1, dur: 0.32 });
    glitch.push({ t: SONG_START, g: 1, dur: 0.5 });
    glitch.push({ t: FINAL_HIT, g: 1, dur: 0.4 });
    // the tape rewinds through 1:46 (see vhsScreen)
    const l30 = this.L[30];
    glitch.push({ t: l30.t0, g: 0.22, dur: l30.rows[1].segs[0].at, flat: true });
    for (const e of imp) glitch.push({ t: e.t, g: 0.45, dur: 0.18 });
    glitch.sort((a, b) => a.t - b.t);
    this.glitches = glitch;
  }

  secAt(t) {
    let s = this.sections[0];
    for (const x of this.sections) if (t >= x.t0) s = x;
    return s;
  }

  // ------------------------------------------------------------------------------- dynamics
  camera(t, st) {
    let shake = 0;
    let punch = 0;
    for (const ev of this.impacts) {
      const dt = t - ev.t;
      if (dt < 0) break;
      if (dt < 0.8) {
        shake += ev.amp * Math.exp(-dt * 8);
        punch += ev.amp * 0.0022 * Math.exp(-dt * 7);
      }
    }
    shake += (st.shake || 0) * 7 * this.au.hit(this.au.kicks, t, 14, 0.25, 0.3);
    return {
      x: noise1(t * 30, 11) * shake,
      y: noise1(t * 30, 12) * shake,
      rot: noise1(t * 0.23, 13) * 0.006 + noise1(t * 24, 14) * shake * 0.0009,
      zoom: 1 + (st.zoomPulse || 0) * 0.016 * this.au.pulse(t, 7) + punch,
    };
  }

  applyCam(ctx, cam, k = 1) {
    ctx.translate(W / 2 + cam.x * k, H / 2 + cam.y * k);
    ctx.rotate(cam.rot * k);
    const z = 1 + (cam.zoom - 1) * k;
    ctx.scale(z, z);
    ctx.translate(-W / 2, -H / 2);
  }

  flashAt(t, st) {
    let a = 0;
    let col = '#ffffff';
    for (const ev of this.impacts) {
      const dt = t - ev.t;
      if (dt < 0) break;
      if (dt < 0.6 && ev.flash) {
        const v = ev.flash * Math.exp(-dt * 10);
        if (v > a) {
          a = v;
          col = ev.flashCol || '#ffffff';
        }
      }
    }
    if (st.kickFlash) {
      const k = st.kickFlash * this.au.hit(this.au.kicks, t, 16, 0.2, 0.55);
      if (k > a) {
        a = k;
        col = '#ffffff';
      }
    }
    return { a, col };
  }

  invertAt(t) {
    for (const ev of this.impacts) {
      if (ev.t > t) break;
      if (ev.invert && t - ev.t < ev.invert) return true;
    }
    return false;
  }

  glitchAt(t, sec) {
    let g = 0;
    for (const ev of this.glitches) {
      if (ev.t > t) break;
      const dt = t - ev.t;
      if (dt < ev.dur) g = Math.max(g, ev.flat ? ev.g : ev.g * (1 - dt / ev.dur));
    }
    if (sec.id.startsWith('chorus') || sec.id === 'outro') g = Math.max(g, 0.35 * this.au.hit(this.au.snares, t, 18, 0.15, 0.6));
    return g;
  }

  // ================================================================================== frame
  frame(t) {
    const sec = this.secAt(t);
    const st = STYLE[sec.id];
    const cam = this.camera(t, st);
    const s = this.s;
    const tx = this.tx;

    // ---- background scene
    this.base(s);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
    s.fillStyle = COL.black;
    s.fillRect(0, 0, W, H);
    s.save();
    this.applyCam(s, cam, 0.6);
    this.background(s, t, sec, st);
    s.restore();

    // ---- kinetic type layer
    this.base(tx);
    tx.clearRect(0, 0, W, H);
    tx.save();
    this.applyCam(tx, cam, 1);
    let rgb = 0;
    this.cnQueue = [];
    for (const l of this.L) {
      if (t < l.t0 - 0.5 || t > l.tExit + l.d.exitDur + 1.6) continue;
      this.motif(tx, l, t, 'under');
    }
    for (const l of this.L) {
      if (t < l.t0 - 0.4 || t > l.tExit + l.d.exitDur) continue;
      this.drawLine(tx, l, t);
      if (l.d.rgb && t >= l.t0 && t < l.tExit) rgb = Math.max(rgb, l.d.rgb);
    }
    for (const l of this.L) {
      if (t < l.t0 - 0.5 || t > l.tExit + l.d.exitDur + 0.6) continue;
      this.motif(tx, l, t, 'over');
    }
    tx.restore();
    for (const ev of this.impacts) {
      const dt = t - ev.t;
      if (dt < 0) break;
      if (dt < 0.4) rgb = Math.max(rgb, ev.amp * 0.8 * Math.exp(-dt * 9));
    }
    this.compositeText(t, st, st.paper ? 0 : rgb);
    if (this.cnQueue.length) {
      s.save();
      this.applyCam(s, cam, 1);
      s.shadowColor = st.paper ? 'rgba(248,246,240,0.95)' : 'rgba(0,0,0,0.95)';
      s.shadowBlur = 14 * this.k; // shadows are specified in device pixels
      s.shadowOffsetY = 3 * this.k;
      for (const q of this.cnQueue) this.drawCn(s, ...q);
      s.restore();
    }

    // ---- post
    return this.post(t, sec, st);
  }

  compositeText(t, st, rgb) {
    const s = this.s;
    const q = this.q;
    const qw = W / 4;
    const qh = H / 4;
    if (st.shadow) {
      q.globalCompositeOperation = 'copy';
      q.filter = 'blur(3px)';
      q.drawImage(this.T, 0, 0, qw, qh);
      q.filter = 'none';
      q.globalCompositeOperation = 'source-in';
      q.fillStyle = st.shadow === 'dark' ? 'rgba(0,0,0,0.92)' : 'rgba(250,248,242,0.95)';
      q.fillRect(0, 0, qw, qh);
      q.globalCompositeOperation = 'source-over';
      s.drawImage(this.Q, 0, 5, W, H);
    }
    if (st.glow > 0) {
      q.globalCompositeOperation = 'copy';
      q.filter = 'blur(6px)';
      q.drawImage(this.T, 0, 0, qw, qh);
      q.filter = 'none';
      q.globalCompositeOperation = 'source-in';
      q.fillStyle = st.glowCol || '#ffffff';
      q.fillRect(0, 0, qw, qh);
      q.globalCompositeOperation = 'source-over';
      s.save();
      s.globalCompositeOperation = 'lighter';
      s.globalAlpha = st.glow * (0.8 + 0.4 * this.au.f('rms', t));
      s.drawImage(this.Q, 0, 0, W, H);
      s.restore();
    }
    if (rgb > 0.5) {
      const r = this.rx;
      s.save();
      s.globalCompositeOperation = 'lighter';
      for (const [col, dx] of [['#ff1030', -rgb], ['#00d8ff', rgb]]) {
        r.globalCompositeOperation = 'copy';
        r.drawImage(this.T, 0, 0, W, H);
        r.globalCompositeOperation = 'source-in';
        r.fillStyle = col;
        r.fillRect(0, 0, W, H);
        s.globalAlpha = 0.75;
        s.drawImage(this.R, dx, dx * 0.25, W, H);
      }
      s.restore();
      r.globalCompositeOperation = 'source-over';
    }
    s.drawImage(this.T, 0, 0, W, H);
  }

  /** reset a full-frame canvas to its base (logical 1920x1080) transform */
  base(ctx) {
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
  }

  post(t, sec, st) {
    const o = this.o;
    this.base(o);
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';
    o.drawImage(this.S, 0, 0, W, H);
    const g = this.glitchAt(t, sec);
    if (g > 0.02) this.slices(o, t, g);
    const f = this.flashAt(t, st);
    if (f.a > 0.01) {
      o.globalCompositeOperation = 'screen';
      o.globalAlpha = Math.min(1, f.a);
      o.fillStyle = f.col;
      o.fillRect(0, 0, W, H);
      o.globalAlpha = 1;
      o.globalCompositeOperation = 'source-over';
    }
    if (this.invertAt(t)) {
      o.globalCompositeOperation = 'difference';
      o.fillStyle = '#ffffff';
      o.fillRect(0, 0, W, H);
      o.globalCompositeOperation = 'source-over';
    }
    // film grain (changes at 24 Hz)
    const k = Math.floor(t * 24);
    o.save();
    o.globalCompositeOperation = 'overlay';
    o.globalAlpha = st.grain;
    o.translate(-Math.floor(rnd(k, 1) * 384), -Math.floor(rnd(k, 2) * 384));
    o.imageSmoothingEnabled = false; // noise sampled nearest: same look, half the cost
    o.fillStyle = this.noisePat[k % this.noisePat.length];
    o.fillRect(0, 0, W + 384, H + 384);
    o.restore();
    const ov = st.paper ? 'paper' : sec.id === 'bridge' && t < this.L[29].t0 ? 'crt' : 'normal';
    o.drawImage(this.overlays[ov], 0, 0, W, H);
    this.hud(o, t, sec, st);
    this.disclaimer(o, t);
    // fade in from / out to black
    const fade = Math.max(1 - smooth(0, 0.06, t), smooth(FINAL_HIT + 0.04, FINAL_HIT + 0.48, t));
    if (fade > 0) {
      o.globalAlpha = fade;
      o.fillStyle = '#000';
      o.fillRect(0, 0, W, H);
      o.globalAlpha = 1;
    }
    return this.O;
  }

  slices(o, t, g) {
    const k = Math.floor(t * 30);
    const n = Math.floor(3 + g * 12);
    for (let i = 0; i < n; i++) {
      if (rnd(k, i, 1) > g + 0.1) continue;
      const y = Math.floor(rnd(k, i, 2) * H);
      const h = Math.floor(3 + rnd(k, i, 3) * 80 * g);
      const dx = Math.round((rnd(k, i, 4) - 0.5) * 260 * g);
      const sk = this.k;
      o.drawImage(this.S, 0, y * sk, W * sk, h * sk, dx, y, W, h);
      if (rnd(k, i, 5) < 0.3 * g) {
        o.globalCompositeOperation = 'difference';
        o.fillStyle = rnd(k, i, 6) < 0.5 ? '#ffffff' : COL.red;
        o.fillRect(0, y, W, h);
        o.globalCompositeOperation = 'source-over';
      }
    }
    // a few solid blocks
    for (let i = 0; i < 3; i++) {
      if (rnd(k, i, 9) > g * 0.5) continue;
      o.fillStyle = rnd(k, i, 10) < 0.5 ? COL.red : '#f0f0f0';
      o.globalAlpha = 0.85;
      o.fillRect(rnd(k, i, 11) * W, rnd(k, i, 12) * H, 20 + rnd(k, i, 13) * 260 * g, 4 + rnd(k, i, 14) * 30);
      o.globalAlpha = 1;
    }
  }

  // ================================================================================ backgrounds
  cover(s, img, cx, cy, sw, { flip = false, alpha = 1 } = {}) {
    const N = this.cv.size;
    sw = Math.min(sw, N);
    const sh = (sw * H) / W;
    const sx = clamp(cx - sw / 2, 0, N - sw);
    const sy = clamp(cy - sh / 2, 0, N - sh);
    s.save();
    s.globalAlpha = alpha;
    if (flip) {
      s.translate(W, 0);
      s.scale(-1, 1);
    }
    s.drawImage(img, sx, sy, sw, sh, -60, -34, W + 120, H + 68);
    s.restore();
  }

  dim(s, a, col = '#000') {
    if (a <= 0) return;
    s.save();
    s.globalAlpha = Math.min(1, a);
    s.fillStyle = col;
    s.fillRect(-100, -100, W + 200, H + 200);
    s.restore();
  }

  /** the album art as a floating card */
  card(s, t, size, { x = W / 2, y = H / 2, rot = 0, alpha = 1, img = this.cv.small, back = null, flip = 0, glitch = 0 } = {}) {
    // flip: rotation about the vertical axis in turns (0..1 shows the back half way through)
    const c = Math.cos(flip * Math.PI);
    const face = c < 0 && back ? back : img;
    s.save();
    s.globalAlpha = alpha;
    s.translate(x, y);
    s.rotate(rot);
    s.scale(Math.max(0.02, Math.abs(c)), 1 + (1 - Math.abs(c)) * 0.06);
    s.fillStyle = 'rgba(0,0,0,0.6)';
    s.fillRect(-size / 2 + 18, -size / 2 + 24, size, size);
    s.drawImage(face, -size / 2, -size / 2, size, size);
    if (glitch > 0.05) {
      const k = Math.floor(t * 30);
      const N = face.width;
      for (let i = 0; i < 7; i++) {
        if (rnd(k, i, 'cg') > glitch) continue;
        const v0 = rnd(k, i, 'cy');
        const vh = 0.01 + rnd(k, i, 'ch') * 0.08;
        const dx = (rnd(k, i, 'cx') - 0.5) * size * 0.25 * glitch;
        s.drawImage(face, 0, v0 * N, N, vh * N, -size / 2 + dx, -size / 2 + v0 * size, size, vh * size);
      }
    }
    s.strokeStyle = 'rgba(255,255,255,0.85)';
    s.lineWidth = 2;
    s.strokeRect(-size / 2 - 10, -size / 2 - 10, size + 20, size + 20);
    s.restore();
  }

  rays(s, t, x, y, amt) {
    s.save();
    s.globalCompositeOperation = 'lighter';
    s.translate(x, y);
    s.rotate(t * 0.12);
    s.fillStyle = '#ffffff';
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      const w = 0.05 + 0.04 * Math.sin(t * 0.7 + i * 1.7);
      s.globalAlpha = amt * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 2.1)));
      s.beginPath();
      s.moveTo(0, 0);
      s.arc(0, 0, 1500, a - w, a + w);
      s.closePath();
      s.fill();
    }
    s.restore();
  }

  background(s, t, sec, st) {
    const L = this.L;
    const au = this.au;
    const kick = au.hit(au.kicks, t, 9, 0.4, 0.3);
    switch (sec.id) {
      case 'intro': {
        // full-bleed hand behind, the cover as a card that flies through at the verse start
        const pan = (t - 0) / 3.8;
        this.cover(s, this.cv.plain, lerp(820, 860, pan), 1120, 1500);
        this.dim(s, 0.62 - kick * 0.12);
        if (st.dust) this.dust(s, t, st.dust);
        const fly = ez(E.inC, (t - 3.25) / 0.55);
        const size = lerp(1060, 860, ez(E.outX, (t - 0.05) / 1.6)) * (1 + fly * 2.6) * (1 + 0.012 * au.pulse(t, 8));
        this.card(s, t, size, { img: this.cv.img, rot: noise1(t * 0.6, 3) * 0.015, alpha: 1 - fly });
        this.introCredits(s, t);
        break;
      }
      case 'verse1': {
        const l2 = L[2];
        const l3 = L[3];
        const p = ez(E.ioC, (t - sec.t0) / (sec.t1 - sec.t0));
        const flip = t >= l2.t0 && t < l2.t1;
        const red = t >= l3.t0 && t < l3.t1;
        const flick = rnd(Math.floor(t * 18), 77) < 0.035 ? 0.18 : 0;
        this.cover(s, red ? this.cv.red : this.cv.plain, lerp(760, 1180, p), lerp(1130, 1050, p), lerp(1500, 1300, p), { flip });
        this.dim(s, 0.58 - kick * 0.1 + flick);
        if (flip) this.mirrorLine(s, t, l2);
        if (t >= L[1].t0 - 0.3 && t < L[1].t1 + 0.4) this.tunnel(s, t, L[1]);
        if (t >= L[7].t0) this.redline(s, t);
        this.dust(s, t, st.dust);
        this.osc(s, t, st.osc * smooth(5.0, 5.6, t), 880);
        break;
      }
      case 'break1': {
        this.cover(s, this.cv.plain, 1000, 1150, lerp(1700, 1450, (t - sec.t0) / 8));
        this.dim(s, 0.8);
        this.redline(s, t);
        this.dust(s, t, st.dust);
        this.osc(s, t, st.osc, 820);
        break;
      }
      case 'pre1':
      case 'pre2': {
        const two = sec.id === 'pre2';
        const p = (t - sec.t0) / (sec.t1 - sec.t0);
        this.cover(s, this.cv.red, two ? lerp(700, 900, p) : lerp(1500, 1300, p), lerp(1250, 1150, p), lerp(1250, 1100, p));
        this.dim(s, (two ? 0.35 : 0.5) - kick * 0.15);
        this.beacon(s, t, two ? 1 : 0.8);
        this.embers(s, t, st.embers);
        this.spectrum(s, t, st.spectrum);
        break;
      }
      case 'chorus1':
      case 'chorus2': {
        const b = au.beat(t);
        const shot = Math.floor((b.idx - 1) / 8);
        const views = [
          [this.cv.plain, 1000, 1180, 1750],
          [this.cv.red, 640, 1260, 1050],
          [this.cv.plain, 1450, 1150, 1150],
          [this.cv.red, 960, 1100, 1400],
          [this.cv.plain, 520, 1100, 1200],
          [this.cv.red, 1300, 1400, 1250],
        ];
        const [img, cx, cy, sw] = views[(((shot + (sec.id === 'chorus2' ? 3 : 0)) % views.length) + views.length) % views.length];
        const local = ((b.idx - 1) % 8 + b.phase) / 8;
        this.cover(s, img, cx + local * 60, cy - local * 30, sw * (1 - local * 0.06));
        this.dim(s, 0.5 - kick * 0.2);
        this.burst(s, t);
        this.embers(s, t, st.embers);
        this.spectrum(s, t, st.spectrum);
        break;
      }
      case 'inter': {
        const p = (t - sec.t0) / (sec.t1 - sec.t0);
        s.drawImage(this.cv.blur, -100, -520, W + 200, W + 200);
        this.dim(s, 0.72 - kick * 0.12);
        this.marquee(s, t, 0.13);
        this.spectrum(s, t, st.spectrum);
        this.embers(s, t, st.embers);
        const out = ez(E.inC, (t - (sec.t1 - 0.7)) / 0.7);
        const sz = (600 + 20 * au.pulse(t, 8)) * (1 + out * 3);
        const bob = Math.sin(t * 1.3) * 10;
        this.rays(s, t, W / 2, 500, 0.05 * (1 - out));
        let flip = 0;
        for (const bt of [152, 160, 168]) flip += ez(E.ioC, (t - Audio.beatTime(bt)) / 0.55);
        const g = au.hit(au.snares, t, 14, 0.25, 0.5);
        this.card(s, t, sz, { y: 500 + bob, rot: Math.sin(t * 0.8) * 0.03, alpha: 1 - out * 0.9, back: this.cv.paperSmall, flip, glitch: g });
        this.interText(s, t, sec, p);
        break;
      }
      case 'verse2': {
        const p = ez(E.ioC, (t - sec.t0) / (sec.t1 - sec.t0));
        this.cover(s, this.cv.paper, lerp(1250, 850, p), lerp(1150, 1080, p), lerp(1350, 1550, p));
        this.dim(s, 0.5 + kick * 0.08, '#f2eee6');
        this.grid(s, t);
        break;
      }
      case 'break2': {
        this.cover(s, this.cv.plain, 1024, 1100, 1800);
        this.dim(s, 0.82);
        const lvl = t >= L[25].t0 ? 1 : 0;
        this.hateRows(s, t, lvl, t >= L[25].t0 ? L[25].t0 : L[24].t0);
        this.spectrum(s, t, st.spectrum);
        break;
      }
      case 'bridge': {
        const l28 = L[28];
        const l29 = L[29];
        const l30 = L[30];
        if (t < l29.t0) {
          this.cover(s, this.cv.plain, 1024, 1150, 1600);
          this.dim(s, 0.82);
          this.noiseScreen(s, t, l28);
        } else if (t < l30.t0) {
          this.cover(s, this.cv.plain, lerp(900, 1100, (t - l29.t0) / 3.4), 1120, 1350);
          this.dim(s, 0.68 - kick * 0.1);
        } else {
          const play = l30.t0 + l30.rows[1].segs[0].at;
          const wob = t < play ? noise1(t * 9, 21) * 26 : 0;
          this.cover(s, this.cv.plain, 1024 + wob, 1150, lerp(1500, 1250, (t - l30.t0) / 5));
          this.dim(s, t < play ? 0.74 : 0.7);
          this.vhsScreen(s, t, l30, play);
        }
        this.dust(s, t, st.dust);
        break;
      }
      case 'gap':
      case 'outro': {
        const p = (t - sec.t0) / Math.max(1, sec.t1 - sec.t0);
        this.cover(s, sec.id === 'gap' ? this.cv.plain : this.cv.red, lerp(1100, 900, p), 1150, lerp(1600, 1250, p));
        this.dim(s, 0.66 - kick * 0.18);
        if (sec.id === 'gap') this.noSide(s, t, sec);
        this.network(s, t, sec);
        this.embers(s, t, st.embers);
        this.spectrum(s, t, st.spectrum);
        break;
      }
      case 'end': {
        const p = (t - sec.t0) / 6.2;
        s.drawImage(this.cv.blur, -100, -520, W + 200, W + 200);
        this.dim(s, 0.75 - kick * 0.1);
        this.marquee(s, t, 0.11);
        this.spectrum(s, t, st.spectrum);
        this.embers(s, t, st.embers);
        const inn = ez(E.outX, (t - sec.t0) / 0.9);
        this.card(s, t, lerp(1400, 640, inn) * (1 + 0.012 * au.pulse(t, 8)) * (1 + p * 0.05), { y: 505, rot: (1 - inn) * 0.08 });
        this.endText(s, t, sec);
        break;
      }
    }
  }

  // ------------------------------------------------------------------------ bg building blocks
  dust(s, t, amt) {
    if (!amt) return;
    s.save();
    s.fillStyle = '#ffffff';
    for (let i = 0; i < 80; i++) {
      const z = rr(0.3, 1, 'dz', i);
      const x = ((rr(0, W + 80, 'dx', i) + t * rr(-14, 14, 'dvx', i) * z + Math.sin(t * rr(0.2, 0.9, 'df', i) + i) * 30) % (W + 80) + W + 80) % (W + 80) - 40;
      const y = ((rr(0, H + 80, 'dy', i) - t * rr(6, 30, 'dvy', i) * z) % (H + 80) + H + 80) % (H + 80) - 40;
      const a = amt * z * (0.35 + 0.35 * Math.sin(t * rr(1, 3, 'dfl', i) + i * 2));
      if (a <= 0.02) continue;
      s.globalAlpha = a;
      const r = 1 + z * 2.4;
      s.fillRect(x, y, r, r);
    }
    s.restore();
  }

  embers(s, t, amt) {
    if (!amt) return;
    s.save();
    s.globalCompositeOperation = 'lighter';
    const life = 3.2;
    for (let i = 0; i < 70; i++) {
      const off = rnd('eo', i) * life;
      const cyc = Math.floor((t + off) / life);
      const u = ((t + off) % life) / life;
      const x0 = rr(0, W, 'ex', i, cyc);
      const x = x0 + Math.sin(u * 6 + i) * 40 + u * rr(-120, 120, 'evx', i, cyc);
      const y = H + 30 - u * rr(500, 1100, 'evy', i, cyc);
      const a = amt * Math.sin(u * Math.PI) * rr(0.4, 1, 'ea', i);
      const r = rr(1.5, 4.5, 'er', i);
      s.globalAlpha = a;
      s.fillStyle = rnd('ec', i) < 0.25 ? '#ffd0b0' : COL.redHot;
      s.fillRect(x, y, r, r * 2.2);
    }
    s.restore();
  }

  spectrum(s, t, amt) {
    if (!amt) return;
    const sp = this.au.spec(t);
    const n = 40;
    const bw = W / (n * 2);
    const base = H - 64;
    s.save();
    for (let k = 0; k < n; k++) {
      const v = (sp[k] / 255) ** 1.6;
      const h = 4 + v * 170 * amt;
      for (const side of [-1, 1]) {
        const x = side < 0 ? W / 2 - (k + 1) * bw : W / 2 + k * bw;
        s.globalAlpha = 0.55 * amt;
        s.fillStyle = COL.red;
        s.fillRect(x + bw * 0.2, base - h, bw * 0.6, h);
        s.globalAlpha = 0.8 * amt;
        s.fillStyle = '#ffffff';
        s.fillRect(x + bw * 0.2, base - h - 5, bw * 0.6, 2);
      }
    }
    s.restore();
  }

  osc(s, t, amt, y) {
    if (!amt) return;
    const n = 360;
    const w = this.au.wave(t, n, 0.05);
    s.save();
    s.globalAlpha = amt;
    s.strokeStyle = '#ffffff';
    s.lineWidth = 2;
    s.beginPath();
    for (let k = 0; k < n; k++) {
      const x = 100 + (k / (n - 1)) * (W - 200);
      const env = Math.sin((k / (n - 1)) * Math.PI);
      const yy = y + w[k] * 210 * env;
      if (k) s.lineTo(x, yy);
      else s.moveTo(x, yy);
    }
    s.stroke();
    s.restore();
  }

  beacon(s, t, amt) {
    // rotating emergency light, flashing on alternate beats
    const b = this.au.beat(t);
    const on = b.idx % 2 === 0 ? Math.exp(-b.phase * 2.5) : 0.15;
    const ang = t * 2.4;
    s.save();
    s.globalCompositeOperation = 'lighter';
    s.globalAlpha = 0.45 * amt * on;
    const cx = W / 2 + Math.cos(ang) * 700;
    const cy = H / 2 + Math.sin(ang) * 260;
    const g = s.createRadialGradient(cx, cy, 0, cx, cy, 900);
    g.addColorStop(0, 'rgba(255,40,30,0.9)');
    g.addColorStop(1, 'rgba(255,40,30,0)');
    s.fillStyle = g;
    s.fillRect(0, 0, W, H);
    s.restore();
  }

  burst(s, t) {
    // radial speed lines after big hits
    let best = null;
    for (const ev of this.impacts) {
      if (ev.t > t) break;
      if (t - ev.t < 0.5 && ev.amp >= 14) best = ev;
    }
    if (!best) return;
    const u = (t - best.t) / 0.5;
    s.save();
    s.translate(W / 2, H / 2);
    s.strokeStyle = '#ffffff';
    for (let i = 0; i < 64; i++) {
      const a = rnd('ba', i, Math.floor(best.t * 10)) * TAU;
      const r0 = lerp(200, 900, E.outC(u)) * rr(0.6, 1.2, 'br', i);
      const len = rr(80, 400, 'bl', i) * (1 - u);
      s.globalAlpha = 0.5 * (1 - u);
      s.lineWidth = rr(1, 4, 'bw', i);
      s.beginPath();
      s.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      s.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len));
      s.stroke();
    }
    s.restore();
  }

  marquee(s, t, alpha) {
    s.save();
    s.font = '300px AntonioBold';
    s.textBaseline = 'middle';
    s.strokeStyle = '#ffffff';
    s.lineWidth = 2;
    const str = `${TITLE}  ${TITLE}  ${TITLE}  `;
    const w = s.measureText(`${TITLE}  `).width;
    for (const [y, dir, a] of [[160, 1, alpha], [930, -1, alpha * 0.8]]) {
      s.globalAlpha = a;
      const x = -((((t * 90 * dir) % w) + w) % w);
      s.strokeText(str, x, y);
    }
    s.restore();
  }

  interText(s, t, sec, p) {
    const a = smooth(sec.t0, sec.t0 + 0.6, t) * (1 - smooth(sec.t1 - 0.6, sec.t1 - 0.2, t));
    if (a <= 0) return;
    text(s, 'INSTRUMENTAL', W / 2, 870, 'Mono', 26, '#ffffff', { align: 'center', alpha: a * 0.8, tracking: 12 });
    const b = this.au.beat(t);
    for (let i = 0; i < 16; i++) {
      const on = (b.idx % 16) === i;
      s.fillStyle = on ? COL.redHot : 'rgba(255,255,255,0.25)';
      s.globalAlpha = a;
      s.fillRect(W / 2 - 16 * 14 + i * 28, 905, 18, on ? 8 : 4);
    }
    s.globalAlpha = 1;
  }

  endText(s, t, sec) {
    const a = smooth(sec.t0 + 0.5, sec.t0 + 1.2, t);
    text(s, ARTIST, W / 2, 868, 'KakuBlack', 38, '#ffffff', { align: 'center', alpha: a, tracking: 12 });
    text(s, TITLE, W / 2, 922, 'AntonioBold', 44, '#ffffff', { align: 'center', alpha: a, tracking: 14 });
    text(s, 'LYRIC VIDEO', W / 2, 968, 'Mono', 20, COL.redHot, { align: 'center', alpha: a * 0.9, tracking: 10 });
  }

  /** intro: the artist name (vertical, left) and song title (rotated, right) flank the album art */
  introCredits(s, t) {
    const a = ez(E.outC, (t - 0.3) / 0.5) * (1 - ez(E.inC, (t - 3.15) / 0.45));
    if (a <= 0) return;
    const slide = (1 - ez(E.outX, (t - 0.3) / 0.7)) * 140;
    const chars = [...ARTIST];
    const lh = 116;
    const y0 = H / 2 - ((chars.length - 1) * lh) / 2;
    s.save();
    s.globalAlpha = a;
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    s.shadowColor = 'rgba(0,0,0,0.9)';
    s.shadowBlur = 20 * this.k;
    s.font = '100px KakuBlack';
    s.fillStyle = COL.white;
    chars.forEach((ch, i) => {
      const k = Math.floor(t * 24);
      const settle = t > 0.3 + 0.12 * i + 0.25;
      s.fillText(settle ? ch : scrambleFor('KakuBlack', 'ic', i, k), 238 - slide, y0 + i * lh);
    });
    s.shadowBlur = 0;
    s.fillStyle = COL.redHot;
    s.fillRect(238 - slide + 78, y0 - 56, 5, (chars.length - 1) * lh + 112);
    s.translate(W - 238 + slide, H / 2);
    s.rotate(Math.PI / 2);
    s.font = '66px AntonioBold';
    s.letterSpacing = '12px';
    s.fillStyle = COL.white;
    s.shadowColor = 'rgba(0,0,0,0.9)';
    s.shadowBlur = 20 * this.k;
    s.fillText(TITLE, 0, 0);
    s.restore();
  }

  grid(s, t) {
    s.save();
    s.strokeStyle = 'rgba(20,20,20,0.10)';
    s.lineWidth = 1;
    const off = (t * 20) % 96;
    s.beginPath();
    for (let x = -96 + off; x < W + 96; x += 96) {
      s.moveTo(x, 0);
      s.lineTo(x, H);
    }
    for (let y = 0; y < H; y += 96) {
      s.moveTo(0, y);
      s.lineTo(W, y);
    }
    s.stroke();
    s.restore();
  }

  mirrorLine(s, t, l) {
    const y = l.d.y + l.d.size * 0.62;
    const a = smooth(l.t0, l.t0 + 0.4, t) * (1 - smooth(l.t1 - 0.2, l.t1, t));
    const g = s.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    s.save();
    s.globalAlpha = a;
    s.fillStyle = g;
    s.fillRect(0, y, W, 2);
    s.restore();
  }

  tunnel(s, t, l) {
    const a = smooth(l.t0 - 0.3, l.t0 + 0.4, t) * (1 - smooth(l.t1 - 0.1, l.t1 + 0.4, t));
    if (a <= 0) return;
    const n = 16;
    const ph = ((t - l.t0) * 0.55) % 1;
    const vx = W / 2 + noise1(t * 0.4, 5) * 80;
    const vy = H / 2 + noise1(t * 0.4, 6) * 40;
    s.save();
    s.strokeStyle = '#ffffff';
    for (let k = 0; k < n; k++) {
      const z = (k + ph) / n;
      const sc = z ** 2.4 * 1.5;
      if (sc < 0.01) continue;
      const w = W * sc;
      const h = H * sc;
      s.globalAlpha = a * 0.5 * smooth(0, 0.25, z) * (1 - smooth(0.85, 1, z));
      s.lineWidth = 1 + z * 4;
      s.strokeRect(lerp(vx, W / 2, z) - w / 2, lerp(vy, H / 2, z) - h / 2, w, h);
    }
    // receding "doors" (reception windows) never reached
    for (let k = 0; k < n; k++) {
      const z = (k + ph) / n;
      const sc = z ** 2.4 * 1.5;
      if (k % 4 !== 1) continue;
      s.globalAlpha = a * 0.22 * smooth(0, 0.3, z) * (1 - smooth(0.55, 0.8, z));
      s.fillStyle = COL.red;
      s.fillRect(lerp(vx, W / 2, z) + W * sc * 0.3, lerp(vy, H / 2, z) - H * sc * 0.1, W * sc * 0.06, H * sc * 0.2);
    }
    s.restore();
  }

  redline(s, t) {
    const l7 = this.L[7];
    const l10 = this.L[10];
    const y = 562;
    const draw = ez(E.outX, (t - l7.t0) / 0.7);
    const snap = clamp((t - l10.t0) / 0.75);
    const fade = 1 - smooth(l10.t1 - 0.05, l10.t1 + 0.1, t);
    if (fade <= 0) return;
    s.save();
    s.globalAlpha = fade;
    s.fillStyle = COL.redHot;
    s.shadowColor = COL.redHot;
    s.shadowBlur = 24 * this.k;
    if (snap <= 0) {
      s.fillRect(0, y - 3, W * draw, 6);
    } else {
      const e = E.inQ(snap);
      for (const side of [-1, 1]) {
        s.save();
        const px = side < 0 ? 0 : W;
        s.translate(px, y);
        s.rotate(side * -e * 0.5);
        s.fillRect(side < 0 ? 0 : -W / 2 + 10, -3, W / 2 - 10, 6);
        s.restore();
      }
    }
    s.restore();
  }

  hateRows(s, t, lvl, t0) {
    const rows = lvl ? 9 : 5;
    const rh = H / rows;
    s.save();
    s.font = `${Math.round(rh * 0.78)}px Bebas`;
    s.textBaseline = 'middle';
    const unit = 'I HATE ME   ';
    const str = unit.repeat(14);
    const uw = s.measureText(unit).width;
    for (let r = 0; r < rows; r++) {
      const vis = smooth(t0 + r * 0.12, t0 + r * 0.12 + 0.2, t);
      if (vis <= 0) continue;
      const dir = r % 2 ? -1 : 1;
      const x = -((((t * (140 + lvl * 160) * dir + r * 97) % uw) + uw) % uw);
      const y = rh * (r + 0.5);
      s.globalAlpha = vis * (lvl ? 0.32 : 0.2);
      if ((r + lvl) % 2) {
        s.strokeStyle = '#ffffff';
        s.lineWidth = 2;
        s.strokeText(str, x, y);
      } else {
        s.fillStyle = COL.red;
        s.fillText(str, x, y);
      }
    }
    s.restore();
    if (lvl) {
      const b = this.au.beat(t);
      const p = Math.exp(-b.phase * 6);
      s.save();
      s.globalAlpha = 0.18 * p;
      s.fillStyle = COL.red;
      s.fillRect(0, 0, W, H);
      s.restore();
    }
  }

  /** the beat on which the cursor hits CANCEL (first beat >= 1.1 s into the line) */
  cancelClickTime(l) {
    return Audio.beatTime(Math.ceil((l.t0 + 1.1 - BEAT0) / SPB));
  }

  /** bridge, first line: TV static and a system dialog whose CANCEL button does nothing */
  noiseScreen(s, t, l) {
    const a = smooth(l.t0 - 0.15, l.t0 + 0.15, t) * (1 - smooth(l.t1 - 0.12, l.t1, t));
    if (a <= 0) return;
    const u = t - l.t0;
    const tc = this.cancelClickTime(l) - l.t0;
    const failed = u >= tc;
    const k = Math.floor(t * 30);
    // analogue static (chunky, nearest-sampled), heavier once cancelling has failed
    s.save();
    s.globalCompositeOperation = 'screen';
    s.globalAlpha = a * (0.14 + (failed ? 0.16 : 0) + 0.06 * rnd(k, 'st'));
    s.imageSmoothingEnabled = false;
    s.scale(3, 3);
    s.translate(-Math.floor(rnd(k, 'sx') * 384), -Math.floor(rnd(k, 'sy') * 384));
    s.fillStyle = this.staticPat[k % this.staticPat.length];
    s.fillRect(0, 0, W / 3 + 400, H / 3 + 400);
    s.restore();
    // rolling interference bar
    const ry = ((t * 420) % (H + 300)) - 150;
    const rg = s.createLinearGradient(0, ry - 90, 0, ry + 90);
    rg.addColorStop(0, 'rgba(255,255,255,0)');
    rg.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    s.save();
    s.globalAlpha = a;
    s.fillStyle = rg;
    s.fillRect(0, ry - 90, W, 180);
    s.restore();

    // dialog
    const pop = ez(E.outB, (u - 0.1) / 0.35, 1.6);
    if (pop <= 0) return;
    const shake = failed ? Math.exp(-(u - tc) * 6) * 24 * noise1(t * 40, 9) : 0;
    const dw = 860;
    const dh = 214;
    const dx = W / 2 - dw / 2;
    const dy = 690;
    const sc = lerp(0.85, 1, pop);
    s.save();
    s.globalAlpha = a * clamp(pop * 1.5);
    s.translate(W / 2 + shake, dy + dh / 2);
    s.scale(sc, sc);
    s.translate(-W / 2, -(dy + dh / 2));
    s.fillStyle = 'rgba(8,8,8,0.9)';
    s.fillRect(dx, dy, dw, dh);
    s.strokeStyle = failed ? COL.redHot : 'rgba(244,240,232,0.8)';
    s.lineWidth = 2;
    s.strokeRect(dx, dy, dw, dh);
    s.fillStyle = failed ? COL.redHot : 'rgba(244,240,232,0.88)';
    s.fillRect(dx, dy, dw, 36);
    text(s, failed ? 'SYSTEM ERROR' : 'NOISE CANCELLING', dx + 16, dy + 18, 'Mono', 20, '#0a0a0a', { tracking: 3 });
    text(s, 'x', dx + dw - 24, dy + 18, 'Mono', 22, '#0a0a0a', { align: 'center' });
    text(s, failed ? 'ERROR 0x7E: NOISE CANNOT BE CANCELLED' : 'CANCELLING NOISE ...', dx + 26, dy + 74, 'Mono', 25,
      failed ? COL.redHot : '#f4f0e8', { tracking: 2 });
    // progress stalls at 99 %
    const p = failed ? 0.99 : 0.99 * ez(E.outC, (u - 0.25) / Math.max(0.2, tc - 0.4));
    const pw = dw - 260;
    s.strokeStyle = 'rgba(244,240,232,0.6)';
    s.strokeRect(dx + 26, dy + 104, pw, 24);
    s.fillStyle = failed ? (Math.floor(t * 8) % 2 ? '#5c0a07' : COL.redHot) : '#f4f0e8';
    s.fillRect(dx + 29, dy + 107, (pw - 6) * p, 18);
    text(s, `${Math.floor(p * 100)}%`, dx + 26 + pw + 18, dy + 116, 'Mono', 22, '#f4f0e8');
    // the CANCEL button
    const bw = 170;
    const bh = 48;
    const bx = dx + dw - bw - 26;
    const by = dy + dh - bh - 18;
    const pressed = u >= tc && u < tc + 0.12;
    const off = pressed ? 3 : 0;
    s.fillStyle = pressed ? '#3a3a3a' : failed ? '#2a0a08' : '#1c1c1c';
    s.fillRect(bx, by + off, bw, bh);
    s.strokeStyle = failed ? COL.redHot : '#f4f0e8';
    s.strokeRect(bx, by + off, bw, bh);
    text(s, 'CANCEL', bx + bw / 2, by + off + bh / 2, 'Mono', 24, failed ? COL.redHot : '#f4f0e8', { align: 'center', tracking: 4 });
    if (failed) {
      s.fillStyle = COL.redHot;
      s.fillRect(bx + 12, by + bh / 2 - 1, bw - 24, 3);
    }
    // mouse pointer glides to the button and clicks on the beat
    const cu = ez(E.ioC, (u - 0.45) / Math.max(0.2, tc - 0.55));
    this.pointer(s, lerp(W - 300, bx + bw * 0.62, cu), lerp(H - 70, by + bh * 0.6, cu) + off);
    s.restore();
  }

  pointer(s, x, y) {
    s.save();
    s.translate(x, y);
    s.scale(1.7, 1.7);
    s.beginPath();
    s.moveTo(0, 0);
    s.lineTo(0, 26);
    s.lineTo(7, 19);
    s.lineTo(12, 30);
    s.lineTo(17, 28);
    s.lineTo(12, 17);
    s.lineTo(21, 17);
    s.closePath();
    s.fillStyle = '#ffffff';
    s.fill();
    s.strokeStyle = '#000000';
    s.lineWidth = 1.5;
    s.stroke();
    s.restore();
  }

  /** bridge, last line: a tape rewinding back to "あの時", then playing from there */
  vhsScreen(s, t, l, play) {
    const a = smooth(l.t0 - 0.1, l.t0 + 0.2, t) * (1 - smooth(l.t1 - 0.2, l.t1, t));
    if (a <= 0) return;
    const rew = t < play;
    const k = Math.floor(t * 30);
    if (rew) {
      // rewind streaks racing right -> left
      s.save();
      s.globalCompositeOperation = 'lighter';
      s.fillStyle = '#ffffff';
      for (let i = 0; i < 28; i++) {
        const len = rr(200, 900, 'vl', i);
        const span = W + len + 400;
        const x = W + 200 - ((((t - l.t0) * rr(1800, 4200, 'vs', i) + rr(0, W, 'vx', i)) % span) + span) % span;
        s.globalAlpha = a * rr(0.06, 0.22, 'va', i);
        s.fillRect(x, rr(80, H - 80, 'vy', i), len, rr(1, 3, 'vh', i));
      }
      s.restore();
    }
    // tracking noise: a band of torn lines, violent while rewinding, settling once playing
    const bandY = rew ? 760 + Math.sin(t * 9) * 40 : 960 + Math.sin(t * 3) * 10;
    const strength = rew ? 1 : 0.35;
    s.save();
    for (let j = 0; j < 22; j++) {
      for (let q = 0; q < 6; q++) {
        if (rnd(k, j, q, 'tn') > 0.55 * strength) continue;
        s.globalAlpha = a * rr(0.15, 0.6, k, j, q) * strength;
        s.fillStyle = rnd(k, j, q, 'tc') < 0.15 ? COL.redHot : '#ffffff';
        s.fillRect(rr(0, W, k, j, q, 'tx'), bandY + j * 4, rr(30, 400, k, j, q, 'tw'), 2);
      }
    }
    s.restore();
    // on-screen display: REW (blinking) / PLAY, and a tape counter that runs back to 0:00:00
    s.save();
    s.globalAlpha = a;
    s.fillStyle = '#f4f0e8';
    const ix = 110;
    const iy = 160;
    if (rew) {
      if (Math.floor(t * 4) % 2 === 0) {
        for (const ox of [0, 30]) {
          s.beginPath();
          s.moveTo(ix + ox, iy);
          s.lineTo(ix + ox + 30, iy - 20);
          s.lineTo(ix + ox + 30, iy + 20);
          s.closePath();
          s.fill();
        }
        text(s, 'REW', ix + 82, iy + 2, 'Mono', 44, '#f4f0e8', { alpha: a, tracking: 6 });
      }
    } else {
      s.beginPath();
      s.moveTo(ix + 6, iy - 22);
      s.lineTo(ix + 42, iy);
      s.lineTo(ix + 6, iy + 22);
      s.closePath();
      s.fill();
      text(s, 'PLAY', ix + 62, iy + 2, 'Mono', 44, '#f4f0e8', { alpha: a, tracking: 6 });
    }
    s.restore();
    const v = Math.max(0, rew ? (play - t) * 47 : t - play);
    const hms = `${Math.floor(v / 3600)}:${String(Math.floor(v / 60) % 60).padStart(2, '0')}:${String(Math.floor(v) % 60).padStart(2, '0')}`;
    text(s, `${rew ? '-' : ' '}${hms}`, W - 110, iy + 2, 'Mono', 44, '#f4f0e8', { align: 'right', alpha: a, tracking: 4 });
  }

  noSide(s, t, sec) {
    const u = clamp((t - sec.t0) / (sec.t1 - sec.t0));
    const b = this.au.beat(t);
    const p = Math.exp(-b.phase * 5);
    s.save();
    s.font = '400px Bebas';
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    s.letterSpacing = `${Math.round(lerp(0, 70, E.outC(u)))}px`;
    s.globalAlpha = (0.1 + 0.28 * p) * smooth(sec.t0, sec.t0 + 0.4, t) * (1 - smooth(sec.t1 - 0.25, sec.t1, t));
    s.strokeStyle = p > 0.55 ? COL.redHot : '#ffffff';
    s.lineWidth = 3;
    s.strokeText('NO SIDE', W / 2, H / 2 + 10);
    s.restore();
  }

  network(s, t, sec) {
    const { nodes, edges } = this.net;
    const gap = this.sections.find((x) => x.id === 'gap');
    const grow = clamp((t - gap.t0) / 3.8);
    const b = this.au.beat(t);
    const nVis = Math.floor(lerp(4, nodes.length, grow));
    s.save();
    s.lineWidth = 1.2;
    for (const e of edges) {
      if (e.a.k >= nVis || e.b.k >= nVis) continue;
      const appear = gap.t0 + (Math.max(e.a.k, e.b.k) / nodes.length) * 3.8;
      const d = ez(E.outC, (t - appear) / 0.5);
      s.globalAlpha = 0.28;
      s.strokeStyle = '#ffffff';
      s.beginPath();
      s.moveTo(e.a.x, e.a.y);
      s.lineTo(lerp(e.a.x, e.b.x, d), lerp(e.a.y, e.b.y, d));
      s.stroke();
      // signal pulses travelling on the beat
      if ((b.idx + e.j) % 5 === 0) {
        const u = b.phase / 0.8;
        if (u < 1) {
          s.globalAlpha = 0.9 * (1 - u);
          s.fillStyle = e.j % 3 ? '#ffffff' : COL.redHot;
          s.fillRect(lerp(e.a.x, e.b.x, u) - 3, lerp(e.a.y, e.b.y, u) - 3, 6, 6);
        }
      }
    }
    for (const n of nodes) {
      if (n.k >= nVis) continue;
      const p = (n.k % 4) === b.inBar ? Math.exp(-b.phase * 4) : 0;
      s.globalAlpha = 0.65;
      s.fillStyle = p > 0.2 ? COL.redHot : '#ffffff';
      s.beginPath();
      s.arc(n.x, n.y, 3 + p * 6, 0, TAU);
      s.fill();
      if (p > 0.05) {
        s.globalAlpha = p * 0.5;
        s.strokeStyle = COL.redHot;
        s.lineWidth = 2;
        s.beginPath();
        s.arc(n.x, n.y, 10 + (1 - p) * 40, 0, TAU);
        s.stroke();
        s.lineWidth = 1.2;
      }
    }
    s.restore();
  }

  // ====================================================================================== lyrics
  drawLine(ctx, l, t) {
    const d = l.d;
    const v = t >= l.tExit ? clamp((t - l.tExit) / d.exitDur) : 0;
    let shiftY = 0;
    let dim = 1;
    if (d.hold) {
      const nx = this.L[l.i + 1];
      const k = ez(E.outC, (t - nx.t0) / 0.35);
      shiftY = -k * (d.holdDy ?? 30);
      dim = 1 - 0.45 * k;
    }
    if (d.layout === 'stairs') return this.drawStairs(ctx, l, t, v);
    if (d.layout === 'sides') return this.drawSides(ctx, l, t, v);
    if (d.layout === 'network') return this.drawNetworkWords(ctx, l, t, v);
    const y0 = d.y + shiftY;
    let cursor = null;
    if (d.echo) {
      for (const k of [2, 1]) {
        for (const dir of [-1, 1]) {
          this.drawRow(ctx, l, l.rows[0], y0 + dir * k * (d.echoGap ?? d.size * 0.72), t, v, dim * (0.32 / k), { delay: k * 0.15, outline: true });
        }
      }
    }
    l.rows.forEach((row, k) => {
      const c = this.drawRow(ctx, l, row, y0 + k * d.rowGap, t, v, dim, {});
      if (c) cursor = c;
    });
    if (d.motif?.kind === 'mirror') this.reflection(ctx, l, t, v, y0);
    if (d.enter === 'type' && cursor && v === 0) {
      const blink = Math.floor((t - BEAT0) / (SPB / 2)) % 2 === 0 || t - cursor.last < 0.3;
      if (blink) {
        ctx.fillStyle = COL.redHot;
        ctx.fillRect(cursor.x + 14, y0 - d.size * 0.45, d.size * 0.09, d.size * 0.9);
      }
    }
    const lastRow = l.rows[l.rows.length - 1];
    this.cnQueue.push([l, t, v, y0 + (l.rows.length - 1) * d.rowGap + (d.cnGap ?? lastRow.size * 0.5 + 74), dim]);
  }

  drawRow(ctx, l, row, y, t, v, dim, { delay = 0, outline = false }) {
    const d = l.d;
    let x = d.x - row.width / 2;
    let cursor = null;
    row.segs.forEach((seg, j) => {
      if (j) x += seg.gapBefore;
      x += seg.pad;
      const c = this.drawSeg(ctx, l, seg, x, y, t - delay, v, dim, outline);
      if (c) cursor = c;
      x += seg.L.width + seg.pad;
    });
    return cursor;
  }

  drawSeg(ctx, l, seg, x, y, t, v, dim, outline) {
    const d = l.d;
    const t0 = l.t0 + seg.at;
    const size = seg.L.size;
    const seed = l.i * 1000 + seg.r[0];
    const n = seg.L.glyphs.length;
    if (seg.fx === 'stamp') return this.drawStamp(ctx, l, seg, x, y, t, t0, v, dim);
    let cursor = null;
    drawGlyphs(ctx, seg.L, x, y, {
      align: 'left',
      fill: outline ? 'none' : seg.fill,
      stroke: outline ? '#ffffff' : undefined,
      lw: 2,
      alpha: dim,
      style: (g) => {
        const tg = t0 + g.i * seg.stagger;
        const en = enterStyle(seg.enter, t - tg, g, size, seed, t);
        if (!en) return { skip: true };
        const st = Object.assign(base(), en);
        if (d.accent && d.accent.glyphs.includes(seg.g0 + g.i) && !en.fill) st.fill = d.accent.fill;
        applyFx(st, seg.fx, t, g, size, seed);
        if (v > 0) applyExit(st, d.exit, v, g, n, size, seed, t);
        if (t >= tg) cursor = { x: x + g.x + g.w, last: tg };
        return st;
      },
    });
    if (seg.fx === 'redact') this.redact(ctx, l, seg, x, y, t, v);
    return cursor;
  }

  drawCn(ctx, l, t, v, y, dim = 1) {
    if (!l.cnL) return;
    const d = l.d;
    const u = t - (l.t0 + 0.12);
    if (u < 0) return;
    const e = ez(E.outC, u / 0.5);
    const a = e * (1 - E.outQ(v)) * dim;
    if (a <= 0.01) return;
    const fill = d.cnFill || '#efe9df';
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = COL.redHot;
    const rw = lerp(0, 46, e);
    ctx.fillRect(d.x - rw / 2, y - l.cnL.size * 0.86, rw, 3);
    ctx.restore();
    const seed = l.i * 7 + 3;
    drawGlyphs(ctx, l.cnL, d.x, y + (1 - e) * 14 - E.inC(v) * 20, {
      fill,
      alpha: a,
      style: (g) => {
        if (d.exit === 'glitch' && v > 0) {
          const k = Math.floor(t * 30);
          return { alpha: rnd(seed, g.i, k) < v ? 0 : 1, dx: (rnd(seed, g.i, k, 1) - 0.5) * 30 * v };
        }
        return null;
      },
    });
  }

  reflection(ctx, l, t, v, y0) {
    const d = l.d;
    const axis = y0 + d.size * 0.62;
    const m = this.mx;
    const k = this.k;
    this.base(m);
    m.clearRect(0, 0, W, 360);
    m.setTransform(k, 0, 0, -k, 0, axis * k);
    this.drawRow(m, l, l.rows[0], y0, t, v, 1, {});
    this.base(m);
    m.globalCompositeOperation = 'destination-in';
    const g = m.createLinearGradient(0, 0, 0, 260);
    g.addColorStop(0, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    m.fillStyle = g;
    m.fillRect(0, 0, W, 360);
    m.globalCompositeOperation = 'source-over';
    for (let j = 0; j < 260; j += 5) {
      const dx = Math.sin(j * 0.09 + t * 7) * (2 + j * 0.05);
      ctx.drawImage(this.M, 0, j * k, W * k, 5 * k, dx, axis + j, W, 5);
    }
  }

  drawStamp(ctx, l, seg, x, y, t, t0, v, dim) {
    const u = t - t0;
    if (u < 0) return null;
    const size = seg.L.size;
    if (!seg.stamp) {
      const pad = size * 0.28;
      const w = Math.ceil(seg.L.width + pad * 2 + 20);
      const h = Math.ceil(size * 1.3 + 20);
      const [c, cx] = scaledCanvas(w, h, this.k);
      cx.strokeStyle = COL.redHot;
      cx.lineWidth = size * 0.07;
      cx.beginPath();
      cx.roundRect(10, 10, w - 20, h - 20, size * 0.12);
      cx.stroke();
      drawGlyphs(cx, seg.L, w / 2, h / 2 + 2, { fill: COL.redHot });
      cx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 420; i++) {
        cx.globalAlpha = rr(0.3, 1, 'sa', i);
        const r = rr(0.6, 3.2, 'sr', i);
        cx.fillRect(rr(0, w, 'sx', i), rr(0, h, 'sy', i), r, r);
      }
      for (let i = 0; i < 6; i++) {
        cx.globalAlpha = 0.5;
        cx.fillRect(rr(0, w, 'slx', i), rr(0, h, 'sly', i), rr(20, 90, 'slw', i), rr(1, 3, 'slh', i));
      }
      seg.stamp = c;
      seg.stampW = w;
      seg.stampH = h;
    }
    const e = ez(E.outX, u / 0.16);
    const sc = lerp(2.8, 1, e);
    let a = ez(E.lin, u / 0.04) * dim;
    if (v > 0) a *= 1 - v;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x + seg.L.width / 2, y);
    ctx.rotate(-0.13 + (1 - e) * 0.2);
    ctx.scale(sc, sc);
    ctx.drawImage(seg.stamp, -seg.stampW / 2, -seg.stampH / 2, seg.stampW, seg.stampH);
    ctx.restore();
    return null;
  }

  redact(ctx, l, seg, x, y, t, v) {
    const l2 = l.rows[1].segs[0];
    const tr = l.t0 + l2.at + 0.6;
    const e = ez(E.outX, (t - tr) / 0.3);
    if (e <= 0) return;
    const size = seg.L.size;
    const w = (seg.L.width + 24) * e;
    ctx.save();
    ctx.globalAlpha = 1 - v;
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(x - 12, y - size * 0.56, w, size * 1.12);
    if (e > 0.95) {
      const blink = Math.floor(t * 4) % 2 === 0;
      ctx.fillStyle = blink ? COL.redHot : '#f0f0f0';
      ctx.font = `${Math.round(size * 0.34)}px Mono`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('[ CLASSIFIED ]', x - 12 + w / 2, y);
    }
    ctx.restore();
  }

  drawStairs(ctx, l, t, v) {
    const d = l.d;
    const { pos, size } = l.stairs;
    const seed = l.i * 1000;
    ctx.save();
    ctx.font = `${size}px ${d.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of pos) {
      const u = t - (l.t0 + p.at);
      const en = enterStyle('drop', u, { i: p.i }, size, seed, t);
      if (!en) continue;
      const st = Object.assign(base(), en);
      if (v > 0) applyExit(st, d.exit, v, { i: p.i }, pos.length, size, seed, t);
      if (st.alpha <= 0.01) continue;
      ctx.save();
      ctx.translate(p.x + st.dx, p.y + st.dy);
      ctx.rotate(st.rot);
      ctx.scale(st.sx, st.sy);
      ctx.globalAlpha = st.alpha;
      ctx.fillStyle = p.phrase ? COL.white : d.fill;
      ctx.fillText(p.ch, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    this.cnQueue.push([l, t, v, 930]);
  }

  drawSides(ctx, l, t, v) {
    const d = l.d;
    const row = l.rows[0];
    const [A, B] = row.segs;
    const xA = d.x - row.width / 2;
    const xB = xA + A.L.width + B.gapBefore;
    const seed = l.i * 1000;
    [[A, xA, -1], [B, xB, 1]].forEach(([seg, x, dir]) => {
      const u = t - (l.t0 + seg.at);
      if (u < 0) return;
      const e = ez(E.outX, u / 0.42);
      const off = (1 - e) * 1400 * dir;
      const dx = d.vertical ? 0 : off;
      const dy = d.vertical ? off * 0.6 : 0;
      if (e < 0.97) {
        ctx.save();
        ctx.globalAlpha = (1 - e) * 0.8;
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 7; i++) {
          const yy = d.y - seg.L.size * 0.4 + rr(0, seg.L.size * 0.8, 'sl', i, l.i);
          const len = rr(200, 700, 'sll', i);
          if (d.vertical) ctx.fillRect(x + rr(0, seg.L.width, 'slx', i) + dx, d.y + dy - dir * len, 3, len * dir);
          else ctx.fillRect(x + dx - dir * len + (dir < 0 ? seg.L.width : 0), yy, len * dir, 3);
        }
        ctx.restore();
      }
      drawGlyphs(ctx, seg.L, x + dx, d.y + dy, {
        align: 'left',
        fill: seg.fill,
        style: (g) => {
          const st = base();
          st.sx = 1 + (1 - e) * 0.6;
          if (v > 0) applyExit(st, d.exit, v, g, seg.L.glyphs.length, seg.L.size, seed + seg.r[0], t);
          return st;
        },
      });
    });
    this.cnQueue.push([l, t, v, d.y + d.size * 0.5 + 70]);
  }

  drawNetworkWords(ctx, l, t, v) {
    const d = l.d;
    const ids = this.net.targets[l.i];
    const nodes = this.net.nodes;
    // connecting strokes between consecutive words
    ctx.save();
    ctx.strokeStyle = COL.redHot;
    ctx.lineWidth = 4;
    for (let k = 1; k < l.rows.length; k++) {
      const a = nodes[ids[k - 1]];
      const b = nodes[ids[k]];
      const e = ez(E.outC, (t - (l.t0 + l.rows[k].segs[0].at)) / 0.3);
      if (e <= 0) continue;
      ctx.globalAlpha = 0.85 * (1 - v);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(lerp(a.x, b.x, e), lerp(a.y, b.y, e));
      ctx.stroke();
    }
    ctx.restore();
    l.rows.forEach((row, k) => {
      const seg = row.segs[0];
      const n = nodes[ids[k]];
      const tw = l.t0 + seg.at;
      const u = t - tw;
      if (u < 0) return;
      // ring burst at the node
      for (const r of [0, 0.12]) {
        const uu = (u - r) / 0.9;
        if (uu > 0 && uu < 1) {
          ctx.save();
          ctx.globalAlpha = (1 - uu) * 0.8;
          ctx.strokeStyle = COL.redHot;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 30 + E.outC(uu) * 260, 0, TAU);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.save();
      ctx.globalAlpha = 1 - v;
      ctx.fillStyle = COL.redHot;
      ctx.beginPath();
      ctx.arc(n.x, n.y + seg.L.size * 0.72, 7, 0, TAU);
      ctx.fill();
      ctx.restore();
      this.drawSeg(ctx, l, seg, n.x - seg.L.width / 2, n.y, t, v, 1, false);
    });
    this.cnQueue.push([l, t, v, 945]);
  }

  // ====================================================================================== motifs
  motif(ctx, l, t, layer) {
    const m = l.d.motif;
    if (m) {
      switch (m.kind) {
        case 'scratch':
          if (layer === 'under') this.scratch(ctx, l, t, m);
          break;
        case 'claw':
          if (layer === 'under') this.claw(ctx, l, t, m);
          break;
        case 'stairs':
          if (layer === 'under') this.stairsGraphic(ctx, l, t);
          break;
        case 'mission':
          if (layer === 'under') this.mission(ctx, l, t);
          break;
        case 'question':
          if (layer === 'under') this.questions(ctx, l, t);
          break;
        case 'footsteps':
          if (layer === 'under') this.footsteps(ctx, l, t);
          break;
        case 'brackets':
          if (layer === 'under') this.brackets(ctx, l, t);
          break;
        case 'rules':
          if (layer === 'over') this.rules(ctx, l, t);
          break;
        default:
          break;
      }
    }
    if (l.d.rings && layer === 'under') this.rings(ctx, l, t);
  }

  slash(ctx, x1, y1, x2, y2, wmax, e, col) {
    // tapered blade stroke revealed up to fraction e
    const n = 18;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * e;
      const w = Math.sin(Math.PI * (i / n)) ** 0.8 * wmax * (0.6 + 0.4 * e);
      pts.push([x1 + dx * s, y1 + dy * s, w]);
    }
    ctx.fillStyle = col;
    ctx.beginPath();
    pts.forEach(([x, y, w], i) => (i ? ctx.lineTo(x + nx * w * 0.5, y + ny * w * 0.5) : ctx.moveTo(x + nx * w * 0.5, y + ny * w * 0.5)));
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0] - nx * pts[i][2] * 0.5, pts[i][1] - ny * pts[i][2] * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  scratch(ctx, l, t, m) {
    // locate the glyph the scratches belong to
    let tg = l.t0;
    let gx = W / 2;
    let gy = l.d.y;
    l.rows.forEach((row) =>
      row.segs.forEach((seg) => {
        const k = m.glyph - seg.g0;
        if (k >= 0 && k < seg.L.glyphs.length) {
          tg = l.t0 + seg.at + k * seg.stagger;
          gx = seg.px0 + seg.L.glyphs[k].x + seg.L.glyphs[k].w / 2;
          gy = seg.py0;
        }
      }),
    );
    const fade = 1 - smooth(l.t1 - 0.3, l.t1 + 0.3, t);
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const ts = tg + 0.05 + i * 0.06;
      const e = ez(E.outX, (t - ts) / 0.14);
      if (e <= 0) continue;
      ctx.globalAlpha = fade * 0.9;
      const cx = gx - 160 + i * 95;
      this.slash(ctx, cx - 140, gy + 190, cx + 170, gy - 230, 16, e, i % 2 ? COL.redHot : COL.red);
    }
    ctx.restore();
  }

  claw(ctx, l, t, m) {
    const seg = l.rows[m.seg[0]].segs[m.seg[1]];
    const tg = l.t0 + seg.at;
    if (t < tg) return;
    const cx = seg.px0 + seg.L.width / 2;
    const cy = seg.py0;
    const fade = 1 - smooth(l.t1 - 0.2, l.t1 + 0.3, t);
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const e = ez(E.outX, (t - tg - i * 0.05) / 0.13);
      if (e <= 0) continue;
      ctx.globalAlpha = fade;
      const ox = (i - 1) * 120;
      this.slash(ctx, cx + ox - 240, cy - 260, cx + ox + 200, cy + 250, 30, e, i === 1 ? '#ffffff' : COL.redHot);
    }
    ctx.restore();
  }

  stairsGraphic(ctx, l, t) {
    const a = smooth(l.t0 - 0.2, l.t0 + 0.3, t) * (1 - smooth(l.tExit, l.tExit + l.d.exitDur, t));
    if (a <= 0) return;
    const stepW = 160;
    const stepH = 58;
    const ph = ((t - l.t0) * 1.6) % 1;
    const size = l.stairs.size;
    ctx.save();
    ctx.globalAlpha = a * 0.5;
    ctx.strokeStyle = l.i === 26 ? '#ffffff' : COL.redHot;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let k = -4; k < 14; k++) {
      const p = k - ph;
      const x = 330 + p * stepW - stepW / 2;
      const y = 255 + p * stepH + size * 0.62;
      if (k === -4) ctx.moveTo(x, y);
      ctx.lineTo(x + stepW, y);
      ctx.lineTo(x + stepW, y + stepH);
    }
    ctx.stroke();
    // handrail
    ctx.globalAlpha = a * 0.25;
    ctx.beginPath();
    ctx.moveTo(-200, 255 - 4.5 * stepH - 60);
    ctx.lineTo(W + 200, 255 + ((W + 200 - 330) / stepW) * stepH - 60);
    ctx.stroke();
    ctx.restore();
  }

  rings(ctx, l, t) {
    const [a, b] = l.d.rings;
    const pts = l.stairs.pos.slice(a, b);
    if (!pts.length) return;
    const t1 = l.t0 + pts[0].at;
    if (t < t1) return;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const fade = 1 - smooth(l.tExit, l.tExit + 0.3, t);
    const b0 = Math.ceil((t1 - BEAT0) / SPB);
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    for (let n = b0; ; n++) {
      const tb = BEAT0 + n * SPB;
      if (tb > t) break;
      const u = (t - tb) / 1.3;
      if (u > 1) continue;
      ctx.globalAlpha = (1 - u) * 0.55 * fade;
      ctx.lineWidth = 3 * (1 - u) + 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 60 + E.outC(u) * 640, 30 + E.outC(u) * 300, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  mission(ctx, l, t) {
    const e = ez(E.outX, (t - l.t0) / 0.5);
    const out = clamp((t - l.tExit) / l.d.exitDur);
    if (e <= 0 || out >= 1) return;
    const w = 1500 * e;
    const h = 380;
    const cx = W / 2;
    const cy = l.d.y + 70;
    const a = 1 - out;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 5;
    const c = 46;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + (sx * w) / 2;
      const y = cy + (sy * h) / 2;
      ctx.beginPath();
      ctx.moveTo(x, y - sy * -c);
      ctx.moveTo(x - sx * c, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - sy * c);
      ctx.stroke();
    }
    ctx.restore();
    if (e > 0.9) {
      text(ctx, 'MISSION 04  //  CLEAR CONDITION', cx - w / 2, cy - h / 2 - 28, 'Mono', 24, COL.red, { alpha: a, tracking: 3 });
      const k = Math.floor(t * 8);
      text(ctx, `STATUS: ${rnd(k, 3) < 0.5 ? 'UNKNOWN' : '????????'}`, cx + w / 2, cy + h / 2 + 30, 'Mono', 22, '#111', { align: 'right', alpha: a, tracking: 3 });
    }
  }

  questions(ctx, l, t) {
    const end = this.L[l.i + 1].t1 + 0.3;
    if (t > end + 1.6) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 18; i++) {
      const ts = l.t0 + i * 0.16;
      const u = (t - ts) / 1.8;
      if (u < 0 || u > 1) continue;
      const x = rr(180, W - 180, 'qx', i);
      const y = rr(760, 980, 'qy', i) - u * rr(240, 520, 'qv', i);
      const size = rr(60, 170, 'qs', i);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(u * 6 + i) * 0.4);
      ctx.globalAlpha = Math.sin(u * Math.PI) * 0.75 * (1 - smooth(end, end + 0.3, t));
      ctx.font = `${Math.round(size)}px AntonioBold`;
      ctx.fillStyle = i % 3 === 0 ? COL.red : '#1a1a1a';
      ctx.fillText('?', 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  footsteps(ctx, l, t) {
    const seg = l.rows[1].segs[0];
    const ts = l.t0 + seg.at;
    const fade = 1 - smooth(l.tExit, l.tExit + 0.4, t);
    const b0 = Math.ceil((ts - BEAT0) / SPB);
    ctx.save();
    for (let n = b0; ; n++) {
      const tb = BEAT0 + n * SPB;
      if (tb > t) break;
      const k = n - b0;
      const age = t - tb;
      const x = 230 + k * 170;
      if (x > W - 150) break;
      const y = 900 + (k % 2 ? -34 : 34);
      ctx.globalAlpha = fade * 0.8 * (1 - smooth(1.8, 3, age)) * ez(E.outC, age / 0.12);
      ctx.fillStyle = '#151515';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2 + (k % 2 ? -0.12 : 0.12));
      ctx.beginPath();
      ctx.ellipse(0, -14, 15, 28, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 30, 12, 15, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  brackets(ctx, l, t) {
    const l2 = this.L[l.i + 1];
    const out = clamp((t - l2.t1) / 0.3);
    if (out >= 1) return;
    const draw = (ch, x, y, t0) => {
      const u = t - t0;
      if (u < 0) return;
      const e = ez(E.outX, u / 0.22);
      ctx.save();
      ctx.translate(x, y);
      const s = lerp(2.2, 1, e);
      ctx.scale(s, s);
      ctx.globalAlpha = ez(E.lin, u / 0.05) * (1 - out);
      ctx.font = '380px Mincho';
      ctx.fillStyle = COL.red;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    };
    draw('「', 300, 290, l.t0);
    draw('」', W - 300, 790, l2.t0);
  }

  rules(ctx, l, t) {
    const dur = l.t1 - l.t0;
    const fade = 1 - smooth(l.t1 - 0.1, l.t1 + 0.3, t);
    if (fade <= 0) return;
    ctx.save();
    for (let k = 0; k < 44; k++) {
      const ts = l.t0 + 0.3 + (k / 44) * (dur - 0.4);
      const e = ez(E.outQu, (t - ts) / 0.2);
      if (e <= 0) break;
      const vert = rnd('rv', k) < 0.2;
      const ang = rr(-0.42, 0.42, 'ra', k) + (vert ? Math.PI / 2 : 0);
      const px = rr(250, W - 250, 'rx', k);
      const py = rr(220, 760, 'ry', k);
      const len = 2600;
      const x1 = px - (Math.cos(ang) * len) / 2;
      const y1 = py - (Math.sin(ang) * len) / 2;
      ctx.globalAlpha = fade * (k % 3 === 0 ? 0.75 : 0.5);
      ctx.strokeStyle = k % 3 === 0 ? COL.redHot : '#ffffff';
      ctx.lineWidth = rr(1.5, 4, 'rw', k);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + Math.cos(ang) * len * e, y1 + Math.sin(ang) * len * e);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ========================================================================================= HUD
  hud(o, t, sec, st) {
    const a = 0.85 * smooth(0.5, 1.1, t) * (1 - smooth(FINAL_HIT - 1.1, FINAL_HIT - 0.1, t));
    if (a <= 0) return;
    const ink = st.paper ? '#141414' : '#f4f0e8';
    const sub = st.paper ? 'rgba(20,20,20,0.7)' : 'rgba(244,240,232,0.6)';
    o.save();
    o.globalAlpha = a;
    o.fillStyle = COL.redHot;
    o.fillRect(64, 52, 14, 14);
    o.restore();
    o.font = '24px KakuBlack';
    const aw = o.measureText(ARTIST).width;
    text(o, ARTIST, 92, 60, 'KakuBlack', 24, ink, { alpha: a });
    o.save();
    o.globalAlpha = a;
    o.fillStyle = COL.redHot;
    o.fillRect(92 + aw + 14, 49, 2, 22);
    o.restore();
    text(o, TITLE, 92 + aw + 30, 60, 'AntonioBold', 26, ink, { alpha: a, tracking: 4 });
    // section label (decodes when it changes)
    const since = t - sec.t0;
    const label = `${String(sec.n).padStart(2, '0')} / ${sec.label}`;
    const shown = [...label].map((ch, i) => (since < 0.04 * i + 0.25 && ch !== ' ' ? scrambleFor('Mono', 'hud', i, Math.floor(t * 30)) : ch)).join('');
    text(o, shown, 92, 94, 'Mono', 19, sub, { alpha: a, tracking: 3 });
    // tempo + beat lamps
    const b = this.au.beat(Math.max(t, BEAT0));
    text(o, `${BPM} BPM`, W - 64 - 4 * 24 - 14, 60, 'Mono', 20, sub, { align: 'right', alpha: a, tracking: 2 });
    for (let i = 0; i < 4; i++) {
      const on = i === b.inBar;
      o.save();
      o.globalAlpha = a * (on ? 0.4 + 0.6 * Math.exp(-b.phase * 3) : 0.35);
      o.fillStyle = on ? COL.redHot : ink;
      o.fillRect(W - 64 - (4 - i) * 24 + 8, 52, 14, 14);
      o.restore();
    }
    const fmt = (x) => {
      const m = Math.floor(x / 60);
      const s = x - m * 60;
      return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
    };
    text(o, `${fmt(Math.max(0, t))} / ${fmt(this.duration)}`, W - 64, 94, 'Mono', 19, sub, { align: 'right', alpha: a, tracking: 2 });
    // progress
    const y = H - 44;
    o.save();
    o.globalAlpha = a * 0.5;
    o.fillStyle = ink;
    o.fillRect(64, y, W - 128, 2);
    for (const s of this.sections) o.fillRect(64 + ((W - 128) * s.t0) / this.duration, y - 5, 2, 12);
    o.globalAlpha = a;
    o.fillStyle = COL.redHot;
    const px = ((W - 128) * clamp(t / this.duration)) | 0;
    o.fillRect(64, y - 1, px, 4);
    o.fillRect(64 + px - 3, y - 7, 6, 16);
    o.restore();
  }

  disclaimer(o, t) {
    if (t > 5.05) return;
    const inn = ez(E.outX, (t - 0.15) / 0.5);
    const out = ez(E.inC, (t - 4.55) / 0.45);
    if (inn <= 0 || out >= 1) return;
    const size = 36;
    o.save();
    o.font = `${size}px SC`;
    const tw = o.measureText(DISCLAIMER).width;
    o.restore();
    const bw = tw + 96;
    const bh = 78;
    const x = W / 2 - bw / 2;
    const y = H - 210 + out * 30;
    o.save();
    o.globalAlpha = 1 - out;
    o.fillStyle = 'rgba(6,6,6,0.82)';
    o.fillRect(x, y, bw * inn, bh);
    o.fillStyle = COL.redHot;
    o.fillRect(x, y, 8, bh);
    o.strokeStyle = 'rgba(255,255,255,0.35)';
    o.lineWidth = 1;
    o.strokeRect(x + 0.5, y + 0.5, bw * inn - 1, bh - 1);
    o.restore();
    // label
    text(o, 'NOTICE', x, y - 22, 'Mono', 20, COL.redHot, { alpha: (1 - out) * inn, tracking: 6 });
    // type the sentence in with a short scramble front
    const chars = [...DISCLAIMER];
    const shown = Math.floor(ez(E.outC, (t - 0.45) / 0.9) * (chars.length + 3));
    const k = Math.floor(t * 30);
    const str = chars
      .map((c, i) => (i < shown - 3 ? c : i < shown ? scrambleChar('dis', i, k) : ''))
      .join('');
    text(o, str, x + 50, y + bh / 2 + 1, 'SC', size, '#f4f0e8', { alpha: 1 - out });
  }
}
