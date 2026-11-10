// LRC parsing + the per-line animation direction.
import { COL } from './lib.mjs';
import { SPB, BEAT0 } from './audio.mjs';

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
/** time of beat n relative to a line starting at t0 */
const beatAt = (n, t0) => BEAT0 + n * SPB - t0;

// ------------------------------------------------------------------------------------------
// Direction per line. Row segments use code-point ranges [a,b) into the original line.
//   enter: rise | drop | slam | decode | flip | type | zoom | scatter | sideL | sideR
//   exit : up | fade | scatter | glitch | drop | cut | stretch
//   at   : segment start (s, relative to the line start); default = proportional estimate
//   fx   : per segment idle effect: glitch | wobble | march | stamp | jitter | shake | pulse | redact
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
  { ...VERSE1, enter: 'decode', rows: [[{ r: [0, 7] }], [{ r: [7, 20] }]], y: 400, rowGap: 140, motif: { kind: 'tunnel' } },
  // 2 mirror
  { ...VERSE1, enter: 'flip', size: 104, rows: [[{ r: [0, 4] }, { r: [4, 11] }, { r: [11, 16], fill: COL.redHot }]], y: 400, cnGap: 300, motif: { kind: 'mirror' } },
  // 3 slam
  { ...VERSE1, enter: 'slam', size: 150, stagger: 0.03, exit: 'scatter', y: 470, accent: { glyphs: [5], fill: COL.redHot }, impact: { amp: 16, flash: 0.55, invert: 0.05 }, bg: 'red' },
  // 4 unstable identity
  { ...VERSE1, enter: 'decode', fx: 'jitter', y: 470, rgb: 7 },
  // 5 / 6 parallel pair
  { ...VERSE1, y: 360, hold: true, holdDy: 30, cnGap: 92 },
  { ...VERSE1, y: 610, exit: 'scatter', cnGap: 92 },
  // 7 the stop line that cannot be crossed
  { ...VERSE1, enter: 'drop', size: 110, y: 470, cnGap: 165, motif: { kind: 'redline' } },
  // 8-10 break
  { ...BREAK1, y: 470 },
  { ...BREAK1, y: 470, echo: true },
  { ...HATE, font: 'Bebas', size: 250, fill: COL.redHot, y: 470, exit: 'cut', exitDur: 0.08, impact: { amp: 22, flash: 0.7, flashCol: COL.red } },
  // 11 pre-chorus: down the emergency stairs (rings = glyph range [a, b) of the second phrase)
  { ...PRE, layout: 'stairs', motif: { kind: 'stairs' }, rings: [5, 9] },
  // 12 no side: the two phrases crash in from both sides
  { ...PRE, layout: 'sides', rows: [[{ r: [0, 6], at: 0 }, { r: [6, 10] }]], size: 120, y: 470 },
  // 13 chorus: vocal pickup over the stop, band (and the second phrase) back in on beat 105
  {
    ...CHORUS,
    rows: [[{ r: [0, 3], at: 0 }, { r: [3, 7], at: beatAt(105, 43.72) }], [{ r: [7, 11], at: 2.56, size: 230, fill: COL.redHot, impact: { amp: 20, flash: 0.45 } }]],
    y: 360,
    rowGap: 200,
    impact: { amp: 18, flash: 0.6, at: beatAt(105, 43.72), invert: 0.05 },
    motif: { kind: 'claw', seg: [1, 0] },
  },
  {
    ...CHORUS,
    rows: [[{ r: [0, 4] }, { r: [4, 11], font: 'Dot', fill: COL.redHot, fx: 'glitch', size: 128 }, { r: [11, 13] }], [{ r: [13, 16], at: 2.1, size: 150, impact: { amp: 14, flash: 0.3 } }]],
    y: 380,
    rowGap: 190,
    rgb: 9,
  },
  {
    ...CHORUS,
    rows: [[{ r: [0, 4] }, { r: [4, 10], at: 0.75, font: 'Dot', size: 124, fx: 'shake' }], [{ r: [10, 14], at: 2.3 }, { r: [14, 17], at: 2.75, fx: 'stamp' }, { r: [17, 18], at: 3.0 }]],
    y: 380,
    rowGap: 200,
  },
  { ...CHORUS, rows: [[{ r: [0, 6], at: 0 }, { r: [6, 11], at: B2 }]], y: 450, size: 128, perSegImpact: 10 },
  { ...CHORUS, layout: 'network', words: [[0, 3], [4, 7], [8, 11], [12, 16]], wordAt: [0, B2, 2 * B2, 3 * B2], exit: 'glitch', exitDur: 0.35, size: 108 },
  // 18 verse 2 (paper)
  { ...VERSE2, rows: [[{ r: [0, 4], fx: 'redact' }, { r: [4, 10] }], [{ r: [10, 22] }]], y: 400, rowGap: 140, motif: { kind: 'mission' } },
  // 19 / 20 the doubled question, then a short "なあ" while it hangs on screen
  { ...VERSE2, enter: 'zoom', fx: 'wobble', rows: [[{ r: [0, 10] }], [{ r: [10, 19] }]], y: 330, rowGap: 132, hold: true, holdDy: 24, motif: { kind: 'question' } },
  { ...VERSE2, enter: 'slam', fx: 'wobble', size: 190, fill: COL.red, y: 770, cnGap: 150, impact: { amp: 10, flash: 0.2, flashCol: COL.red } },
  { ...VERSE2, enter: 'rise', rows: [[{ r: [0, 12] }], [{ r: [12, 19], fx: 'march' }]], y: 400, rowGap: 140, motif: { kind: 'footsteps' } },
  { ...VERSE2, enter: 'slam', fx: 'jitter', y: 380, hold: true, holdDy: 0, motif: { kind: 'brackets' }, cnGap: 92 },
  { ...VERSE2, enter: 'slam', fx: 'jitter', y: 620, cnGap: 92 },
  // 24 / 25 I hate me. (one phrase per line: echoes + beat pulse, scrolling wall behind)
  { ...HATE, size: 260, y: 470, echo: true, echoGap: 170, fx: 'pulse', impact: { amp: 12, flash: 0.25 }, motif: { kind: 'hate', level: 0 } },
  { ...HATE, size: 280, fill: COL.redHot, y: 470, echo: true, echoGap: 170, fx: 'pulse', impact: { amp: 16, flash: 0.35, flashCol: COL.red }, motif: { kind: 'hate', level: 1 }, exit: 'cut', exitDur: 0.06 },
  // 26 / 27 pre-chorus 2 (red)
  { ...PRE, fill: COL.white, layout: 'stairs', motif: { kind: 'stairs' }, rings: [5, 9] },
  { ...PRE, layout: 'sides', vertical: true, rows: [[{ r: [0, 6], at: 0 }, { r: [6, 10] }]], size: 120, y: 470 },
  // 28-30 bridge
  // 28 uncancellable noise: decodes out of static, keeps trembling (TV static + failing CANCEL dialog in the bg)
  { ...BRIDGE, font: 'Dot', size: 118, enter: 'decode', stagger: 0.05, fx: 'shake', y: 400 },
  { ...BRIDGE, font: 'KakuBlack', size: 100, rows: [[{ r: [0, 12] }], [{ r: [12, 16], at: 2.1 }]], y: 400, rowGap: 140, motif: { kind: 'rules' } },
  // 30 a tape rewinding to "あの時" (VHS OSD + tracking noise in the bg), plays from there
  {
    ...BRIDGE,
    rows: [[{ r: [0, 16] }], [{ r: [16, 19], at: 3.0, size: 150, fill: COL.redHot, impact: { amp: 12, flash: 0.5 } }]],
    y: 380,
    rowGap: 190,
    exit: 'glitch',
    exitDur: 0.25,
  },
  // 31-34 chorus 2
  {
    ...CHORUS,
    rows: [[{ r: [0, 3], at: 0 }, { r: [3, 7], at: 1.0 }], [{ r: [7, 11], at: 2.5, size: 230, fill: COL.redHot, impact: { amp: 20, flash: 0.45 } }]],
    y: 360,
    rowGap: 200,
    impact: { amp: 16, flash: 0.5, invert: 0.05 },
    motif: { kind: 'claw', seg: [1, 0] },
  },
  {
    ...CHORUS,
    rows: [[{ r: [0, 4] }, { r: [4, 11], font: 'Dot', fill: COL.redHot, fx: 'glitch', size: 128 }, { r: [11, 13] }], [{ r: [13, 16], at: 2.1, size: 150, impact: { amp: 14, flash: 0.3 } }]],
    y: 380,
    rowGap: 190,
    rgb: 10,
  },
  {
    ...CHORUS,
    rows: [[{ r: [0, 4] }, { r: [4, 10], at: 0.75, font: 'Dot', size: 124, fx: 'shake' }], [{ r: [10, 14], at: 2.3 }, { r: [14, 17], at: 2.75, fx: 'stamp' }, { r: [17, 18], at: 3.0 }]],
    y: 380,
    rowGap: 200,
  },
  {
    ...CHORUS,
    rows: [[{ r: [0, 6], at: 0 }, { r: [6, 12], at: B2 }], [{ r: [12, 16], at: 2 * B2, fill: COL.redHot }, { r: [16, 20], at: 3 * B2, fill: COL.redHot }]],
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
