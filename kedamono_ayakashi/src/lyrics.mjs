// LRC parsing + the per-line animation direction.
import { COL } from './lib.mjs';
import { SPB } from './audio.mjs';

/**
 * Parses an LRC where a translated line repeats the timestamp of its original:
 *   [mm:ss.xx]original
 *   [mm:ss.xx]translation
 * Lines without a translation (here: the English ones) are allowed. An empty entry marks
 * the end of the previous line (instrumental gap).
 */
export function parseLrc(src) {
  const rows = [];
  for (const raw of src.split(/\r?\n/)) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) rows.push({ t: Number(m[1]) * 60 + Number(m[2]), s: m[3].trim() });
  }
  const groups = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.t - r.t) < 1e-6) g.items.push(r.s);
    else groups.push({ t: r.t, items: [r.s] });
  }
  const lines = [];
  groups.forEach((g, k) => {
    if (!g.items[0]) return;
    const next = groups[k + 1];
    lines.push({
      t0: g.t,
      t1: next ? next.t : g.t + 4,
      jp: g.items[0],
      cn: g.items[1] || '',
      en: !/[぀-ヿ一-鿿]/.test(g.items[0]),
    });
  });
  // typographic quotes for the Chinese lines (a quote may open on one line and close on the next)
  let open = false;
  for (const l of lines) {
    l.cn = l.cn.replace(/"/g, () => ((open = !open) ? '“' : '”'));
  }
  return lines.map((l, i) => ({ ...l, i }));
}

const B2 = 2 * SPB; // chanted words land every two beats

// ------------------------------------------------------------------------------------------
// Direction per line. Row segments use code-point ranges [a,b) into the original line.
//   enter: rise | drop | slam | decode | flip | type | zoom | scatter | sideL | sideR
//   exit : up | fade | scatter | glitch | drop | cut | stretch
//   at   : segment start (s, relative to the line start); default = proportional estimate
//   fx   : per segment idle effect: glitch | wobble | march | stamp | jitter | outline
// ------------------------------------------------------------------------------------------
const VERSE1 = { font: 'Mincho', size: 100, fill: COL.white, enter: 'rise', exit: 'up', stagger: 0.045, cnFont: 'SC', cnSize: 40 };
const BREAK1 = { font: 'Antonio', size: 150, tracking: 0.1, fill: COL.white, enter: 'type', exit: 'glitch', stagger: 0.075, cnFont: 'SC' };
const PRE = { font: 'KakuBlack', size: 104, fill: COL.white, enter: 'drop', exit: 'scatter', stagger: 0.05, cnFont: 'SCBold', cnSize: 42 };
const CHORUS = { font: 'Dela', size: 118, fill: COL.white, enter: 'slam', exit: 'scatter', stagger: 0.035, cnFont: 'SCBold', cnSize: 44, rgb: 4 };
const VERSE2 = { font: 'KakuBlack', size: 104, fill: '#111', enter: 'decode', exit: 'glitch', stagger: 0.04, cnFont: 'SCBold', cnSize: 40, cnFill: '#1d1b19' };
const HATE = { font: 'Bebas', size: 190, tracking: 0.04, fill: COL.white, enter: 'slam', exit: 'glitch', stagger: 0.02 };
const BRIDGE = { font: 'Mincho', size: 104, fill: COL.white, enter: 'rise', exit: 'glitch', stagger: 0.05, cnFont: 'SerifSC', cnSize: 42 };
const OUTRO = { font: 'Dela', size: 120, fill: COL.white, enter: 'zoom', exit: 'scatter', stagger: 0.03, cnFont: 'SCBold', cnSize: 44 };

export const DIRECTION = [
  // 0 ---- verse 1 (stacked phrases, scratch marks appear with the "wound")
  { ...VERSE1, layout: 'rows', rows: [[{ r: [0, 13] }], [{ r: [14, 25] }]], y: 400, rowGap: 140, motif: { kind: 'scratch', glyph: 20 } },
  // 1 endless corridor
  { ...VERSE1, enter: 'decode', rows: [[{ r: [0, 7] }], [{ r: [8, 21] }]], y: 400, rowGap: 140, motif: { kind: 'tunnel' } },
  // 2 mirror
  { ...VERSE1, enter: 'flip', size: 104, rows: [[{ r: [0, 3] }, { r: [4, 9] }, { r: [10, 15], fill: COL.redHot }]], y: 400, cnGap: 300, motif: { kind: 'mirror' } },
  // 3 slam
  { ...VERSE1, enter: 'slam', size: 150, stagger: 0.03, exit: 'scatter', y: 470, accent: { glyphs: [5], fill: COL.redHot }, impact: { amp: 16, flash: 0.55, invert: 0.05 }, bg: 'red' },
  // 4 unstable identity
  { ...VERSE1, enter: 'decode', fx: 'jitter', y: 470, rgb: 7 },
  // 5 / 6 parallel pair
  { ...VERSE1, y: 360, hold: true, holdDy: 30, cnGap: 92 },
  { ...VERSE1, y: 610, exit: 'scatter', cnGap: 92 },
  // 7 the line that cannot be crossed
  { ...VERSE1, enter: 'drop', size: 110, y: 470, cnGap: 165, motif: { kind: 'redline' } },
  // 8-10 break
  { ...BREAK1, y: 470 },
  { ...BREAK1, y: 470, echo: true },
  { ...HATE, font: 'Bebas', size: 250, fill: COL.redHot, y: 470, exit: 'cut', exitDur: 0.08, impact: { amp: 22, flash: 0.7, flashCol: COL.red } },
  // 11 pre-chorus: down the emergency stairs
  { ...PRE, layout: 'stairs', motif: { kind: 'stairs' }, rings: [5, 8] },
  // 12 no side: from both sides
  { ...PRE, layout: 'sides', size: 120, y: 470 },
  // 13 chorus
  {
    ...CHORUS,
    rows: [[{ r: [0, 4], at: 0 }, { r: [4, 8], at: 1.01 }], [{ r: [8, 12], at: 2.5, size: 230, fill: COL.redHot, impact: { amp: 20, flash: 0.45 } }]],
    y: 360,
    rowGap: 200,
    impact: { amp: 18, flash: 0.6, at: 1.01, invert: 0.05 },
    motif: { kind: 'claw', seg: [1, 0] },
  },
  {
    ...CHORUS,
    rows: [[{ r: [0, 4] }, { r: [4, 10], font: 'Dot', fill: COL.redHot, fx: 'glitch', size: 128 }], [{ r: [11, 16], at: 2.1, size: 150, impact: { amp: 14, flash: 0.3 } }]],
    y: 380,
    rowGap: 190,
    rgb: 9,
  },
  {
    ...CHORUS,
    rows: [[{ r: [0, 3] }, { r: [4, 11], at: 0.75 }], [{ r: [12, 16], at: 2.3 }, { r: [16, 19], at: 2.75, fx: 'stamp' }, { r: [19, 20], at: 3.0 }]],
    y: 380,
    rowGap: 200,
  },
  { ...CHORUS, rows: [[{ r: [0, 5], at: 0 }, { r: [6, 11], at: B2 }, { r: [12, 15], at: 2 * B2, fill: COL.redHot }]], y: 450, size: 124, perSegImpact: 10 },
  { ...CHORUS, layout: 'network', words: [[0, 3], [4, 7], [8, 12]], wordAt: [0, B2, 2 * B2], exit: 'glitch', exitDur: 0.35, size: 112 },
  // 18 verse 2 (paper)
  { ...VERSE2, rows: [[{ r: [0, 4], fx: 'redact' }, { r: [4, 10] }], [{ r: [11, 23] }]], y: 400, rowGap: 140, motif: { kind: 'mission' } },
  { ...VERSE2, enter: 'zoom', fx: 'wobble', y: 380, hold: true, holdDy: 20, motif: { kind: 'question' }, cnGap: 92 },
  { ...VERSE2, enter: 'zoom', fx: 'wobble', y: 620, cnGap: 92, size: 112 },
  { ...VERSE2, enter: 'rise', rows: [[{ r: [0, 12] }], [{ r: [13, 20], fx: 'march' }]], y: 400, rowGap: 140, motif: { kind: 'footsteps' } },
  { ...VERSE2, enter: 'slam', fx: 'jitter', y: 380, hold: true, holdDy: 0, motif: { kind: 'brackets' }, cnGap: 92 },
  { ...VERSE2, enter: 'slam', fx: 'jitter', y: 620, cnGap: 92 },
  // 24 / 25 I hate me
  { ...HATE, layout: 'rows', rows: [[{ r: [0, 10], at: 0 }], [{ r: [11, 21], at: B2 }], [{ r: [22, 31], at: 2 * B2 }]], y: 300, rowGap: 210, perSegImpact: 8, motif: { kind: 'hate', level: 0 } },
  { ...HATE, fill: COL.redHot, layout: 'rows', rows: [[{ r: [0, 10], at: 0 }], [{ r: [11, 21], at: B2 }], [{ r: [22, 31], at: 2 * B2 }]], y: 300, rowGap: 210, perSegImpact: 12, motif: { kind: 'hate', level: 1 }, exit: 'cut', exitDur: 0.06 },
  // 26 / 27 pre-chorus 2 (red)
  { ...PRE, fill: COL.white, layout: 'stairs', motif: { kind: 'stairs' }, rings: [5, 8] },
  { ...PRE, layout: 'sides', vertical: true, size: 120, y: 470 },
  // 28-30 bridge
  { ...BRIDGE, font: 'Dot', size: 120, enter: 'type', stagger: 0.09, motif: { kind: 'start' }, y: 440 },
  { ...BRIDGE, font: 'KakuBlack', size: 100, rows: [[{ r: [0, 12] }], [{ r: [12, 16], at: 2.1 }]], y: 400, rowGap: 140, motif: { kind: 'rules' } },
  {
    ...BRIDGE,
    rows: [[{ r: [0, 10] }], [{ r: [10, 15], at: 2.4, size: 150, fill: COL.redHot, impact: { amp: 12, flash: 0.5, flashCol: COL.red } }]],
    y: 380,
    rowGap: 190,
    motif: { kind: 'ecg' },
    exit: 'glitch',
    exitDur: 0.25,
  },
  // 31-34 chorus 2
  {
    ...CHORUS,
    rows: [[{ r: [0, 4], at: 0 }, { r: [4, 8], at: 1.0 }], [{ r: [8, 12], at: 2.45, size: 230, fill: COL.redHot, impact: { amp: 20, flash: 0.45 } }]],
    y: 360,
    rowGap: 200,
    impact: { amp: 16, flash: 0.5, invert: 0.05 },
    motif: { kind: 'claw', seg: [1, 0] },
  },
  {
    ...CHORUS,
    rows: [[{ r: [0, 4] }, { r: [4, 10], font: 'Dot', fill: COL.redHot, fx: 'glitch', size: 128 }], [{ r: [11, 16], at: 2.1, size: 150, impact: { amp: 14, flash: 0.3 } }]],
    y: 380,
    rowGap: 190,
    rgb: 10,
  },
  {
    ...CHORUS,
    rows: [[{ r: [0, 3] }, { r: [4, 11], at: 0.75 }], [{ r: [12, 16], at: 2.3 }, { r: [16, 19], at: 2.75, fx: 'stamp' }, { r: [19, 20], at: 3.0 }]],
    y: 380,
    rowGap: 200,
  },
  {
    ...CHORUS,
    rows: [[{ r: [0, 5], at: 0 }, { r: [6, 11], at: B2 }], [{ r: [12, 15], at: 2 * B2, fill: COL.redHot }, { r: [16, 20], at: 3 * B2, fill: COL.redHot }]],
    y: 380,
    rowGap: 200,
    size: 130,
    perSegImpact: 11,
    exit: 'glitch',
  },
  // 35-39 outro: the network of brain cells
  { ...OUTRO, layout: 'network', words: [[0, 3], [4, 7], [8, 11], [12, 15]], wordAt: [0, B2, 2 * B2, 3 * B2], size: 96, exit: 'fade', exitDur: 0.4 },
  { ...OUTRO, layout: 'network', words: [[0, 3], [4, 7], [8, 11], [12, 16]], wordAt: [0, B2, 2 * B2, 3 * B2], size: 104, exit: 'scatter', exitDur: 0.5 },
  { ...OUTRO, rows: [[{ r: [0, 3], at: 0 }, { r: [4, 8], at: B2, fill: COL.redHot }]], y: 450, size: 150, perSegImpact: 12 },
  { ...OUTRO, rows: [[{ r: [0, 3], at: 0 }, { r: [4, 8], at: B2, fill: COL.redHot }]], y: 450, size: 160, perSegImpact: 14, rgb: 6 },
  { ...OUTRO, rows: [[{ r: [0, 3], at: 0 }, { r: [4, 8], at: B2, fill: COL.redHot }]], y: 450, size: 170, perSegImpact: 16, rgb: 8, exit: 'glitch', exitDur: 0.3 },
];
