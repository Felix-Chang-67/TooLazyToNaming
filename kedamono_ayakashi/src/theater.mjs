// 「影絵劇場」 — shadow-theatre design.
//
// One bulb sits behind a paper screen. Lyrics, the hand-shadow beast and every prop are puppets
// between the bulb and the paper, so what we see are their shadows: a puppet at depth z (0 = touching
// the paper, 1 = at the bulb) casts a shadow magnified by 1/(1-z), blurred by its penumbra and pushed
// away from the light. Letters "come into focus" by travelling to z = 0.
//   red cellophane  -> multiply-tinted light (red words, the red beast)
//   tears / slits   -> bare light leaking through the paper (additive)
//   projector       -> cold digital light laid over the paper (the "disorder" moments)
//   ink             -> printed on the paper itself (the stamp)
// Same interface as the classic Renderer: (await Theater.create(opts)).frame(t) -> canvas.
import fs from 'node:fs';
import path from 'node:path';
import { loadImage } from '@napi-rs/canvas';
import {
  W, H, COL, E, ez, clamp, lerp, smooth, rnd, rr, noise1, canvas, scaledCanvas, layout, drawGlyphs, text,
  makeNoiseTiles, makeVignette,
} from './lib.mjs';
import { SPB, Audio } from './audio.mjs';
import { parseLrc } from './lyrics.mjs';

export const ARTIST = 'ヒトリエ';
export const TITLE = 'KEDAMONO_AYAKASHI';
export const NOTICE = '中文翻译为个人翻译，可能有误，欢迎捉虫～';

const TAU = Math.PI * 2;
const SC = { x0: 110, y0: 92, x1: 1810, y1: 872 }; // the paper screen
SC.w = SC.x1 - SC.x0;
SC.h = SC.y1 - SC.y0;
SC.cx = (SC.x0 + SC.x1) / 2;
SC.cy = (SC.y0 + SC.y1) / 2;
const SONG_START = 0.1;
const beat = (n) => Audio.beatTime(n);
const B2 = 2 * SPB;
const WARM = [255, 233, 196];
const RED = [255, 46, 30];
const COLD = [214, 232, 255];
const INK = '#0b0705';
const rgba = ([r, g, b], a, m = 1) => `rgba(${Math.min(255, r * m) | 0},${Math.min(255, g * m) | 0},${Math.min(255, b * m) | 0},${clamp(a)})`;

// ------------------------------------------------------------------------------------- direction
// rows: [[{ r:[a,b), at?, font?, size?, kind? }]]  kind: shadow | red | leak | proj | stamp
const V = { font: 'Mincho', size: 92, enter: 'float', exit: 'away', stagger: 0.045 };
const CH = { font: 'Dela', size: 112, enter: 'slam', exit: 'away', stagger: 0.03 };
const at105 = beat(105) - 43.72; // chorus band entry, relative to the 0:43.72 line
const DIR = {
  0: { ...V, rows: [[{ r: [0, 13] }], [{ r: [14, 25] }]], y: 360, rowGap: 150, motif: 'tears', tearGlyph: 20 },
  1: { ...V, rows: [[{ r: [0, 7] }], [{ r: [7, 20] }]], y: 360, rowGap: 150, motif: 'slips' },
  2: { ...V, size: 78, rows: [[{ r: [0, 4] }, { r: [4, 11] }, { r: [11, 16], kind: 'red' }]], y: 160, motif: 'mirror' },
  3: { ...V, size: 132, enter: 'slam', y: 470, accent: [5], impact: { amp: 14, flash: 0.35, col: RED } },
  4: { ...V, size: 104, y: 470, holdZ: 0.05, jitterZ: true },
  5: { ...V, y: 330, hold: true },
  6: { ...V, y: 560 },
  7: { ...V, size: 100, enter: 'fall', y: 588, motif: 'stopline' },
  8: { font: 'Courier', size: 96, enter: 'type', exit: 'away', y: 400, hold: true, typeSpan: 1.25 },
  9: { font: 'Courier', size: 96, enter: 'type', exit: 'away', y: 560, typeSpan: 1.25 },
  10: { font: 'Courier', size: 128, enter: 'cut', exit: 'cut', stagger: 0.018, y: 470, kind: 'leak', leakCol: RED, motif: 'burst' },
  11: { font: 'KakuBlack', size: 96, layout: 'stairs', enter: 'drop', exit: 'away', echo: [5, 9], motif: 'railings' },
  12: { font: 'KakuBlack', size: 96, layout: 'cards', cards: [{ r: [0, 6], at: 0, px: SC.cx - 300 }, { r: [6, 10], px: SC.cx + 300 }] },
  13: {
    ...CH,
    rows: [[{ r: [0, 3], at: 0 }, { r: [3, 7], at: at105 }], [{ r: [7, 11], at: 2.56, size: 220, tear: true }]],
    y: 300,
    rowGap: 235,
    impact: { amp: 22, flash: 0.55, col: RED, at: at105 },
  },
  14: {
    ...CH,
    rows: [[{ r: [0, 4] }, { r: [4, 11], kind: 'proj', font: 'Dot', size: 118 }, { r: [11, 13] }], [{ r: [13, 16], at: 2.1, size: 150, impact: { amp: 12, flash: 0.25 } }]],
    y: 330,
    rowGap: 215,
  },
  15: {
    ...CH,
    rows: [[{ r: [0, 4] }, { r: [4, 10], at: 0.75, kind: 'proj', font: 'Dot', size: 112, dialog: true }], [{ r: [10, 14], at: 2.3 }, { r: [14, 17], at: 2.75, kind: 'stamp' }, { r: [17, 18], at: 3.0 }]],
    y: 330,
    rowGap: 230,
  },
  16: { font: 'Dela', size: 96, layout: 'cards', cards: [{ r: [0, 6], at: 0, px: SC.cx - 390 }, { r: [6, 11], at: B2, px: SC.cx + 390 }] },
  17: {
    font: 'Dela',
    size: 84,
    layout: 'tags',
    tags: [
      { r: [0, 3], at: 0, x: 470, y: 360 },
      { r: [4, 7], at: B2, x: 1390, y: 330 },
      { r: [8, 11], at: 2 * B2, x: 880, y: 600 },
      { r: [12, 16], at: 3 * B2, x: 1480, y: 640 },
    ],
    exit: 'away',
  },
};
const DEFAULT = { ...V, y: 470, rowGap: 150, x: SC.cx, maxW: SC.w - 160 };

// ------------------------------------------------------------------------------------- sections
function sections(L) {
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
  ].map(([id, t0, label], n) => ({ id, t0, label, n }));
  S.forEach((s, i) => (s.t1 = i + 1 < S.length ? S[i + 1].t0 : 1e9));
  return S;
}

// =================================================================================== Theater
export class Theater {
  static async create(opts) {
    const dir = opts.derivedDir;
    const [head, jaw] = await Promise.all(['beast_head.png', 'beast_jaw.png'].map((f) => loadImage(path.join(dir, f))));
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'beast.json'), 'utf8'));
    return new Theater({ ...opts, beast: { head, jaw, ...meta } });
  }

  constructor({ cover, audio, lrcText, scale = 1, beast }) {
    this.k = scale;
    this.cv = cover;
    this.au = audio;
    this.L = parseLrc(lrcText);
    this.duration = audio.duration;
    this.sections = sections(this.L);
    const k = scale;
    [this.S, this.s] = scaledCanvas(W, H, k);
    [this.O, this.o] = scaledCanvas(W, H, k);
    [this.SH, this.sh] = scaledCanvas(W, H, k);
    this.Q = [1, 2, 3].map(() => canvas(W / 4, H / 4));
    for (const [, q] of this.Q) q.setTransform(0.25, 0, 0, 0.25, 0, 0);
    [this.QB, this.qb] = canvas(W / 4, H / 4);
    if (k > 1) for (const c of [this.s, this.o, this.sh]) c.imageSmoothingQuality = 'medium';
    this.noise = makeNoiseTiles(8, 384);
    this.noisePat = this.noise.map((c) => this.o.createPattern(c, 'repeat'));
    this.vignette = makeVignette(k);
    this.paperTex = this.makePaper(k);
    this.beast = this.prepBeast(beast);
    this.prepare();
    this.buildImpacts();
  }

  // ------------------------------------------------------------------------------- preparation
  prepBeast(b) {
    const tint = (img, col) => {
      const [c, x] = canvas(img.width, img.height);
      x.drawImage(img, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = col;
      x.fillRect(0, 0, img.width, img.height);
      return c;
    };
    return { ...b, headRed: tint(b.head, 'rgb(230,40,28)'), jawRed: tint(b.jaw, 'rgb(230,40,28)') };
  }

  makePaper(k) {
    const [c, x] = scaledCanvas(W, H, k);
    x.fillStyle = 'rgb(128,128,128)';
    x.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const px = rr(SC.x0, SC.x1, 'pcx', i);
      const py = rr(SC.y0, SC.y1, 'pcy', i);
      const r = rr(60, 280, 'pcr', i);
      const v = rnd('pcv', i) < 0.5 ? 0 : 255;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${v},${v},${v},0.09)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      x.fillStyle = g;
      x.fillRect(px - r, py - r, 2 * r, 2 * r);
    }
    x.lineCap = 'round';
    for (let i = 0; i < 7000; i++) {
      const px = rr(SC.x0, SC.x1, 'fx', i);
      const py = rr(SC.y0, SC.y1, 'fy', i);
      const a = rr(0, Math.PI, 'fa', i);
      const len = rr(5, 34, 'fl', i);
      x.strokeStyle = rnd('fc', i) < 0.55 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.16)';
      x.lineWidth = rr(0.5, 1.5, 'fw', i);
      x.beginPath();
      x.moveTo(px, py);
      x.quadraticCurveTo(px + Math.cos(a) * len * 0.5 + rr(-4, 4, 'fq', i), py + Math.sin(a) * len * 0.5, px + Math.cos(a) * len, py + Math.sin(a) * len);
      x.stroke();
    }
    return c;
  }

  prepare() {
    const ctx = this.s;
    this.L.forEach((l, i) => {
      const d = { ...DEFAULT, ...(DIR[i] || {}) };
      if (l.en && !DIR[i]) Object.assign(d, { font: 'Courier', size: 96 });
      l.d = d;
      const cps = [...l.jp];
      const total = cps.length;
      const dur = l.t1 - l.t0;
      const est = (a) => (a / total) * dur * 0.72;
      const mk = (sg) => {
        const seg = { font: d.font, size: d.size, kind: d.kind || 'shadow', ...sg };
        seg.at = sg.at ?? est(sg.r[0]);
        seg.str = cps.slice(sg.r[0], sg.r[1]).join('');
        seg.L = layout(ctx, seg.str, seg.font, seg.size, { space: l.en ? 0.32 : 0.5 });
        seg.gapBefore = sg.r[0] > 0 && cps[sg.r[0] - 1] === ' ' ? seg.size * (l.en ? 0.32 : 0.42) : 0;
        return seg;
      };
      if (d.layout === 'cards' || d.layout === 'tags') {
        l.items = (d.cards || d.tags).map((c) => ({ ...c, seg: mk({ r: c.r, at: c.at }) }));
        l.items.forEach((it) => (it.card = this.makeCard(it.seg, d.layout === 'tags')));
        l.rows = [];
      } else if (d.layout === 'stairs') {
        l.stairs = this.prepStairs(l, cps, est);
        l.rows = [];
      } else {
        let g0 = 0;
        l.rows = (d.rows || [[{ r: [0, total] }]]).map((row, k) => {
          let segs = row.map(mk);
          let width = segs.reduce((a, s, j) => a + s.L.width + (j ? s.gapBefore : 0), 0);
          if (width > d.maxW) {
            const f = d.maxW / width;
            segs = row.map((sg) => mk({ ...sg, size: Math.floor((sg.size || d.size) * f) }));
            width = segs.reduce((a, s, j) => a + s.L.width + (j ? s.gapBefore : 0), 0);
          }
          let x = d.x - width / 2;
          segs.forEach((seg, j) => {
            if (j) x += seg.gapBefore;
            seg.x0 = x;
            seg.y0 = d.y + k * d.rowGap;
            seg.g0 = g0;
            g0 += seg.L.glyphs.length;
            x += seg.L.width;
          });
          return { segs, width };
        });
      }
    });
    this.L.forEach((l, i) => (l.tEnd = l.d.hold ? this.L[i + 1].t1 : l.t1));
  }

  prepStairs(l, cps, est) {
    const pos = [];
    let p = 0;
    let phrase = 0;
    let j = 0;
    let start = 0;
    cps.forEach((ch, k) => {
      if (ch === ' ') {
        p += 0.7;
        phrase++;
        j = 0;
        start = est(k + 1);
        return;
      }
      pos.push({ ch, x: 390 + p * 150, y: 210 + p * 64, at: start + j * 0.09, phrase, i: pos.length });
      const comma = '、，,。'.includes(ch);
      p += comma ? 0.55 : 1;
      j++;
      if (comma) {
        phrase++;
        j = 0;
        start = est(k + 1);
      }
    });
    return pos;
  }

  /** a stencil card: opaque card with the word cut out (light passes through the letters) */
  makeCard(seg, tag) {
    const k = this.k;
    const padX = seg.size * 0.42;
    const padY = seg.size * 0.34;
    const w = Math.ceil(seg.L.width + padX * 2);
    const h = Math.ceil(seg.size + padY * 2);
    const [c, x] = scaledCanvas(w, h, k);
    x.fillStyle = '#000';
    if (tag) {
      x.beginPath();
      x.moveTo(h * 0.32, 0);
      x.lineTo(w, 0);
      x.lineTo(w, h);
      x.lineTo(h * 0.32, h);
      x.lineTo(0, h / 2);
      x.closePath();
      x.fill();
    } else x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'destination-out';
    drawGlyphs(x, seg.L, w / 2 + (tag ? h * 0.12 : 0), h / 2 + seg.size * 0.04, { fill: '#000' });
    if (tag) {
      x.beginPath();
      x.arc(h * 0.3, h / 2, h * 0.08, 0, TAU);
      x.fill();
    }
    return { c, w, h };
  }

  buildImpacts() {
    const L = this.L;
    const imp = [{ t: SONG_START, amp: 6, flash: 0.25 }];
    L.forEach((l) => {
      const d = l.d;
      if (d.impact) imp.push({ t: l.t0 + (d.impact.at ?? 0), ...d.impact });
      for (const row of l.rows) for (const seg of row.segs) if (seg.impact) imp.push({ t: l.t0 + seg.at, ...seg.impact });
      for (const row of l.rows) for (const seg of row.segs) if (seg.kind === 'stamp') imp.push({ t: l.t0 + seg.at + 0.04, amp: 16, flash: 0.2, col: RED });
      if (d.layout === 'cards') for (const it of l.items.slice(1)) imp.push({ t: l.t0 + it.seg.at + 0.38, amp: 12, flash: 0.15 });
    });
    imp.push({ t: L[10].t0, amp: 18, flash: 1.0 }); // the bulb bursts
    imp.push({ t: beat(89), amp: 12, flash: 0.25, col: RED }); // pre-chorus hit
    for (const it of L[13].rows[1].segs) imp.push({ t: L[13].t0 + it.at, amp: 18, flash: 0.3, col: RED });
    imp.sort((a, b) => a.t - b.t);
    this.impacts = imp;
  }

  secAt(t) {
    let s = this.sections[0];
    for (const x of this.sections) if (t >= x.t0) s = x;
    return s;
  }

  // ------------------------------------------------------------------------------------- light
  lightAt(t) {
    const L = this.L;
    let x = SC.cx + 110 * Math.sin((t / 5.4) * TAU);
    let y = SC.cy - 80 + 18 * Math.cos((t / 2.7) * TAU);
    let I = 1;
    let col = WARM;
    let R = 1180;
    const kick = this.au.hit(this.au.kicks, t, 9, 0.35, 0.3);
    if (t < SONG_START) I = 0;
    else if (t < L[0].t0) {
      const u = t - SONG_START; // bulb switching on: on, stutter, on
      I = u < 0.05 ? 1.15 : u < 0.11 ? 0.12 : u < 0.17 ? 0.9 : u < 0.21 ? 0.3 : 1;
      I *= 1 + 0.07 * kick;
    } else if (t < L[8].t0) {
      I = 1 + 0.05 * kick;
      if (rnd(Math.floor(t * 15), 'flk') < 0.025) I *= 0.7;
      if (t >= L[4].t0 && t < L[4].t1) {
        x += noise1(t * 36, 1) * 95;
        y += noise1(t * 36, 2) * 60;
      }
      if (t >= L[5].t0 && t < L[7].t0) I *= 1 + 0.14 * smooth(L[5].t0, L[6].t1, t);
    } else if (t < L[10].t0) {
      I = 0.6;
      R = 820;
      const typed = this.typeHit(t);
      I *= 1 + 0.12 * typed;
    } else if (t < L[11].t0) {
      const u = t - L[10].t0;
      if (u < 0.05) I = 3.4;
      else {
        col = RED;
        I = 0.22 + 0.6 * Math.exp(-(u - 0.05) * 9);
        R = 700;
      }
    } else if (t < L[13].t0) {
      col = RED;
      const ang = ((t - L[11].t0) / (SPB * 4)) * TAU;
      x = SC.cx + 560 * Math.cos(ang);
      y = SC.cy + 170 * Math.sin(ang);
      I = 0.5 + 0.6 * this.au.pulse(t, 5);
      R = 1000;
    } else if (t < beat(105)) {
      I = 0.82;
      R = 640;
      x = SC.cx - 260;
      y = SC.cy - 100;
    } else if (t < L[17].t1) {
      col = RED;
      I = 1.02 + 0.32 * kick;
      R = 1350;
    } else {
      const u = t - L[17].t1; // the bulb dies at the end of the chorus
      col = RED;
      I = u < 0.07 ? 1 : u < 0.13 ? 0.08 : u < 0.2 ? 0.7 : Math.max(0, 0.7 - (u - 0.2) * 2.5);
    }
    return { x, y, I, col, R };
  }

  /** small flicker each time a typewriter key lands */
  typeHit(t) {
    let best = 0;
    for (const i of [8, 9]) {
      const l = this.L[i];
      if (t < l.t0 || t > l.t0 + 2) continue;
      const n = [...l.jp].length;
      for (let g = 0; g < n; g++) {
        const tg = l.t0 + 0.06 + (g / n) * l.d.typeSpan;
        if (t >= tg && t - tg < 0.1) best = Math.max(best, 1 - (t - tg) / 0.1);
      }
    }
    return best;
  }

  /** shadow of a puppet point at depth z */
  project(px, py, z) {
    const Lt = this.lt;
    const m = 1 / (1 - z);
    return { x: Lt.x + (px - Lt.x) * m, y: Lt.y + (py - Lt.y) * m, m, blur: z * 72, a: 1 - 0.38 * z };
  }

  /** route a shadow-casting draw call to the blur tiers (crossfading between neighbours) */
  cast(blur, alpha, fn) {
    if (alpha <= 0.003) return;
    const T = [0, 8, 20, 44];
    let i = 0;
    while (i < 3 && blur >= T[i + 1]) i++;
    const f = i < 3 ? clamp((blur - T[i]) / (T[i + 1] - T[i])) : 0;
    this.tier(i, alpha * (1 - f), fn);
    if (i < 3) this.tier(i + 1, alpha * f, fn);
  }

  tier(i, a, fn) {
    if (a <= 0.003) return;
    const ctx = i === 0 ? this.sh : this.Q[i - 1][1];
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    fn(ctx);
    ctx.restore();
  }

  // ===================================================================================== frame
  frame(t) {
    const L = this.L;
    const s = this.s;
    const k = this.k;
    this.lt = this.lightAt(t);
    this.tintQ = [];
    this.leakQ = [];
    this.projQ = [];
    this.inkQ = [];
    this.subs = [];
    s.setTransform(k, 0, 0, k, 0, 0);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
    this.sh.setTransform(k, 0, 0, k, 0, 0);
    this.sh.clearRect(0, 0, W, H);
    for (const [, q] of this.Q) q.clearRect(0, 0, W, H);

    this.drawStage(s, t);
    s.save();
    s.beginPath();
    s.rect(SC.x0, SC.y0, SC.w, SC.h);
    s.clip();
    this.drawPaper(s);

    // ---- puppets
    this.scene(t);
    for (const l of L) {
      if (t < l.t0 - 0.6 || t > l.tEnd + 0.7) continue;
      this.drawLine(l, t);
    }
    this.compositeShadows(s);
    for (const [q, op] of [[this.tintQ, 'multiply'], [this.leakQ, 'lighter'], [this.projQ, 'screen'], [this.inkQ, 'source-over']]) {
      for (const fn of q) {
        s.save();
        s.globalCompositeOperation = op;
        fn(s);
        s.restore();
      }
    }
    // paper grain + flashes
    s.globalCompositeOperation = 'overlay';
    s.globalAlpha = 0.55;
    s.drawImage(this.paperTex, 0, 0, W, H);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
    const f = this.flashAt(t);
    if (f.a > 0.01) {
      s.globalCompositeOperation = 'screen';
      s.fillStyle = rgba(f.col, f.a);
      s.fillRect(SC.x0, SC.y0, SC.w, SC.h);
      s.globalCompositeOperation = 'source-over';
    }
    s.restore();
    this.bloom(s);
    return this.post(t);
  }

  drawStage(s, t) {
    const Lt = this.lt;
    s.fillStyle = '#030302';
    s.fillRect(0, 0, W, H);
    const fy = SC.y1 + 14;
    const fg = s.createLinearGradient(0, fy, 0, H);
    fg.addColorStop(0, '#17110c');
    fg.addColorStop(1, '#040302');
    s.fillStyle = fg;
    s.fillRect(0, fy, W, H - fy);
    s.strokeStyle = 'rgba(0,0,0,0.6)';
    s.lineWidth = 2;
    const vy = SC.y1 - 1400;
    for (let i = -14; i <= 14; i++) {
      const bx = SC.cx + i * 170;
      const u = (fy - vy) / (H - vy);
      s.beginPath();
      s.moveTo(lerp(SC.cx, bx, u), fy);
      s.lineTo(bx, H);
      s.stroke();
    }
    if (Lt.I > 0.01) {
      const g = s.createRadialGradient(SC.cx, fy, 0, SC.cx, fy, 1000);
      g.addColorStop(0, rgba(Lt.col, 0.2 * Math.min(1.6, Lt.I)));
      g.addColorStop(1, rgba(Lt.col, 0));
      s.save();
      s.globalCompositeOperation = 'lighter';
      s.fillStyle = g;
      s.fillRect(0, fy, W, H - fy);
      s.restore();
    }
    s.fillStyle = '#140e0a';
    s.fillRect(SC.x0 - 14, SC.y0 - 14, SC.w + 28, SC.h + 28);
    s.strokeStyle = 'rgba(255,226,186,0.07)';
    s.lineWidth = 2;
    s.strokeRect(SC.x0 - 13, SC.y0 - 13, SC.w + 26, SC.h + 26);
  }

  drawPaper(s) {
    const Lt = this.lt;
    s.fillStyle = '#0c0806';
    s.fillRect(SC.x0, SC.y0, SC.w, SC.h);
    if (Lt.I <= 0.001) return;
    const I = Lt.I;
    const g = s.createRadialGradient(Lt.x, Lt.y, 0, Lt.x, Lt.y, Lt.R);
    g.addColorStop(0, rgba(Lt.col, 0.97 * I));
    g.addColorStop(0.32, rgba(Lt.col, 0.86 * I, 0.95));
    g.addColorStop(0.68, rgba(Lt.col, 0.55 * I, 0.78));
    g.addColorStop(1, rgba(Lt.col, 0.3 * I, 0.55));
    s.save();
    s.globalCompositeOperation = 'lighter';
    s.fillStyle = g;
    s.fillRect(SC.x0, SC.y0, SC.w, SC.h);
    if (I > 1.05) {
      s.globalAlpha = clamp((I - 1) / 1.5);
      s.fillStyle = '#fff6e8';
      s.fillRect(SC.x0, SC.y0, SC.w, SC.h);
    }
    s.restore();
  }

  compositeShadows(s) {
    const qb = this.qb;
    for (const [i, r] of [[2, 11], [1, 5], [0, 2]]) {
      qb.globalCompositeOperation = 'copy';
      qb.filter = `blur(${r}px)`;
      qb.drawImage(this.Q[i][0], 0, 0);
      qb.filter = 'none';
      this.sh.drawImage(this.QB, 0, 0, W, H);
    }
    s.save();
    s.globalAlpha = 0.9;
    s.drawImage(this.SH, 0, 0, W, H);
    s.restore();
  }

  bloom(s) {
    const qb = this.qb;
    qb.globalCompositeOperation = 'copy';
    qb.filter = 'blur(7px)';
    qb.drawImage(this.S, 0, 0, W / 4, H / 4);
    qb.filter = 'none';
    s.save();
    s.globalCompositeOperation = 'screen';
    s.globalAlpha = 0.32;
    s.drawImage(this.QB, 0, 0, W, H);
    s.restore();
  }

  flashAt(t) {
    let a = 0;
    let col = [255, 250, 240];
    for (const ev of this.impacts) {
      const dt = t - ev.t;
      if (dt < 0) break;
      if (dt < 0.6 && ev.flash) {
        const v = ev.flash * Math.exp(-dt * 9);
        if (v > a) {
          a = v;
          col = ev.col || [255, 250, 240];
        }
      }
    }
    return { a, col };
  }

  camera(t) {
    let shake = 0;
    for (const ev of this.impacts) {
      const dt = t - ev.t;
      if (dt < 0) break;
      if (dt < 0.8) shake += ev.amp * Math.exp(-dt * 8);
    }
    const chorus = t >= beat(105) && t < this.L[17].t1;
    if (chorus) shake += 6 * this.au.hit(this.au.kicks, t, 14, 0.25, 0.3);
    const zoom = 1 + (chorus ? 0.075 * smooth(beat(105), beat(105) + 0.6, t) : 0) + 0.006 * Math.sin(t * 0.37);
    return {
      x: noise1(t * 30, 11) * shake + noise1(t * 0.6, 12) * 5 + (rnd(Math.floor(t * 24), 'gw') - 0.5) * 0.8,
      y: noise1(t * 30, 13) * shake + noise1(t * 0.5, 14) * 4 + (rnd(Math.floor(t * 24), 'gh') - 0.5) * 0.8,
      zoom,
    };
  }

  post(t) {
    const o = this.o;
    const k = this.k;
    const cam = this.camera(t);
    o.setTransform(k, 0, 0, k, 0, 0);
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';
    o.fillStyle = '#030302';
    o.fillRect(0, 0, W, H);
    o.save();
    o.translate(SC.cx + cam.x, SC.cy + cam.y);
    o.scale(cam.zoom, cam.zoom);
    o.translate(-SC.cx, -SC.cy);
    o.drawImage(this.S, 0, 0, W, H);
    o.restore();
    // grain
    const g = Math.floor(t * 24);
    o.save();
    o.globalCompositeOperation = 'overlay';
    o.globalAlpha = 0.09;
    o.imageSmoothingEnabled = false;
    o.translate(-Math.floor(rnd(g, 1) * 384), -Math.floor(rnd(g, 2) * 384));
    o.fillStyle = this.noisePat[g % this.noisePat.length];
    o.fillRect(0, 0, W + 384, H + 384);
    o.restore();
    o.drawImage(this.vignette, 0, 0, W, H);
    this.drawSubs(o, t);
    this.drawChrome(o, t);
    const fade = 1 - smooth(0, 0.06, t);
    if (fade > 0) {
      o.globalAlpha = fade;
      o.fillStyle = '#000';
      o.fillRect(0, 0, W, H);
      o.globalAlpha = 1;
    }
    return this.O;
  }

  // ===================================================================================== scene
  scene(t) {
    const L = this.L;
    this.dust(t);
    // intro: the beast and the credits come into focus as the bulb comes on
    if (t >= SONG_START && t < L[0].t0 + 0.6) this.intro(t);
    if (t >= L[0].t0 - 0.2 && t < L[0].t1 + 0.6) this.tearsFor(L[0], t);
    if (t >= L[1].t0 - 0.4 && t < L[1].t1 + 1.2) this.slips(t, L[1]);
    if (t >= L[2].t0 - 0.4 && t < L[3].t1 + 0.5) this.mirror(t, L[2], L[3]);
    if (t >= L[7].t0 - 0.1 && t < L[10].t0) this.stopLine(t, L[7], L[10]);
    if (t >= L[10].t0 && t < L[11].t0 + 0.6) this.shards(t, L[10]);
    if (t >= L[11].t0 - 0.2 && t < L[13].t0 + 0.2) this.railings(t, L[11], L[13]);
    if (t >= beat(105) - 0.05 && t < L[17].t1 + 0.4) this.chorusBeast(t, L[17]);
  }

  dust(t) {
    const Lt = this.lt;
    if (Lt.I <= 0.05) return;
    for (let i = 0; i < 46; i++) {
      const z = rr(0.15, 0.7, 'dz', i);
      const px = ((rr(SC.x0, SC.x1, 'dx', i) + t * rr(-10, 10, 'dvx', i) + Math.sin(t * rr(0.2, 0.7, 'df', i) + i) * 40 - SC.x0) % SC.w + SC.w) % SC.w + SC.x0;
      const py = ((rr(SC.y0, SC.y1, 'dy', i) - t * rr(5, 22, 'dvy', i) - SC.y0) % SC.h + SC.h) % SC.h + SC.y0;
      const p = this.project(px, py, z);
      const r = rr(1.5, 4, 'dr', i) * p.m;
      this.cast(p.blur * 0.4, 0.35 * p.a, (c) => {
        c.beginPath();
        c.arc(p.x, p.y, r, 0, TAU);
        c.fill();
      });
    }
  }

  /** draw the beast (cover hand-shadow) as a puppet; mode shadow | red */
  beastAt({ X, Y, scale, z = 0, jaw = 0, flip = false, alpha = 1, brush = null, clip = null, mode = 'shadow' }) {
    const B = this.beast;
    const p = this.project(X, Y, z);
    const m = p.m * scale;
    const [ax, ay] = [1000, 1100];
    const [px, py] = B.jawPivot;
    const red = mode === 'red';
    const draw = (c) => {
      if (clip) {
        c.beginPath();
        c.rect(...clip);
        c.clip();
      }
      c.translate(p.x, p.y);
      if (flip) c.scale(-1, 1);
      c.scale(m, m);
      c.translate(-ax, -ay);
      c.drawImage(red ? B.headRed : B.head, 0, 0);
      c.save();
      c.translate(px, py);
      c.rotate(jaw);
      c.translate(-px, -py);
      c.drawImage(red ? B.jawRed : B.jaw, 0, 0);
      c.restore();
      if (brush !== null) {
        // a toothbrush scrubbing at the snout
        const off = Math.sin(brush * TAU * 3.6) * 55;
        c.fillStyle = red ? 'rgb(230,40,28)' : '#000';
        c.save();
        c.translate(off, 0);
        c.rotate(-0.08);
        c.fillRect(-300, 1262, 360, 30);
        c.fillRect(20, 1218, 96, 48);
        for (let i = 0; i < 6; i++) c.fillRect(24 + i * 16, 1196, 8, 26);
        c.restore();
      }
    };
    if (red) {
      this.tintQ.push((s) => {
        s.globalAlpha = alpha;
        draw(s);
      });
    } else this.cast(p.blur, alpha * p.a, draw);
  }

  intro(t) {
    const L = this.L;
    const u = t - SONG_START;
    const away = ez(E.inC, (t - (L[0].t0 - 0.5)) / 0.8);
    const z = lerp(0.42, 0.04, ez(E.outC, u / 1.1)) + away * 0.5;
    const a = clamp(u / 0.2) * (1 - away);
    const b = this.au.beat(t);
    const jaw = -0.12 * Math.exp(-b.phase * 4) * (b.idx % 2 === 0 ? 1 : 0.4);
    this.beastAt({ X: 900, Y: 640, scale: 0.4, z, jaw, alpha: a });
    // credits: artist as a shadow cut-out, title as red cellophane (like the cover)
    const ca = clamp((u - 0.25) / 0.4) * (1 - away);
    if (ca <= 0) return;
    const zc = lerp(0.35, 0, ez(E.outC, (u - 0.25) / 0.8)) + away * 0.4;
    const art = layout(this.s, ARTIST, 'KakuBlack', 58, { tracking: 0.35 });
    this.castText(art, SC.cx, 168, zc, ca);
    const tt = layout(this.s, TITLE, 'AntonioBold', 128, { tracking: 0.06 });
    const p = this.project(SC.cx, 262, zc);
    this.tintQ.push((s) => {
      s.globalAlpha = ca * p.a;
      s.translate(p.x, p.y);
      s.scale(p.m, p.m);
      drawGlyphs(s, tt, 0, 0, { fill: 'rgb(220,38,26)' });
    });
  }

  /** a whole laid-out string as a shadow, centred at (x, y) at depth z */
  castText(Lay, x, y, z, a) {
    const p = this.project(x, y, z);
    this.cast(p.blur, a * p.a, (c) => {
      c.translate(p.x, p.y);
      c.scale(p.m, p.m);
      drawGlyphs(c, Lay, 0, 0, { fill: '#000' });
    });
  }

  tear(cx, cy, len, ang, t0, t, seed, fade) {
    const e = ez(E.outX, (t - t0) / 0.13);
    if (e <= 0 || fade <= 0) return;
    const n = 26;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const sN = (i / n) * e;
      const w = Math.sin(Math.PI * (i / n)) ** 0.7 * rr(10, 22, seed, i);
      const j = (rnd(seed, i, 2) - 0.5) * 9;
      pts.push([cx + ux * (sN - 0.5) * len - uy * j, cy + uy * (sN - 0.5) * len + ux * j, w]);
    }
    const outline = (c) => {
      c.beginPath();
      pts.forEach(([x, y, w], i) => (i ? c.lineTo(x - uy * w * 0.5, y + ux * w * 0.5) : c.moveTo(x - uy * w * 0.5, y + ux * w * 0.5)));
      for (let i = pts.length - 1; i >= 0; i--) {
        const [x, y, w] = pts[i];
        c.lineTo(x + uy * w * 0.5 + (rnd(seed, i, 5) - 0.5) * 4, y - ux * w * 0.5);
      }
      c.closePath();
    };
    const col = this.lt.col;
    this.leakQ.push((s) => {
      s.globalAlpha = fade;
      s.fillStyle = rgba(col, 1, 1.15);
      outline(s);
      s.fill();
    });
    this.cast(0, 0.75 * fade, (c) => {
      c.lineWidth = 4;
      c.lineJoin = 'round';
      outline(c);
      c.stroke();
    });
  }

  tearsFor(l, t) {
    // claw marks rip the paper when "傷" lands
    let tg = l.t0;
    let gx = SC.cx;
    let gy = l.d.y;
    for (const row of l.rows)
      for (const seg of row.segs) {
        const i = l.d.tearGlyph - seg.g0;
        if (i >= 0 && i < seg.L.glyphs.length) {
          tg = l.t0 + seg.at + i * l.d.stagger + 0.25;
          gx = seg.x0 + seg.L.glyphs[i].x + seg.L.glyphs[i].w / 2;
          gy = seg.y0;
        }
      }
    const fade = 1 - smooth(l.t1 - 0.2, l.t1 + 0.5, t);
    for (let i = 0; i < 4; i++) this.tear(gx - 150 + i * 95, gy - 10, 470, -1.05, tg + i * 0.05, t, 31 + i, fade);
  }

  slips(t, l) {
    const a = smooth(l.t0 - 0.3, l.t0 + 0.5, t) * (1 - smooth(l.t1 - 0.2, l.t1 + 1.0, t));
    if (a <= 0) return;
    for (let i = 0; i < 18; i++) {
      const life = rr(3.6, 6.4, 'sl', i);
      const off = rnd('so', i) * life;
      const tt = t - l.t0 + off + 3;
      const cyc = Math.floor(tt / life);
      const u = (tt % life) / life;
      const z = rr(0.04, 0.5, 'sz', i, cyc);
      const px = rr(SC.x0 + 40, SC.x1 - 40, 'sx', i, cyc) + Math.sin(u * 7 + i) * 60;
      const py = lerp(SC.y0 - 160, SC.y1 + 160, u);
      const rot = u * rr(-5, 5, 'sr', i) + rr(0, TAU, 'sr0', i);
      const flipY = Math.cos(u * rr(6, 14, 'sf', i) + i);
      const p = this.project(px, py, z);
      this.cast(p.blur, a * 0.8 * p.a, (c) => {
        c.translate(p.x, p.y);
        c.rotate(rot);
        c.scale(p.m, p.m * (0.25 + 0.75 * Math.abs(flipY)));
        c.beginPath();
        c.rect(-28, -38, 56, 76);
        // a pharmacy cross punched out of the slip
        c.moveTo(-5, -22);
        c.lineTo(5, -22);
        c.lineTo(5, -12);
        c.lineTo(15, -12);
        c.lineTo(15, -2);
        c.lineTo(5, -2);
        c.lineTo(5, 8);
        c.lineTo(-5, 8);
        c.lineTo(-5, -2);
        c.lineTo(-15, -2);
        c.lineTo(-15, -12);
        c.lineTo(-5, -12);
        c.closePath();
        c.rect(-18, 16, 36, 4);
        c.rect(-18, 25, 26, 4);
        c.fill('evenodd');
      });
    }
  }

  mirror(t, l2, l3) {
    // the mirror (left) and the beast brushing its teeth (right); the reflection lags behind,
    // and on "僕" it turns red and is all that is left
    const a = smooth(l2.t0 - 0.4, l2.t0 + 0.2, t) * (1 - smooth(l3.t1 - 0.1, l3.t1 + 0.5, t));
    if (a <= 0) return;
    const turn = smooth(l3.t0, l3.t0 + 0.25, t);
    const frame = [210, 228, 600, 618];
    this.cast(0, a * 0.95, (c) => {
      c.lineWidth = 16;
      c.strokeRect(frame[0], frame[1], frame[2], frame[3]);
      c.lineWidth = 3;
      c.strokeRect(frame[0] + 22, frame[1] + 22, frame[2] - 44, frame[3] - 44);
      c.fillRect(frame[0] + frame[2] / 2 - 70, frame[1] + frame[3], 140, 30);
    });
    const bob = (tt) => Math.sin(tt * 2.2) * 8;
    // the "real" beast, facing the mirror
    const real = (1 - turn) * a;
    if (real > 0.01) this.beastAt({ X: 1470, Y: 600 + bob(t), scale: 0.28, z: 0.03, alpha: real, brush: t, jaw: -0.05 });
    // the reflection, a beat behind
    const lag = t - 0.32;
    const inner = [frame[0] + 24, frame[1] + 24, frame[2] - 48, frame[3] - 48];
    this.beastAt({ X: 545, Y: 600 + bob(lag), scale: 0.28, z: 0.03, alpha: a * (1 - turn), brush: lag, jaw: -0.05, flip: true, clip: inner });
    if (turn > 0) this.beastAt({ X: 545, Y: 600 + bob(lag), scale: 0.28, z: 0.03, alpha: a * turn, brush: lag, jaw: -0.05, flip: true, clip: inner, mode: 'red' });
  }

  stopLine(t, l7, l10) {
    const y = 650;
    const e = ez(E.outX, (t - l7.t0) / 0.35);
    const a = (1 - smooth(l10.t0 - 0.6, l10.t0, t)) * (1 - 0.5 * smooth(l7.t1, l7.t1 + 0.5, t));
    if (e <= 0 || a <= 0) return;
    const x0 = 330;
    const x1 = lerp(x0, 1590, e);
    const col = this.lt.col;
    this.leakQ.push((s) => {
      s.globalAlpha = a;
      s.fillStyle = rgba(col, 1, 1.2);
      s.fillRect(x0, y - 7, x1 - x0, 14);
    });
  }

  shards(t, l10) {
    const u = t - l10.t0;
    if (u < 0) return;
    for (let i = 0; i < 26; i++) {
      const ang = rr(-Math.PI * 0.9, -Math.PI * 0.1, 'ga', i);
      const v = rr(300, 900, 'gv', i);
      const px = SC.cx - 40 + Math.cos(ang) * v * u;
      const py = SC.cy - 80 + Math.sin(ang) * v * u + 900 * u * u;
      const z = rr(0.2, 0.6, 'gz', i);
      const p = this.project(px, py, z);
      const r = rr(8, 22, 'gr', i);
      this.cast(p.blur, 0.7 * p.a * (1 - smooth(0.6, 1.0, u)), (c) => {
        c.translate(p.x, p.y);
        c.rotate(u * rr(-12, 12, 'gro', i));
        c.scale(p.m, p.m);
        c.beginPath();
        c.moveTo(0, -r);
        c.lineTo(r * 0.7, r * 0.6);
        c.lineTo(-r * 0.5, r * 0.4);
        c.closePath();
        c.fill();
      });
    }
  }

  railings(t, l11, l13) {
    // stair railing shadows sliding past the beacon (we are going down the emergency stairs)
    const a = smooth(l11.t0 - 0.2, l11.t0 + 0.3, t) * (1 - smooth(l13.t0 - 0.25, l13.t0, t));
    if (a <= 0) return;
    const slope = 64 / 150;
    const off = ((t - l11.t0) * 170) % 460;
    for (let k = -1; k < 3; k++) {
      const y0 = SC.y0 - 200 - off + k * 460;
      const p = this.project(SC.cx, y0, 0.22);
      this.cast(p.blur, a * 0.8, (c) => {
        c.lineWidth = 20;
        c.beginPath();
        c.moveTo(SC.x0 - 100, y0 - (SC.cx - SC.x0 + 100) * slope);
        c.lineTo(SC.x1 + 100, y0 + (SC.x1 + 100 - SC.cx) * slope);
        c.stroke();
        for (let x = SC.x0 - 80; x < SC.x1 + 100; x += 115) {
          const yy = y0 + (x - SC.cx) * slope;
          c.fillRect(x - 5, yy, 10, 300);
        }
      });
    }
  }

  chorusBeast(t, l17) {
    // the beast looms over the chorus, biting on the kick
    const inn = ez(E.outX, (t - beat(105)) / 0.35);
    const out = 1 - smooth(l17.t1 - 0.1, l17.t1 + 0.3, t);
    const kick = this.au.hit(this.au.kicks, t, 10, 0.3, 0.3);
    const z = lerp(0.6, 0.3, inn);
    this.beastAt({ X: 1610, Y: 470 + Math.sin(t * 1.7) * 14, scale: 0.5, z, jaw: -0.06 - 0.32 * kick, alpha: 0.5 * inn * out });
  }

  // ===================================================================================== lyrics
  drawLine(l, t) {
    const d = l.d;
    const v = t >= l.tEnd ? clamp((t - l.tEnd) / (d.exit === 'cut' ? 0.06 : 0.4)) : 0;
    if (v >= 1) return;
    if (l.cn && t >= l.t0 - 0.05) this.subs.push(l);
    let dim = 1;
    if (d.hold) dim = 1 - 0.45 * smooth(this.L[l.i + 1].t0, this.L[l.i + 1].t0 + 0.35, t);
    if (d.layout === 'stairs') return this.drawStairs(l, t, v);
    if (d.layout === 'cards') return this.drawCards(l, t, v);
    if (d.layout === 'tags') return this.drawTags(l, t, v);
    for (const row of l.rows) for (const seg of row.segs) this.drawSeg(l, seg, t, v, dim);
    if (d.enter === 'type' && v === 0) this.caret(l, t);
  }

  /** glyph pose: rest position offset, depth, alpha, scale */
  pose(d, seg, g, u, v, t) {
    let z = d.holdZ || 0;
    let dx = 0;
    let dy = 0;
    let a = 1;
    let sc = 1;
    let rot = 0;
    switch (seg.enter || d.enter) {
      case 'float': {
        const e = ez(E.outC, u / 0.7);
        z = lerp(0.5, z, e);
        dy = (1 - e) * 46;
        a = clamp(u / 0.28);
        break;
      }
      case 'slam': {
        const e = ez(E.outX, u / 0.2);
        z = lerp(0.72, z, e);
        a = clamp(u / 0.05);
        break;
      }
      case 'fall': {
        // dropped from above, bounces on the stop line
        const fall = 0.42;
        if (u < fall) dy = -(1 - (u / fall) ** 2) * 420;
        else dy = -Math.abs(Math.sin(((u - fall) / 0.22) * Math.PI)) * 46 * Math.exp(-(u - fall) * 7);
        rot = (1 - ez(E.outC, u / 0.8)) * rr(-0.5, 0.5, seg.r[0], g.i);
        z = lerp(0.1, 0, ez(E.outC, u / 0.5));
        a = clamp(u / 0.1);
        break;
      }
      case 'drop': {
        const e = ez(E.outB, u / 0.45, 2);
        dy = -(1 - e) * 120;
        z = lerp(0.45, 0, ez(E.outC, u / 0.45));
        a = clamp(u / 0.12);
        break;
      }
      case 'type': {
        sc = u < 0.07 ? 1.12 : 1;
        z = u < 0.07 ? 0.05 : 0;
        break;
      }
      default:
        break;
    }
    if (d.jitterZ && u > 0.7) z += rnd(Math.floor(t * 14), seg.r[0], g.i) < 0.12 ? 0.14 : 0;
    if (u < 0) a = 0;
    if (v > 0) {
      if (d.exit === 'cut') a = 0;
      else {
        z = lerp(z, 0.55, E.inQ(v));
        a *= 1 - v;
      }
    }
    return { z, dx, dy, a, sc, rot };
  }

  glyphTime(l, seg, g) {
    const d = l.d;
    if (d.enter === 'type') {
      const n = [...l.jp].length;
      return l.t0 + 0.06 + ((seg.r[0] + g.i) / n) * d.typeSpan;
    }
    return l.t0 + seg.at + g.i * (d.stagger ?? 0.04);
  }

  drawSeg(l, seg, t, v, dim) {
    const d = l.d;
    const kind = seg.kind;
    const font = `${seg.size}px ${seg.font}`;
    for (const g of seg.L.glyphs) {
      const tg = this.glyphTime(l, seg, g);
      const ps = this.pose(d, seg, g, t - tg, v, t);
      if (ps.a <= 0.003) continue;
      const gx = seg.x0 + g.x + g.w / 2 + ps.dx;
      const gy = seg.y0 + ps.dy;
      const accent = d.accent && d.accent.includes(seg.g0 + g.i);
      const p = this.project(gx, gy, ps.z);
      const draw = (c, fill) => {
        c.translate(p.x, p.y);
        if (ps.rot) c.rotate(ps.rot);
        c.scale(p.m * ps.sc, p.m * ps.sc);
        c.font = font;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = fill;
        c.fillText(g.ch, 0, 0);
      };
      const a = ps.a * dim;
      if (kind === 'red' || accent) {
        this.tintQ.push((s) => {
          s.globalAlpha = a * p.a;
          draw(s, 'rgb(222,36,24)');
        });
      } else if (kind === 'leak') {
        const col = d.leakCol || this.lt.col;
        this.leakQ.push((s) => {
          s.globalAlpha = a;
          s.shadowColor = rgba(col, 0.9);
          s.shadowBlur = 24 * this.k;
          draw(s, rgba(col, 1));
        });
      } else if (kind === 'proj') {
        this.projGlyph(seg, g, p, a, t, draw);
      } else if (kind === 'stamp') {
        // handled per segment below
      } else {
        this.cast(p.blur, a * p.a, (c) => draw(c, '#000'));
      }
    }
    if (kind === 'proj') this.projFrame(l, seg, t, v);
    if (kind === 'stamp') this.stamp(l, seg, t, v);
    if (seg.tear && t >= l.t0 + seg.at) {
      const fade = 1 - smooth(l.t1 - 0.2, l.t1 + 0.3, t);
      const cx = seg.x0 + seg.L.width / 2;
      for (let i = 0; i < 3; i++) this.tear(cx - 120 + i * 120, seg.y0, 560, 1.15, l.t0 + seg.at + 0.03 + i * 0.05, t, 71 + i, fade);
    }
  }

  projGlyph(seg, g, p, a, t, draw) {
    // projected (cold, digital) light: RGB split + stuttering scanline slices
    const k = Math.floor(t * 20);
    const jx = rnd(k, seg.r[0], g.i) < 0.12 ? (rnd(k, g.i, 'j') - 0.5) * 40 : 0;
    this.projQ.push((s) => {
      s.globalAlpha = a * (0.85 + 0.15 * rnd(k, 'pf'));
      s.save();
      s.translate(jx - 4, 0);
      draw(s, 'rgba(255,60,70,0.9)');
      s.restore();
      s.save();
      s.translate(jx + 4, 0);
      draw(s, 'rgba(60,220,255,0.9)');
      s.restore();
      s.save();
      s.translate(jx, 0);
      draw(s, rgba(COLD, 1));
      s.restore();
    });
  }

  projFrame(l, seg, t, v) {
    // the rectangle of light thrown by the intruding projector (+ a dialog window for OS非対応)
    const t0 = l.t0 + seg.at - 0.12;
    const on = t < t0 ? 0 : t - t0 < 0.12 ? (rnd(Math.floor(t * 40), 'po') < 0.5 ? 1 : 0.2) : 1;
    const a = on * (1 - v);
    if (a <= 0) return;
    const padX = 18;
    const x0 = seg.x0 - padX;
    const w = seg.L.width + padX * 2;
    const h = seg.size * (seg.dialog ? 1.95 : 1.45);
    const y0 = seg.y0 - h / 2 - (seg.dialog ? seg.size * 0.25 : 0);
    const k = Math.floor(t * 24);
    const wob = (rnd(k, 'pw') - 0.5) * 6;
    this.projQ.push((s) => {
      s.globalAlpha = a * 0.34;
      s.fillStyle = rgba(COLD, 1);
      s.fillRect(x0 + wob, y0, w, h);
      s.globalAlpha = a * 0.25;
      s.fillStyle = 'rgba(0,0,0,1)';
      for (let y = y0; y < y0 + h; y += 6) s.fillRect(x0 + wob, y, w, 2);
      s.globalAlpha = a * 0.9;
      s.strokeStyle = rgba(COLD, 1);
      s.lineWidth = 3;
      s.strokeRect(x0 + wob, y0, w, h);
      if (seg.dialog) {
        s.fillStyle = rgba(COLD, 1);
        s.fillRect(x0 + wob, y0, w, 34);
        s.globalAlpha = a;
        text(s, 'ERROR', x0 + wob + 14, y0 + 18, 'Mono', 22, '#0a0a12', { tracking: 4 });
        text(s, 'x', x0 + wob + w - 22, y0 + 17, 'Mono', 22, '#0a0a12', { align: 'center' });
      }
    });
  }

  stamp(l, seg, t, v) {
    const u = t - (l.t0 + seg.at);
    if (u < 0) return;
    if (!seg.stampImg) {
      const size = seg.size;
      const w = Math.ceil(seg.L.width + size * 0.6 + 20);
      const h = Math.ceil(size * 1.32 + 20);
      const [c, x] = scaledCanvas(w, h, this.k);
      x.strokeStyle = 'rgb(196,22,16)';
      x.lineWidth = size * 0.075;
      x.beginPath();
      x.roundRect(10, 10, w - 20, h - 20, size * 0.12);
      x.stroke();
      drawGlyphs(x, seg.L, w / 2, h / 2 + 2, { fill: 'rgb(196,22,16)' });
      x.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 460; i++) {
        x.globalAlpha = rr(0.3, 1, 'sa', i);
        const r = rr(0.6, 3.4, 'sr', i);
        x.fillRect(rr(0, w, 'sx', i), rr(0, h, 'sy', i), r, r);
      }
      seg.stampImg = { c, w, h };
    }
    const S = seg.stampImg;
    const e = ez(E.outX, u / 0.15);
    const sc = lerp(2.6, 1, e);
    const a = clamp(u / 0.04) * (1 - v);
    const cx = seg.x0 + seg.L.width / 2;
    this.inkQ.push((s) => {
      s.globalAlpha = a * 0.92;
      s.translate(cx, seg.y0);
      s.rotate(-0.12 + (1 - e) * 0.2);
      s.scale(sc, sc);
      s.globalCompositeOperation = 'multiply';
      s.drawImage(S.c, -S.w / 2, -S.h / 2, S.w, S.h);
    });
  }

  caret(l, t) {
    // typewriter caret after the last struck key
    const seg = l.rows[0].segs[0];
    let x = seg.x0;
    for (const g of seg.L.glyphs) if (t >= this.glyphTime(l, seg, g)) x = seg.x0 + g.x + g.w + 10;
    const done = t > l.t0 + l.d.typeSpan + 0.1;
    if (done && Math.floor(t / (SPB / 2)) % 2) return;
    this.cast(0, 0.9, (c) => c.fillRect(x, seg.y0 + seg.size * 0.38, seg.size * 0.5, 8));
  }

  drawStairs(l, t, v) {
    const d = l.d;
    const font = `${d.size}px ${d.font}`;
    const [e0, e1] = d.echo;
    for (const q of l.stairs) {
      const tg = l.t0 + q.at;
      const ps = this.pose(d, { r: [0], enter: 'drop' }, { i: q.i }, t - tg, v, t);
      if (ps.a <= 0.003) continue;
      const draw = (c, p, sc = 1) => {
        c.translate(p.x, p.y);
        c.scale(p.m * sc, p.m * sc);
        c.font = font;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(q.ch, 0, 0);
      };
      const p = this.project(q.x, q.y + ps.dy, ps.z);
      this.cast(p.blur, ps.a * p.a, (c) => draw(c, p));
      // 響き渡る: each beat throws an echo of the word further back toward the light
      if (q.i >= e0 && q.i < e1 && t > tg) {
        const b0 = Math.ceil((tg - Audio.beatTime(0)) / SPB);
        for (let n = b0; ; n++) {
          const tb = Audio.beatTime(n);
          if (tb > t) break;
          const u = (t - tb) / (SPB * 1.6);
          if (u > 1) continue;
          const pe = this.project(q.x, q.y, 0.62 * E.outC(u));
          this.cast(pe.blur, 0.42 * (1 - u) * ps.a, (c) => draw(c, pe));
        }
      }
    }
  }

  drawCards(l, t, v) {
    for (const it of l.items) {
      const u = t - (l.t0 + it.seg.at);
      if (u < 0) continue;
      const dir = it.px < SC.cx ? -1 : 1;
      const th = dir * 1.25 * Math.exp(-u * 2.6) * Math.cos(u * (TAU / 1.25));
      const len = 380;
      const top = [it.px, SC.y0 - 30];
      const cx = top[0] + Math.sin(th) * len;
      const cy = top[1] + Math.cos(th) * len;
      const a = clamp(u / 0.08) * (1 - v);
      const C = it.card;
      const p = this.project(cx, cy, 0.06 + v * 0.4);
      this.cast(p.blur, a * p.a, (c) => {
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(top[0], top[1]);
        c.lineTo(p.x, p.y - (C.h / 2) * p.m);
        c.stroke();
        c.translate(p.x, p.y);
        c.rotate(-th * 0.35);
        c.scale(p.m, p.m);
        c.drawImage(C.c, -C.w / 2, -C.h / 2, C.w, C.h);
      });
    }
  }

  drawTags(l, t, v) {
    const items = l.items;
    // network strings between consecutive tags, drawn as each new tag arrives
    for (let i = 1; i < items.length; i++) {
      const e = ez(E.outC, (t - (l.t0 + items[i].seg.at)) / 0.35);
      if (e <= 0) continue;
      const [a0, a1] = [items[i - 1], items[i]];
      this.cast(0, 0.85 * (1 - v), (c) => {
        c.lineWidth = 4;
        c.beginPath();
        c.moveTo(a0.x, a0.y);
        c.lineTo(lerp(a0.x, a1.x, e), lerp(a0.y, a1.y, e));
        c.stroke();
      });
    }
    for (const it of items) {
      const u = t - (l.t0 + it.seg.at);
      if (u < 0) continue;
      const drop = ez(E.outB, u / 0.4, 2.2);
      const sw = 0.25 * Math.exp(-u * 2.5) * Math.sin(u * 9);
      const y = lerp(SC.y0 - 120, it.y, drop);
      const C = it.card;
      const p = this.project(it.x, y, 0.05 + v * 0.4);
      const a = clamp(u / 0.08) * (1 - v);
      this.cast(p.blur, a * p.a, (c) => {
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(it.x, SC.y0 - 20);
        c.lineTo(p.x, p.y - (C.h / 2) * p.m);
        c.stroke();
        c.translate(p.x, p.y);
        c.rotate(sw);
        c.scale(p.m, p.m);
        c.drawImage(C.c, -C.w / 2, -C.h / 2, C.w, C.h);
      });
    }
  }

  // ===================================================================================== overlay
  drawSubs(o, t) {
    const live = this.subs
      .map((l) => ({ l, a: smooth(l.t0 - 0.05, l.t0 + 0.2, t) * (1 - smooth(l.tEnd - 0.05, l.tEnd + 0.2, t)) }))
      .filter((x) => x.a > 0.01)
      .sort((p, q) => p.l.t0 - q.l.t0);
    const ys = live.length > 1 ? [948, 1008] : [980];
    live.slice(-2).forEach(({ l, a }, i, arr) => {
      const dimmed = arr.length > 1 && i === 0 ? 0.55 : 1;
      text(o, l.cn, W / 2, ys[i], 'SerifSCSemi', 42, '#efe4cf', { align: 'center', alpha: a * dimmed, tracking: 2 });
    });
  }

  drawChrome(o, t) {
    // small credit above the screen, and the notice for the first five seconds
    const a = 0.62 * smooth(0.4, 1.0, t);
    text(o, ARTIST, SC.x0, 48, 'KakuBlack', 22, '#efe4cf', { alpha: a, tracking: 3 });
    o.font = '22px KakuBlack';
    const aw = o.measureText(ARTIST).width + 3 * 4;
    o.save();
    o.globalAlpha = a;
    o.fillStyle = COL.redHot;
    o.fillRect(SC.x0 + aw + 12, 38, 2, 20);
    o.restore();
    text(o, TITLE, SC.x0 + aw + 28, 48, 'AntonioBold', 24, '#efe4cf', { alpha: a, tracking: 4 });
    const na = smooth(0.15, 0.55, t) * (1 - smooth(4.55, 5.0, t));
    if (na > 0.01) {
      o.font = '28px SC';
      const tw = o.measureText(NOTICE).width;
      const x = SC.x1 - tw;
      text(o, 'NOTE', x - 92, 48, 'Mono', 18, COL.redHot, { alpha: na, tracking: 5 });
      text(o, NOTICE, x, 48, 'SC', 28, '#efe4cf', { alpha: na });
    }
  }
}
