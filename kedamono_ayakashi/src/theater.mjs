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
  // ---- verse 2: a ruled rulebook page is printed on the paper
  18: { ...V, font: 'KakuBlack', size: 90, rows: [[{ r: [0, 4], redact: true }, { r: [4, 10] }], [{ r: [10, 22] }]], y: 340, rowGap: 150 },
  19: { ...V, font: 'KakuBlack', size: 88, rows: [[{ r: [0, 10] }], [{ r: [10, 19] }]], y: 270, rowGap: 135, hold: true },
  20: { ...V, font: 'Dela', size: 200, enter: 'slam', kind: 'red', x: SC.cx - 300, y: 640, impact: { amp: 10, flash: 0.15 } },
  21: { ...V, font: 'KakuBlack', size: 90, rows: [[{ r: [0, 12] }], [{ r: [12, 19] }]], y: 290, rowGap: 145 },
  22: { font: 'KakuBlack', size: 82, layout: 'bubbles', bubble: { x: 640, y: 320, tail: 1 }, hold: true },
  23: { font: 'KakuBlack', size: 82, layout: 'bubbles', bubble: { x: 1240, y: 600, tail: -1 } },
  // ---- I hate me.: strobing lights throw several shadows of the line
  24: { font: 'Courier', size: 150, enter: 'cut', stagger: 0.02, y: 470, multi: 3, z: 0.04 },
  25: { font: 'Courier', size: 160, enter: 'cut', stagger: 0.02, y: 470, multi: 6, z: 0.07, exit: 'cut' },
  // ---- pre-chorus 2: the stairs go up, the cards drop in from above
  26: { font: 'KakuBlack', size: 96, layout: 'stairs', up: true, enter: 'drop', exit: 'away', echo: [5, 9] },
  27: { font: 'KakuBlack', size: 96, layout: 'cards', fromTop: true, cards: [{ r: [0, 6], at: 0, px: SC.cx - 330 }, { r: [6, 10], px: SC.cx + 330 }] },
  // ---- bridge
  28: { ...V, font: 'Dot', size: 112, y: 350, holdZ: 0.02, jitterZ: true },
  29: { ...V, font: 'KakuBlack', size: 96, rows: [[{ r: [0, 12] }], [{ r: [12, 16], at: 2.1 }]], y: 330, rowGap: 160, tangle: true },
  30: { ...V, rows: [[{ r: [0, 16] }], [{ r: [16, 19], at: 3.0, size: 150, kind: 'red' }]], y: 172, rowGap: 590 },
  // ---- chorus 2 (no stop this time: the band is already in)
  31: {
    ...CH,
    rows: [[{ r: [0, 3], at: 0 }, { r: [3, 7], at: 1.0 }], [{ r: [7, 11], at: 2.5, size: 220, tear: true, impact: { amp: 18, flash: 0.3, col: RED } }]],
    y: 300,
    rowGap: 235,
    impact: { amp: 18, flash: 0.45, col: RED },
  },
  32: {
    ...CH,
    rows: [[{ r: [0, 4] }, { r: [4, 11], kind: 'proj', font: 'Dot', size: 118 }, { r: [11, 13] }], [{ r: [13, 16], at: 2.1, size: 150, impact: { amp: 12, flash: 0.25 } }]],
    y: 330,
    rowGap: 215,
  },
  33: {
    ...CH,
    rows: [[{ r: [0, 4] }, { r: [4, 10], at: 0.75, kind: 'proj', font: 'Dot', size: 112, dialog: true }], [{ r: [10, 14], at: 2.3 }, { r: [14, 17], at: 2.75, kind: 'stamp' }, { r: [17, 18], at: 3.0 }]],
    y: 330,
    rowGap: 230,
  },
  34: {
    font: 'Dela',
    size: 84,
    layout: 'tags',
    tags: [
      { r: [0, 5], at: 0, x: 600, y: 320 },
      { r: [6, 11], at: B2, x: 1330, y: 310 },
      { r: [12, 15], at: 2 * B2, x: 720, y: 610 },
      { r: [16, 20], at: 3 * B2, x: 1250, y: 620 },
    ],
    exit: 'away',
  },
  // ---- outro: the 脳細胞 tags hang on a growing neural net, then the chant takes centre stage
  35: {
    font: 'Dela',
    size: 78,
    layout: 'tags',
    net: true,
    tags: [
      { r: [0, 3], at: 0, x: 430, y: 330 },
      { r: [4, 7], at: B2, x: 1470, y: 310 },
      { r: [8, 11], at: 2 * B2, x: 560, y: 670 },
      { r: [12, 15], at: 3 * B2, x: 1380, y: 680 },
    ],
    exit: 'away',
  },
  36: {
    font: 'Dela',
    size: 82,
    layout: 'tags',
    net: true,
    tags: [
      { r: [0, 3], at: 0, x: 960, y: 270 },
      { r: [4, 7], at: B2, x: 330, y: 520 },
      { r: [8, 11], at: 2 * B2, x: 1600, y: 500 },
      { r: [12, 16], at: 3 * B2, x: 960, y: 700 },
    ],
    exit: 'away',
  },
  37: { ...CH, size: 140, rows: [[{ r: [0, 3], at: 0 }, { r: [4, 8], at: B2, kind: 'leak' }]], y: 450, perSeg: 12, leakCol: WARM },
  38: { ...CH, size: 150, rows: [[{ r: [0, 3], at: 0 }, { r: [4, 8], at: B2, kind: 'leak' }]], y: 450, perSeg: 14, leakCol: WARM },
  39: { ...CH, size: 160, rows: [[{ r: [0, 3], at: 0 }, { r: [4, 8], at: B2, kind: 'leak' }]], y: 450, perSeg: 16, leakCol: WARM },
};
const DEFAULT = { ...V, y: 470, rowGap: 150, x: SC.cx, maxW: SC.w - 160 };
const FINAL_HIT = beat(394); // last hit before the music stops (~167.77 s)

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
    this.staticPat = this.noise.map((c) => this.s.createPattern(c, 'repeat'));
    this.coverSepia = this.tintCover('rgb(236,204,150)');
    this.beast = this.prepBeast(beast);
    this.prepare();
    this.buildNet();
    this.buildImpacts();
  }

  tintCover(col) {
    const [c, x] = canvas(1024, 1024);
    x.drawImage(this.cv.small, 0, 0, 1024, 1024);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = col;
    x.fillRect(0, 0, 1024, 1024);
    return c;
  }

  /** the string web of the gap / outro; the outro tags hang from some of its knots */
  buildNet() {
    const nodes = [];
    for (const i of [35, 36]) for (const tg of DIR[i].tags) nodes.push({ x: tg.x, y: tg.y - 72, k: nodes.length });
    let tries = 0;
    while (nodes.length < 24 && tries < 8000) {
      tries++;
      const x = rr(SC.x0 + 50, SC.x1 - 50, 'nx', tries);
      const y = rr(SC.y0 + 40, SC.y1 - 70, 'ny', tries);
      if (nodes.every((n) => Math.hypot(n.x - x, n.y - y) > 210)) nodes.push({ x, y, k: nodes.length });
    }
    const edges = [];
    const seen = new Set();
    for (const a of nodes) {
      const near = nodes.filter((b) => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
      for (const b of near.slice(0, 3)) {
        const key = a.k < b.k ? `${a.k}-${b.k}` : `${b.k}-${a.k}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a, b, j: edges.length, sag: rr(10, 45, 'sg', edges.length) });
      }
    }
    // some knots hang from the top of the screen
    for (const n of nodes) n.hang = n.y < SC.y0 + 330 && rnd('hg', n.k) < 0.6;
    this.net = { nodes, edges };
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
      } else if (d.layout === 'bubbles') {
        l.items = [{ ...d.bubble, seg: mk({ r: [0, total], at: 0 }) }];
        l.items[0].card = this.makeBubble(l.items[0].seg, d.bubble.tail);
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
      const up = l.d.up;
      pos.push({ ch, x: up ? 300 + p * 150 : 390 + p * 150, y: up ? 790 - p * 64 : 210 + p * 64, at: start + j * 0.09, phrase, i: pos.length });
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
    imp.push({ t: beat(145), amp: 6, flash: 0.2, col: COLD }); // slide projector clicks on
    imp.push({ t: beat(149), amp: 10, flash: 0.25 }); // the projected beast comes alive
    imp.push({ t: L[18].t0, amp: 12, flash: 0.35 });
    imp.push({ t: L[26].t0, amp: 12, flash: 0.3, col: RED });
    imp.push({ t: this.cancelClickTime(L[28]), amp: 9, flash: 0.25, col: COLD });
    imp.push({ t: L[31].t0, amp: 18, flash: 0.5, col: RED });
    imp.push({ t: L[34].t1, amp: 10, flash: 0.3, col: RED });
    imp.push({ t: 133.56, amp: 18, flash: 0.5, col: RED }); // outro bass drop
    imp.push({ t: L[39].t1, amp: 12, flash: 0.35 });
    imp.push({ t: FINAL_HIT, amp: 14, flash: 1.0 });
    for (const i of [37, 38, 39]) for (const seg of L[i].rows[0].segs) imp.push({ t: L[i].t0 + seg.at, amp: L[i].d.perSeg, flash: 0.2, col: RED });
    for (const i of [24, 25]) imp.push({ t: L[i].t0, amp: 12 + (i - 24) * 6, flash: 0.3, col: i === 25 ? RED : undefined });
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
    } else if (t < L[18].t0) {
      // interlude: the bulb dies, a slide projector takes over, then the bulb comes back
      const u = t - L[17].t1;
      if (t < beat(145)) {
        col = RED;
        I = u < 0.07 ? 1 : u < 0.13 ? 0.08 : u < 0.2 ? 0.7 : Math.max(0, 0.7 - (u - 0.2) * 2.5);
      } else if (t < beat(149)) I = 0;
      else {
        I = smooth(beat(149) - 0.05, beat(149) + 0.4, t) * (1 + 0.06 * kick);
        const amp = 110 + 260 * smooth(beat(165), L[18].t0, t);
        x = SC.cx + amp * Math.sin((t / 2.2) * TAU);
      }
    } else if (t < L[24].t0) {
      I = 1 + 0.05 * kick; // verse 2
      if (t >= L[20].t0 && t < L[20].t1) I *= 0.9;
    } else if (t < L[26].t0) {
      I = 0.45; // break 2: the main bulb dims, strobing lights do the work (aux)
      R = 900;
    } else if (t < L[28].t0) {
      col = RED; // pre-chorus 2: faster beacon
      const ang = ((t - L[26].t0) / (SPB * 2)) * TAU;
      x = SC.cx + 600 * Math.cos(ang);
      y = SC.cy + 190 * Math.sin(ang);
      I = 0.5 + 0.7 * this.au.pulse(t, 5);
      R = 1000;
    } else if (t < L[29].t0) {
      I = 0.42 + 0.22 * rnd(Math.floor(t * 20), 'brown'); // the noise: the bulb browns out
    } else if (t < L[30].t0) {
      I = 0.95;
    } else if (t < L[31].t0) {
      I = 0.5; // the film plays
      R = 900;
    } else if (t < L[34].t1) {
      col = RED; // chorus 2
      I = 1.05 + 0.34 * kick;
      R = 1350;
    } else if (t < L[35].t0) {
      col = RED; // the gap: the web grows under a pulsing light
      I = 0.35 + 0.8 * this.au.pulse(t, 4);
      x = SC.cx + 300 * Math.sin((t / 1.7) * TAU);
    } else if (t < L[39].t1) {
      col = RED; // outro
      I = 0.85 + 0.38 * kick + 0.15 * smooth(L[37].t0, L[39].t1, t);
      R = 1300;
    } else if (t < FINAL_HIT) {
      // ending: the warm bulb swings wider and wider
      const amp = lerp(120, 460, smooth(L[39].t1, FINAL_HIT, t));
      x = SC.cx + amp * Math.sin((t / 1.9) * TAU);
      y = SC.cy - 90 + 30 * Math.cos((t / 0.95) * TAU);
      I = 1 + 0.08 * kick;
    } else {
      const u = t - FINAL_HIT; // and bursts on the last hit
      I = u < 0.05 ? 3.2 : 0;
    }
    const aux = [];
    for (const i of [24, 25]) {
      const l = L[i];
      if (t < l.t0 || t >= l.t1) continue;
      const n = l.d.multi;
      const b = this.au.beat(t);
      for (let j = 0; j < n; j++) {
        const on = (b.idx + j) % n === 0 || (i === 25 && (b.idx + j) % 3 === 0);
        const p = on ? Math.exp(-b.phase * 2.6) : 0.08;
        aux.push({
          x: SC.x0 + ((j + 0.5) / n) * SC.w,
          y: SC.cy + (j % 2 ? 160 : -200),
          I: (i === 25 ? 0.95 : 0.8) * p,
          col: i === 25 && j % 2 ? RED : WARM,
          R: 820,
        });
      }
    }
    return { x, y, I, col, R, aux };
  }

  cancelClickTime(l) {
    return Audio.beatTime(Math.ceil((l.t0 + 1.1 - Audio.beatTime(0)) / SPB));
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
    this.paperQ = [];
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
    for (const fn of this.paperQ) {
      s.save();
      fn(s);
      s.restore();
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
    for (const A of Lt.aux || []) {
      if (A.I < 0.01) continue;
      const g = s.createRadialGradient(A.x, A.y, 0, A.x, A.y, A.R);
      g.addColorStop(0, rgba(A.col, 0.9 * A.I));
      g.addColorStop(1, rgba(A.col, 0));
      s.save();
      s.globalCompositeOperation = 'lighter';
      s.fillStyle = g;
      s.fillRect(SC.x0, SC.y0, SC.w, SC.h);
      s.restore();
    }
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
    const L = this.L;
    const c1 = t >= beat(105) && t < L[17].t1;
    const c2 = t >= L[31].t0 && t < L[34].t1;
    const outro = t >= L[34].t1 && t < L[39].t1;
    if (c1 || c2 || outro) shake += (outro ? 8 : 6) * this.au.hit(this.au.kicks, t, 14, 0.25, 0.3);
    let push = 0;
    if (c1) push = 0.075 * smooth(beat(105), beat(105) + 0.6, t);
    if (c2) push = 0.075 * smooth(L[31].t0, L[31].t0 + 0.4, t);
    if (outro) push = 0.05 + 0.06 * smooth(L[37].t0, L[39].t1, t);
    const zoom = 1 + push + 0.006 * Math.sin(t * 0.37);
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
    const fade = Math.max(1 - smooth(0, 0.06, t), smooth(FINAL_HIT + 0.05, FINAL_HIT + 0.5, t));
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
    if (t >= L[17].t1 && t < L[18].t0 + 0.1) this.interlude(t);
    if (t >= L[18].t0 - 0.4 && t < L[23].t1) this.rulebook(t, L[18], L[23]);
    if (t >= L[19].t0 - 0.3 && t < L[20].t1 + 0.6) {
      this.questions(t, L[19], L[20]);
      this.turnBeast(t, L[19], L[20]);
    }
    if (t >= L[21].t0 && t < L[21].t1 + 0.4) this.shoes(t, L[21]);
    if (t >= L[26].t0 - 0.2 && t < L[28].t0) this.railings(t, L[26], L[28], -1);
    if (t >= L[28].t0 - 0.15 && t < L[28].t1 + 0.05) this.staticNoise(t, L[28]);
    if (t >= L[29].t0 && t < L[29].t1 + 0.3) this.ruleStrings(t, L[29]);
    if (t >= L[30].t0 - 0.1 && t < L[30].t1 + 0.05) this.filmReel(t, L[30]);
    if (t >= L[31].t0 - 0.05 && t < L[34].t1 + 0.4) {
      this.burn(t, L[31].t0, L[34].t1);
      this.chorusBeasts(t, L[31].t0, L[34].t1);
    }
    if (t >= L[34].t1 && t < L[39].t1 + 0.4) this.web(t);
    if (t >= L[37].t0 && t < L[39].t1 + 0.3) this.outroBeast(t);
    if (t >= L[39].t1 - 0.1 && t < FINAL_HIT + 0.1) this.ending(t);
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
  beastAt({ X, Y, scale, z = 0, jaw = 0, flip = false, alpha = 1, brush = null, clip = null, mode = 'shadow', sx = 1 }) {
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
      if (sx !== 1) c.scale(Math.abs(sx) < 0.02 ? 0.02 : sx, 1);
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

  railings(t, l11, l13, dir = 1) {
    // stair railing shadows sliding past the beacon (we are going down the emergency stairs)
    const a = smooth(l11.t0 - 0.2, l11.t0 + 0.3, t) * (1 - smooth(l13.t0 - 0.25, l13.t0, t));
    if (a <= 0) return;
    const slope = (dir * 64) / 150;
    const off = (((t - l11.t0) * (dir > 0 ? 170 : 240)) % 460) * dir;
    for (let k = -2; k < 3; k++) {
      const y0 = SC.y0 - 200 - off + k * 460 + (dir < 0 ? 380 : 0);
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


  // ------------------------------------------------------------------------------ interlude
  interlude(t) {
    const L = this.L;
    const t1 = L[18].t0;
    const tOn = beat(145);
    const tAlive = beat(149);
    const tMany = beat(157);
    const tMerge = beat(165);
    const Sz = 700;
    const k = Math.floor(t * 24);
    // a slide projector throws the album art onto the paper...
    const pa = smooth(tOn, tOn + 0.04, t) * (1 - smooth(tAlive, tAlive + SPB * 2, t));
    if (pa > 0.01) {
      const fl = 0.84 + 0.16 * rnd(k, 'pfl');
      this.projQ.push((s) => {
        s.globalAlpha = pa * fl;
        s.drawImage(this.cv.small, SC.cx - Sz / 2, SC.cy - Sz / 2, Sz, Sz);
        s.globalAlpha = pa * 0.45;
        s.fillStyle = '#ffffff';
        for (let i = 0; i < 3; i++) if (rnd(k, i, 'scr') < 0.6) s.fillRect(SC.cx - Sz / 2 + rnd(k, i, 'sx') * Sz, SC.cy - Sz / 2, 1.5, Sz);
      });
    }
    // ...and the beast in it comes alive as a real shadow when the bulb returns
    const sc = Sz / 2048;
    const X0 = SC.cx - Sz / 2 + 1000 * sc;
    const Y0 = SC.cy - Sz / 2 + 1100 * sc;
    const ba = smooth(tAlive - 0.1, tAlive + SPB, t) * (1 - smooth(t1 - 0.2, t1, t));
    if (ba <= 0) return;
    const b = this.au.beat(t);
    const bite = (n) => -0.05 - 0.3 * Math.exp(-b.phase * 5) * ((b.idx + n) % 2 === 0 ? 1 : 0.2);
    const rush = ez(E.inC, (t - (t1 - 1.6)) / 1.6);
    const spread = smooth(tMany, tMany + SPB * 2, t) * (1 - smooth(tMerge, tMerge + SPB * 4, t));
    if (spread > 0.01) {
      // two more lights, two more beasts, biting in turn
      this.beastAt({ X: X0 - 560 * spread, Y: Y0 + 20, scale: sc * 0.85, z: 0.14, jaw: bite(1), alpha: ba * 0.7 * spread, flip: true });
      this.beastAt({ X: X0 + 560 * spread, Y: Y0 + 20, scale: sc * 0.85, z: 0.14, jaw: bite(1), alpha: ba * 0.7 * spread });
    }
    this.beastAt({ X: X0, Y: Y0 + Math.sin(t * 2) * 8, scale: sc, z: 0.02 + rush * 0.55, jaw: bite(0), alpha: ba });
  }

  // ------------------------------------------------------------------------------ verse 2
  rulebook(t, l18, l23) {
    const a = smooth(l18.t0 - 0.3, l18.t0 + 0.3, t) * (1 - smooth(l23.t1 - 0.4, l23.t1, t));
    if (a <= 0) return;
    this.paperQ.push((s) => {
      s.globalCompositeOperation = 'multiply';
      s.globalAlpha = a * 0.6;
      s.strokeStyle = 'rgb(70,52,36)';
      s.lineWidth = 1.4;
      for (let y = SC.y0 + 78; y < SC.y1 - 20; y += 58) {
        s.beginPath();
        s.moveTo(SC.x0 + 30, y);
        s.lineTo(SC.x1 - 30, y);
        s.stroke();
      }
      s.strokeStyle = 'rgb(176,40,28)';
      s.lineWidth = 2.4;
      s.beginPath();
      s.moveTo(SC.x0 + 170, SC.y0 + 16);
      s.lineTo(SC.x0 + 170, SC.y1 - 16);
      s.stroke();
      s.fillStyle = 'rgb(70,52,36)';
      s.font = '26px Courier';
      s.textBaseline = 'alphabetic';
      for (let i = 0; i < 13; i++) s.fillText(`§${String(i + 1).padStart(2, '0')}`, SC.x0 + 50, SC.y0 + 70 + i * 58);
    });
  }

  questions(t, l19, l20) {
    const a = smooth(l19.t0 - 0.2, l19.t0 + 0.3, t) * (1 - smooth(l20.t1 - 0.2, l20.t1 + 0.4, t));
    if (a <= 0) return;
    for (let i = 0; i < 7; i++) {
      const u = t - (l19.t0 + i * 0.2);
      if (u < 0) continue;
      const x = SC.x0 + 120 + ((i * 0.618 + 0.13) % 1) * (SC.w - 240);
      const len = rr(150, 430, 'ql', i);
      const z = rr(0.04, 0.32, 'qz', i);
      const drop = ez(E.outB, u / 0.5, 2);
      const sw = 0.4 * Math.exp(-u * 1.3) * Math.sin(u * rr(5, 8, 'qw', i) + i) + 0.05 * Math.sin(t * 2 + i);
      const top = [x, SC.y0 - 20];
      const p = this.project(x + Math.sin(sw) * len * drop, top[1] + Math.cos(sw) * len * drop, z);
      const size = rr(100, 170, 'qs', i);
      this.cast(p.blur, a * 0.8 * p.a, (c) => {
        c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(top[0], top[1]);
        c.lineTo(p.x, p.y - size * 0.42 * p.m);
        c.stroke();
        c.translate(p.x, p.y);
        c.rotate(sw);
        c.scale(p.m, p.m);
        c.font = `${Math.round(size)}px AntonioBold`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('?', 0, 0);
      });
    }
  }

  turnBeast(t, l19, l20) {
    // the beast prowls in on the right, and on "なあ" turns round to face the room
    const a = smooth(l19.t0 - 0.2, l19.t0 + 0.6, t) * (1 - smooth(l20.t1 - 0.1, l20.t1 + 0.4, t));
    if (a <= 0) return;
    const turn = ez(E.ioC, (t - l20.t0) / 0.32);
    const jaw = t >= l20.t0 ? -0.05 - 0.4 * Math.exp(-(t - l20.t0) * 2.5) : -0.04 + 0.04 * Math.sin(t * 9);
    const walk = lerp(SC.x1 + 200, 1450, ez(E.outC, (t - l19.t0) / 0.9));
    this.beastAt({ X: walk, Y: 690, scale: 0.3, z: lerp(0.16, 0.02, turn), jaw, alpha: a * 0.92, sx: Math.cos(turn * Math.PI) });
  }

  shoes(t, l21) {
    // a pair of shoes walks across the bottom of the screen, one step per beat
    const seg = l21.rows[1].segs[0];
    const ts = l21.t0 + seg.at - 0.1;
    const a = smooth(ts, ts + 0.25, t) * (1 - smooth(l21.t1 - 0.15, l21.t1 + 0.3, t));
    if (a <= 0) return;
    const b = Math.max(0, (t - ts) / SPB);
    const kb = Math.floor(b);
    const fr = b - kb;
    const stride = 240;
    for (const f of [0, 1]) {
      const done = kb > f ? Math.floor((kb - f + 1) / 2) : 0;
      const moving = kb % 2 === f;
      const prog = moving ? E.ioC(fr) : 0;
      const x = SC.x0 + 120 + f * stride + (done + prog) * 2 * stride;
      if (x > SC.x1 + 200) continue;
      const y = SC.y1 - 78 - (moving ? Math.sin(fr * Math.PI) * 60 : 0);
      const p = this.project(x, y, 0.06);
      this.cast(p.blur, a * 0.92, (c) => {
        c.translate(p.x, p.y);
        c.rotate(moving ? -0.18 * Math.sin(fr * Math.PI) : 0);
        c.scale(p.m * 1.15, p.m * 1.15);
        c.beginPath();
        c.moveTo(-78, 22);
        c.lineTo(66, 22);
        c.quadraticCurveTo(88, 20, 84, 4);
        c.quadraticCurveTo(72, -14, 30, -20);
        c.lineTo(8, -44);
        c.lineTo(-32, -52);
        c.quadraticCurveTo(-64, -54, -76, -22);
        c.closePath();
        c.fill();
        c.fillRect(-82, 22, 170, 9);
      });
    }
  }

  makeBubble(seg, tail) {
    const k = this.k;
    const padX = seg.size * 0.55;
    const padY = seg.size * 0.42;
    const w = Math.ceil(seg.L.width + padX * 2);
    const bh = Math.ceil(seg.size + padY * 2);
    const h = bh + 70;
    const [c, x] = scaledCanvas(w, h, k);
    x.fillStyle = '#000';
    x.beginPath();
    x.roundRect(0, 0, w, bh, bh * 0.45);
    x.fill();
    x.beginPath();
    const tx = tail > 0 ? w * 0.72 : w * 0.28;
    x.moveTo(tx - 34, bh - 4);
    x.lineTo(tx + tail * 70, h);
    x.lineTo(tx + 34, bh - 4);
    x.closePath();
    x.fill();
    x.globalCompositeOperation = 'destination-out';
    drawGlyphs(x, seg.L, w / 2, bh / 2 + seg.size * 0.04, { fill: '#000' });
    return { c, w, h, bh };
  }

  drawBubbles(l, t, v) {
    const it = l.items[0];
    const u = t - l.t0;
    if (u < 0) return;
    const pop = ez(E.outB, u / 0.32, 2.6);
    const C = it.card;
    const k = Math.floor(t * 18);
    const shiver = (rnd(k, l.i) - 0.5) * 6;
    const p = this.project(it.x + shiver, it.y, 0.04 + v * 0.45);
    const dim = l.d.hold ? 1 - 0.4 * smooth(this.L[l.i + 1].t0, this.L[l.i + 1].t0 + 0.3, t) : 1;
    this.cast(p.blur, clamp(u / 0.06) * (1 - v) * dim * p.a, (c) => {
      c.translate(p.x, p.y);
      c.scale(p.m * pop, p.m * pop);
      c.drawImage(C.c, -C.w / 2, -C.bh / 2, C.w, C.h);
    });
  }

  // ------------------------------------------------------------------------------ bridge
  staticNoise(t, l) {
    // the projector loses its signal: TV static over the paper, and a CANCEL that does nothing
    const a = smooth(l.t0 - 0.12, l.t0 + 0.12, t) * (1 - smooth(l.t1 - 0.12, l.t1, t));
    if (a <= 0) return;
    const u = t - l.t0;
    const tc = this.cancelClickTime(l) - l.t0;
    const failed = u >= tc;
    const k = Math.floor(t * 30);
    const pop0 = ez(E.outB, (u - 0.1) / 0.35, 1.6);
    const sh0 = failed ? Math.exp(-(u - tc) * 6) * 24 * noise1(t * 40, 9) : 0;
    const hole = pop0 > 0 ? (() => {
      const sc = lerp(0.85, 1, pop0);
      const [w, h] = [820 * sc, 206 * sc];
      return [SC.cx + sh0 - w / 2, 600 + 103 - h / 2, w, h];
    })() : null;
    this.paperQ.push((s) => {
      s.globalCompositeOperation = 'screen';
      s.globalAlpha = a * (0.34 + (failed ? 0.2 : 0) + 0.08 * rnd(k, 'st'));
      s.imageSmoothingEnabled = false;
      if (hole) {
        s.beginPath();
        s.rect(SC.x0, SC.y0, SC.w, SC.h);
        s.rect(...hole);
        s.clip('evenodd');
      }
      s.save();
      s.scale(3, 3);
      s.translate(-Math.floor(rnd(k, 'sx') * 384), -Math.floor(rnd(k, 'sy') * 384));
      s.fillStyle = this.staticPat[k % this.staticPat.length];
      s.fillRect(0, 0, W / 3 + 400, H / 3 + 400);
      s.restore();
      const ry = ((t * 420) % (H + 300)) - 150;
      const rg = s.createLinearGradient(0, ry - 90, 0, ry + 90);
      rg.addColorStop(0, 'rgba(220,235,255,0)');
      rg.addColorStop(0.5, 'rgba(220,235,255,0.22)');
      rg.addColorStop(1, 'rgba(220,235,255,0)');
      s.globalAlpha = a;
      s.fillStyle = rg;
      s.fillRect(SC.x0, ry - 90, SC.w, 180);
    });
    const pop = ez(E.outB, (u - 0.1) / 0.35, 1.6);
    if (pop <= 0) return;
    const shake = failed ? Math.exp(-(u - tc) * 6) * 24 * noise1(t * 40, 9) : 0;
    const dw = 820;
    const dh = 206;
    const dx = SC.cx - dw / 2;
    const dy = 600;
    const col = failed ? RED : COLD;
    const p = failed ? 0.99 : 0.99 * ez(E.outC, (u - 0.25) / Math.max(0.2, tc - 0.4));
    const bw = 168;
    const bh = 46;
    const bx = dx + dw - bw - 26;
    const by = dy + dh - bh - 18;
    const pressed = u >= tc && u < tc + 0.12;
    const cu = ez(E.ioC, (u - 0.45) / Math.max(0.2, tc - 0.55));
    const px = lerp(SC.x1 - 260, bx + bw * 0.62, cu);
    const py = lerp(SC.y1 - 40, by + bh * 0.6, cu) + (pressed ? 3 : 0);
    this.projQ.push((s) => {
      s.globalAlpha = a * clamp(pop * 1.5);
      s.translate(SC.cx + shake, dy + dh / 2);
      s.scale(lerp(0.85, 1, pop), lerp(0.85, 1, pop));
      s.translate(-SC.cx, -(dy + dh / 2));
      s.fillStyle = rgba(col, 0.16);
      s.fillRect(dx, dy, dw, dh);
      s.strokeStyle = rgba(col, 1);
      s.lineWidth = 2;
      s.strokeRect(dx, dy, dw, dh);
      s.fillStyle = rgba(col, 0.9);
      s.fillRect(dx, dy, dw, 34);
      text(s, failed ? 'SYSTEM ERROR' : 'NOISE CANCELLING', dx + 16, dy + 18, 'Mono', 20, '#05070c', { tracking: 3 });
      text(s, failed ? 'ERROR 0x7E: NOISE CANNOT BE CANCELLED' : 'CANCELLING NOISE ...', dx + 24, dy + 72, 'Mono', 24, rgba(col, 1), { tracking: 2 });
      const pw = dw - 250;
      s.strokeRect(dx + 24, dy + 100, pw, 24);
      s.fillStyle = rgba(col, failed && Math.floor(t * 8) % 2 ? 0.45 : 1);
      s.fillRect(dx + 27, dy + 103, (pw - 6) * p, 18);
      text(s, `${Math.floor(p * 100)}%`, dx + 24 + pw + 16, dy + 113, 'Mono', 22, rgba(col, 1));
      s.strokeStyle = rgba(col, 1);
      s.strokeRect(bx, by + (pressed ? 3 : 0), bw, bh);
      text(s, 'CANCEL', bx + bw / 2, by + bh / 2 + (pressed ? 3 : 0), 'Mono', 24, rgba(col, 1), { align: 'center', tracking: 4 });
      if (failed) {
        s.fillStyle = rgba(RED, 1);
        s.fillRect(bx + 12, by + bh / 2 - 1, bw - 24, 3);
      }
      s.translate(px, py);
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
      s.fillStyle = rgba(COLD, 1);
      s.fill();
    });
  }

  ruleStrings(t, l) {
    // rules drop in as puppet strings and tangle round the words
    const fade = 1 - smooth(l.t1 - 0.1, l.t1 + 0.3, t);
    const n = 34;
    for (let i = 0; i < n; i++) {
      const ts = l.t0 + 0.2 + (i / n) * (l.t1 - l.t0 - 0.5);
      const e = ez(E.outQu, (t - ts) / 0.28);
      if (e <= 0) break;
      const x0 = rr(SC.x0 - 100, SC.x1 + 100, 'rsx', i);
      const x1 = rr(SC.x0 - 100, SC.x1 + 100, 'rex', i);
      const y1 = rr(SC.cy - 80, SC.y1 + 60, 'rey', i);
      const sag = rr(60, 260, 'rsg', i);
      const z = rr(0.02, 0.22, 'rz', i);
      const p0 = this.project(x0, SC.y0 - 20, z);
      const p1 = this.project(lerp(x0, x1, e), lerp(SC.y0 - 20, y1, e), z);
      const pc = this.project((x0 + lerp(x0, x1, e)) / 2, (SC.y0 + lerp(SC.y0, y1, e)) / 2 + sag * e, z);
      this.cast(p0.blur, 0.75 * fade, (c) => {
        c.lineWidth = rr(1.6, 3.4, 'rw', i);
        c.beginPath();
        c.moveTo(p0.x, p0.y);
        c.quadraticCurveTo(pc.x, pc.y, p1.x, p1.y);
        c.stroke();
      });
    }
  }

  filmReel(t, l) {
    // a film leader counting backwards (rewinding)... then "あの時" plays as old footage
    const play = l.t0 + l.rows[1].segs[0].at;
    const a = smooth(l.t0, l.t0 + 0.25, t) * (1 - smooth(l.t1 - 0.25, l.t1, t));
    if (a <= 0) return;
    const k = Math.floor(t * 24);
    const cx = SC.cx;
    const cy = 470;
    const R = 210;
    if (t < play) {
      const u = t - l.t0;
      const digit = 2 + (Math.floor(u / 0.42) % 8);
      const sweep = -((u / 0.42) % 1) * TAU;
      this.projQ.push((s) => {
        s.globalAlpha = a * (0.8 + 0.2 * rnd(k, 'lf'));
        s.fillStyle = rgba(COLD, 0.22);
        s.fillRect(cx - R * 1.45, cy - R * 1.1, R * 2.9, R * 2.2);
        s.fillStyle = rgba(COLD, 0.35);
        s.beginPath();
        s.moveTo(cx, cy);
        s.arc(cx, cy, R * 1.25, -Math.PI / 2, -Math.PI / 2 + sweep, true);
        s.closePath();
        s.fill();
        s.strokeStyle = rgba(COLD, 0.95);
        s.lineWidth = 4;
        for (const r of [R, R * 0.82]) {
          s.beginPath();
          s.arc(cx, cy, r, 0, TAU);
          s.stroke();
        }
        s.lineWidth = 2;
        s.beginPath();
        s.moveTo(cx - R * 1.45, cy);
        s.lineTo(cx + R * 1.45, cy);
        s.moveTo(cx, cy - R * 1.1);
        s.lineTo(cx, cy + R * 1.1);
        s.stroke();
        s.font = `${Math.round(R * 1.3)}px AntonioBold`;
        s.textAlign = 'center';
        s.textBaseline = 'middle';
        s.fillStyle = rgba(COLD, 1);
        s.fillText(String(digit), cx, cy + 8);
      });
    } else {
      const Sz = 470;
      this.projQ.push((s) => {
        s.globalAlpha = a * (0.78 + 0.22 * rnd(k, 'ff')) * smooth(play, play + 0.15, t);
        s.drawImage(this.coverSepia, cx - Sz / 2 + (rnd(k, 'fx') - 0.5) * 4, cy - Sz / 2 + (rnd(k, 'fy') - 0.5) * 4, Sz, Sz);
        s.fillStyle = 'rgba(255,240,210,0.7)';
        for (let i = 0; i < 4; i++) if (rnd(k, i, 'fs') < 0.5) s.fillRect(cx - Sz / 2 + rnd(k, i, 'fsx') * Sz, cy - Sz / 2, 1.4, Sz);
        for (let i = 0; i < 6; i++) if (rnd(k, i, 'fd') < 0.4) s.fillRect(cx - Sz / 2 + rnd(k, i, 'fdx') * Sz, cy - Sz / 2 + rnd(k, i, 'fdy') * Sz, 3, 3);
      });
    }
  }

  // ------------------------------------------------------------------------------ chorus 2
  burn(t, t0, t1) {
    // the paper starts burning in from the edges
    const p = smooth(t0, t1, t);
    const out = 1 - smooth(t1 - 0.05, t1 + 0.35, t);
    if (out <= 0) return;
    const depth = 16 + 74 * p;
    const pts = [];
    const per = 2 * (SC.w + SC.h);
    const flick = 0.12 * noise1(t * 6, 3);
    for (let d = 0; d < per; d += 22) {
      const n = 0.55 + 0.85 * (0.5 + 0.5 * noise1(d * 0.012, 7)) + flick;
      const off = depth * n;
      let x;
      let y;
      if (d < SC.w) [x, y] = [SC.x0 + d, SC.y0 + off];
      else if (d < SC.w + SC.h) [x, y] = [SC.x1 - off, SC.y0 + (d - SC.w)];
      else if (d < 2 * SC.w + SC.h) [x, y] = [SC.x1 - (d - SC.w - SC.h), SC.y1 - off];
      else [x, y] = [SC.x0 + off, SC.y1 - (d - 2 * SC.w - SC.h)];
      pts.push([x, y]);
    }
    const path = (s) => {
      s.beginPath();
      s.rect(SC.x0 - 5, SC.y0 - 5, SC.w + 10, SC.h + 10);
      pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
      s.closePath();
    };
    this.inkQ.push((s) => {
      s.globalAlpha = out * 0.96;
      s.fillStyle = '#0d0604';
      path(s);
      s.fill('evenodd');
    });
    this.leakQ.push((s) => {
      s.globalAlpha = out * (0.75 + 0.25 * rnd(Math.floor(t * 20), 'eb'));
      s.strokeStyle = 'rgb(255,120,40)';
      s.lineWidth = 3.5;
      s.shadowColor = 'rgba(255,90,20,0.9)';
      s.shadowBlur = 18 * this.k;
      s.beginPath();
      pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
      s.closePath();
      s.stroke();
    });
  }

  chorusBeasts(t, t0, t1) {
    // two beasts this time, taking turns to bite
    const inn = ez(E.outX, (t - t0) / 0.35);
    const out = 1 - smooth(t1 - 0.1, t1 + 0.3, t);
    const b = this.au.beat(t);
    const bite = (n) => -0.05 - 0.36 * Math.exp(-b.phase * 5) * ((b.idx + n) % 2 === 0 ? 1 : 0.15);
    this.beastAt({ X: 1620, Y: 470 + Math.sin(t * 1.7) * 14, scale: 0.5, z: 0.3, jaw: bite(0), alpha: 0.48 * inn * out });
    this.beastAt({ X: 300, Y: 520 + Math.sin(t * 1.5 + 1) * 14, scale: 0.45, z: 0.34, jaw: bite(1), alpha: 0.42 * inn * out, flip: true });
  }

  // ------------------------------------------------------------------------------ gap + outro
  web(t) {
    // strings knot themselves into a net (the gap), which becomes the outro's neural network
    const L = this.L;
    const g0 = L[34].t1;
    const g1 = L[35].t0;
    const grow = smooth(g0, g1 + 0.2, t);
    const fade = 1 - smooth(L[39].t1 - 0.1, L[39].t1 + 0.4, t);
    if (fade <= 0) return;
    const { nodes, edges } = this.net;
    const b = this.au.beat(t);
    const nE = Math.floor(edges.length * grow);
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const appear = i < nE ? 1 : i === nE ? (edges.length * grow) % 1 : 0;
      if (appear <= 0) continue;
      const bx = lerp(e.a.x, e.b.x, appear);
      const by = lerp(e.a.y, e.b.y, appear);
      this.cast(0, 0.8 * fade, (c) => {
        c.lineWidth = 2.6;
        c.beginPath();
        c.moveTo(e.a.x, e.a.y);
        c.quadraticCurveTo((e.a.x + bx) / 2, (e.a.y + by) / 2 + e.sag, bx, by);
        c.stroke();
      });
      // a red signal fires along the string on the beat
      if (t >= g1 && (b.idx + e.j) % 5 === 0 && b.phase < 0.7) {
        const u = b.phase / 0.7;
        const sx = lerp(e.a.x, e.b.x, u);
        const sy = lerp(e.a.y, e.b.y, u) + e.sag * 4 * u * (1 - u) * 0.5;
        this.leakQ.push((s) => {
          s.globalAlpha = fade * (1 - u);
          s.fillStyle = 'rgb(255,70,40)';
          s.beginPath();
          s.arc(sx, sy, 6, 0, TAU);
          s.fill();
        });
      }
    }
    for (const n of nodes) {
      const vis = smooth(g0 + (n.k / nodes.length) * (g1 - g0) * 0.9, g0 + (n.k / nodes.length) * (g1 - g0) * 0.9 + 0.2, t);
      if (vis <= 0) continue;
      const pulse = n.k % 4 === b.inBar ? Math.exp(-b.phase * 4) : 0;
      this.cast(0, 0.9 * fade * vis, (c) => {
        if (n.hang) {
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(n.x, SC.y0 - 20);
          c.lineTo(n.x, n.y);
          c.stroke();
        }
        c.beginPath();
        c.arc(n.x, n.y, 7 + pulse * 6, 0, TAU);
        c.fill();
      });
    }
  }

  outroBeast(t) {
    const L = this.L;
    const inn = ez(E.outX, (t - L[37].t0) / 0.5);
    const out = 1 - smooth(L[39].t1 - 0.1, L[39].t1 + 0.3, t);
    const kick = this.au.hit(this.au.kicks, t, 10, 0.3, 0.3);
    const rise = smooth(L[37].t0, L[39].t1, t);
    this.beastAt({ X: 1560, Y: 520, scale: 0.5 + 0.08 * rise, z: 0.32, jaw: -0.06 - 0.35 * kick, alpha: (0.38 + 0.2 * rise) * inn * out });
  }

  ending(t) {
    // the opening picture returns while the bulb swings wider and wider
    const L = this.L;
    const t0 = L[39].t1;
    const u = t - t0;
    const inn = clamp(u / 0.4);
    const b = this.au.beat(t);
    const jaw = -0.05 - 0.22 * Math.exp(-b.phase * 4) * (b.idx % 2 === 0 ? 1 : 0.4);
    const z = lerp(0.4, 0.04, ez(E.outC, u / 1.0));
    this.beastAt({ X: 900, Y: 640, scale: 0.4, z, jaw, alpha: inn });
    const ca = clamp((u - 0.3) / 0.5);
    if (ca <= 0) return;
    const zc = lerp(0.35, 0, ez(E.outC, (u - 0.3) / 0.8));
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
    if (d.layout === 'bubbles') return this.drawBubbles(l, t, v);
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
    if (d.tangle) rot += Math.sin(t * 2.3 + g.i * 1.7) * 0.09 * smooth(0.3, 2.5, u);
    if (d.z && u > 0) z = Math.max(z, d.z);
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
      } else if (d.multi) {
        // the main (dim) bulb plus every strobing light throws its own shadow of the glyph
        const keep = this.lt;
        this.cast(p.blur, a * p.a * 0.62, (c) => draw(c, '#000'));
        for (const A of keep.aux) {
          if (A.I < 0.05) continue;
          this.lt = A;
          const pa = this.project(gx, gy, ps.z);
          this.cast(pa.blur, a * pa.a * 0.5 * Math.min(1, A.I), (c) => {
            c.translate(pa.x, pa.y);
            c.scale(pa.m * ps.sc, pa.m * ps.sc);
            c.font = font;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(g.ch, 0, 0);
          });
        }
        this.lt = keep;
      } else {
        this.cast(p.blur, a * p.a, (c) => draw(c, '#000'));
      }
    }
    if (seg.redact) this.redact(l, seg, t, v);
    if (kind === 'proj') this.projFrame(l, seg, t, v);
    if (kind === 'stamp') this.stamp(l, seg, t, v);
    if (seg.tear && t >= l.t0 + seg.at) {
      const fade = 1 - smooth(l.t1 - 0.2, l.t1 + 0.3, t);
      const cx = seg.x0 + seg.L.width / 2;
      for (let i = 0; i < 3; i++) this.tear(cx - 120 + i * 120, seg.y0, 560, 1.15, l.t0 + seg.at + 0.03 + i * 0.05, t, 71 + i, fade);
    }
  }

  redact(l, seg, t, v) {
    // the rulebook's victory condition gets blacked out in ink
    const tr = l.t0 + l.rows[1].segs[0].at + 0.55;
    const e = ez(E.outX, (t - tr) / 0.3);
    if (e <= 0) return;
    const w = (seg.L.width + 30) * e;
    this.paperQ.push((s) => {
      s.globalCompositeOperation = 'multiply';
      s.globalAlpha = 0.97 * (1 - v);
      s.fillStyle = INK;
      s.beginPath();
      s.moveTo(seg.x0 - 15, seg.y0 - seg.size * 0.55);
      s.lineTo(seg.x0 - 15 + w, seg.y0 - seg.size * 0.58);
      s.lineTo(seg.x0 - 15 + w, seg.y0 + seg.size * 0.55);
      s.lineTo(seg.x0 - 15, seg.y0 + seg.size * 0.6);
      s.closePath();
      s.fill();
    });
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
      const fromTop = l.d.fromTop;
      const th = fromTop ? dir * 0.18 * Math.exp(-u * 2) * Math.sin(u * 8) : dir * 1.25 * Math.exp(-u * 2.6) * Math.cos(u * (TAU / 1.25));
      const len = fromTop ? lerp(-120, 380, ez(E.outB, u / 0.42, 1.8)) : 380;
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
      const sw = 0.25 * Math.exp(-u * 2.5) * Math.sin(u * 9) + (l.d.net ? 0.06 * Math.sin(t * 2.4 + it.x) : 0);
      const y = lerp(SC.y0 - 120, it.y, drop);
      const C = it.card;
      const p = this.project(it.x, y, 0.05 + v * 0.4);
      const a = clamp(u / 0.08) * (1 - v);
      const anchorY = l.d.net ? it.y - 72 : SC.y0 - 20;
      this.cast(p.blur, a * p.a, (c) => {
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(it.x, anchorY);
        c.lineTo(p.x, p.y - (C.h / 2) * p.m);
        c.stroke();
        c.translate(p.x, p.y);
        c.rotate(sw);
        c.scale(p.m, p.m);
        c.drawImage(C.c, -C.w / 2, -C.h / 2, C.w, C.h);
      });
    }
  }


  // ===================================================================================== poster
  /** a still for the cover: the paper fills the frame, the beast on the left, the title on the right.
   *  Everything that matters stays inside the central 4:3 area (x 240..1680) and above y 930. */
  poster() {
    const keep = { ...SC };
    Object.assign(SC, { x0: 36, y0: 36, x1: W - 36, y1: H - 36 });
    Object.assign(SC, { w: SC.x1 - SC.x0, h: SC.y1 - SC.y0, cx: (SC.x0 + SC.x1) / 2, cy: (SC.y0 + SC.y1) / 2 });
    try {
      const k = this.k;
      const s = this.s;
      const tex = this.makePaper(k);
      this.lt = { x: 1210, y: 330, I: 1.08, col: WARM, R: 1450, aux: [] };
      this.tintQ = [];
      this.leakQ = [];
      this.projQ = [];
      this.inkQ = [];
      this.paperQ = [];
      s.setTransform(k, 0, 0, k, 0, 0);
      s.globalAlpha = 1;
      s.globalCompositeOperation = 'source-over';
      this.sh.setTransform(k, 0, 0, k, 0, 0);
      this.sh.clearRect(0, 0, W, H);
      for (const [, q] of this.Q) q.clearRect(0, 0, W, H);
      s.fillStyle = '#030302';
      s.fillRect(0, 0, W, H);
      s.save();
      s.beginPath();
      s.rect(SC.x0, SC.y0, SC.w, SC.h);
      s.clip();
      this.drawPaper(s);
      this.dust(7.3);
      // claw tears behind the title, light leaking through
      for (let i = 0; i < 3; i++) this.tear(1180 + i * 120, 470, 620, 1.1, -10, 0, 91 + i, 0.9);
      // the beast, mid-bite
      this.beastAt({ X: 640, Y: 625, scale: 0.4, z: 0.02, jaw: -0.2, alpha: 1 });
      // artist (shadow cut-out) and title (red cellophane): the only large text is the title
      const art = layout(s, ARTIST, 'KakuBlack', 64, { tracking: 0.35 });
      const tx = 1270;
      this.castText(art, tx, 236, 0, 0.95);
      const t1 = layout(s, 'KEDAMONO', 'AntonioBold', 164, { tracking: 0.03 });
      const t2 = layout(s, '_AYAKASHI', 'AntonioBold', 164, { tracking: 0.03 });
      for (const [Lay, y] of [[t1, 395], [t2, 585]]) {
        this.tintQ.push((c) => drawGlyphs(c, Lay, tx, y, { fill: 'rgb(214,34,22)' }));
        this.cast(20, 0.25, (c) => drawGlyphs(c, Lay, tx + 10, y + 12, { fill: '#000' }));
      }
      // a red stamp + typewriter label
      const stampL = layout(s, '中日双语歌词', 'SCBold', 44, { tracking: 0.08 });
      this.paperQ.push((c) => {
        c.globalCompositeOperation = 'multiply';
        c.translate(1112, 772);
        c.rotate(-0.07);
        c.strokeStyle = 'rgb(196,22,16)';
        c.lineWidth = 5;
        c.beginPath();
        c.roundRect(-stampL.width / 2 - 26, -42, stampL.width + 52, 84, 10);
        c.stroke();
        drawGlyphs(c, stampL, 0, 2, { fill: 'rgb(196,22,16)' });
      });
      const lv = layout(s, 'LYRIC VIDEO', 'Courier', 40, { tracking: 0.12 });
      this.castText(lv, 1432, 774, 0, 0.9);
      for (const fn of this.paperQ) {
        s.save();
        fn(s);
        s.restore();
      }
      this.compositeShadows(s);
      for (const [q, op] of [[this.tintQ, 'multiply'], [this.leakQ, 'lighter']]) {
        for (const fn of q) {
          s.save();
          s.globalCompositeOperation = op;
          fn(s);
          s.restore();
        }
      }
      s.globalCompositeOperation = 'overlay';
      s.globalAlpha = 0.55;
      s.drawImage(tex, 0, 0, W, H);
      s.globalAlpha = 1;
      s.globalCompositeOperation = 'source-over';
      s.restore();
      this.bloom(s);
      s.save();
      s.globalCompositeOperation = 'overlay';
      s.globalAlpha = 0.08;
      s.fillStyle = this.noisePat[3];
      s.fillRect(0, 0, W, H);
      s.restore();
      s.drawImage(this.vignette, 0, 0, W, H);
      return this.S;
    } finally {
      Object.assign(SC, keep);
    }
  }

  // ===================================================================================== overlay
  drawSubs(o, t) {
    const live = this.subs
      .map((l) => ({ l, a: smooth(l.t0 - 0.05, l.t0 + 0.2, t) * (1 - smooth(l.tEnd - 0.05, l.tEnd + 0.2, t)) }))
      .filter((x) => x.a > 0.01)
      .sort((p, q) => p.l.t0 - q.l.t0);
    const ys = live.length > 1 ? [948, 1008] : [980];
    const ec = smooth(this.L[39].t1 + 0.3, this.L[39].t1 + 1.0, t) * (1 - smooth(FINAL_HIT + 0.05, FINAL_HIT + 0.5, t));
    if (ec > 0.01 && !live.length) {
      o.font = '40px KakuBlack';
      const aw = o.measureText(ARTIST).width + 4 * 6;
      o.font = '44px AntonioBold';
      const tw = o.measureText(TITLE).width + 6 * 16;
      const x0 = W / 2 - (aw + 60 + tw) / 2;
      text(o, ARTIST, x0, 982, 'KakuBlack', 40, '#efe4cf', { alpha: ec, tracking: 6 });
      o.save();
      o.globalAlpha = ec;
      o.fillStyle = COL.redHot;
      o.fillRect(x0 + aw + 28, 962, 3, 40);
      o.restore();
      text(o, TITLE, x0 + aw + 60, 984, 'AntonioBold', 44, '#efe4cf', { alpha: ec, tracking: 6 });
    }
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
