// Shared helpers: math / easing / deterministic randomness, asset loading, glyph layout.
import path from 'node:path';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

export const W = 1920;
export const H = 1080;

export const COL = {
  red: '#c41e17', // the cover's title red (sampled ~#aa1b13), lifted a little for video
  redHot: '#ff3b2f',
  redDeep: '#5c0a07',
  white: '#f4f0e8',
  black: '#050505',
  grey: '#8d8780',
};

// ---------------------------------------------------------------- math
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, x) => clamp((x - a) / (b - a));
export const smooth = (a, b, x) => {
  const t = inv(a, b, x);
  return t * t * (3 - 2 * t);
};
export const E = {
  lin: (t) => t,
  inQ: (t) => t * t,
  outQ: (t) => 1 - (1 - t) * (1 - t),
  inC: (t) => t * t * t,
  outC: (t) => 1 - (1 - t) ** 3,
  ioC: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQu: (t) => 1 - (1 - t) ** 5,
  outX: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inX: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  ioX: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  outB: (t, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
  outEl: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};
/** ease with clamped input */
export const ez = (f, t, ...a) => f(clamp(t), ...a);

// ------------------------------------------------- deterministic randomness
function mix32(x) {
  x |= 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
export function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** uniform [0,1) from any list of integers / strings — same inputs, same output, on every worker */
export function rnd(...a) {
  let h = 0x2545f491;
  for (const v of a) h = mix32(h ^ mix32((typeof v === 'string' ? strHash(v) : Math.floor(v)) + 0x9e3779b9));
  return h / 4294967296;
}
export const rr = (lo, hi, ...a) => lo + (hi - lo) * rnd(...a);
/** smooth 1-D value noise in [-1,1] */
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(rnd(i, seed), rnd(i + 1, seed), u) * 2 - 1;
}

// ------------------------------------------------------------------ canvas
export function canvas(w = W, h = H) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

export const FONTS = {
  Mincho: 'ShipporiMinchoB1-ExtraBold.ttf',
  Dela: 'DelaGothicOne-Regular.ttf',
  KakuBlack: 'ZenKakuGothicNew-Black.ttf',
  Dot: 'DotGothic16-Regular.ttf',
  SC: 'NotoSansSC-Medium.ttf',
  SCBold: 'NotoSansSC-Bold.ttf',
  SerifSC: 'NotoSerifSC-Black.ttf',
  Antonio: 'Antonio-Light.ttf',
  AntonioBold: 'Antonio-Bold.ttf',
  Bebas: 'BebasNeue-Regular.ttf',
  Mono: 'ShareTechMono-Regular.ttf',
};

export function registerFonts(dir) {
  for (const [alias, file] of Object.entries(FONTS)) GlobalFonts.registerFromPath(path.join(dir, file), alias);
}

/** Loads the cover and prepares processed variants (all derived once, up front). */
export async function loadCover(file) {
  const img = await loadImage(file);
  const N = img.width;
  const [base, bctx] = canvas(N, N);
  bctx.drawImage(img, 0, 0);
  const src = bctx.getImageData(0, 0, N, N);

  const variant = (fn) => {
    const [c, x] = canvas(N, N);
    const out = x.createImageData(N, N);
    const s = src.data;
    const d = out.data;
    for (let i = 0; i < s.length; i += 4) {
      const [r, g, b] = fn(s[i], s[i + 1], s[i + 2]);
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
    x.putImageData(out, 0, 0);
    return c;
  };
  const isTitle = (r, g, b) => r > 110 && g < 90 && b < 90;
  // white light -> red, silhouette stays black
  const red = variant((r, g, b) => {
    if (isTitle(r, g, b)) return [12, 2, 2];
    const l = (r + g + b) / 765;
    return [Math.round(30 + 196 * l), Math.round(4 + 26 * l), Math.round(2 + 20 * l)];
  });
  // negative: black light, white silhouette (title kept red)
  const neg = variant((r, g, b) => (isTitle(r, g, b) ? [r, g, b] : [255 - r, 255 - g, 255 - b]));
  // paper: light background, dark silhouette, title removed (for the brighter verse 2)
  const paper = variant((r, g, b) => {
    const l = isTitle(r, g, b) ? 0 : (r + g + b) / 765;
    const v = 1 - l;
    return [Math.round(40 + 204 * v), Math.round(38 + 202 * v), Math.round(36 + 196 * v)];
  });
  // title-less plain black/white version (the lyrics carry the text)
  const plain = variant((r, g, b) => (isTitle(r, g, b) ? [8, 8, 8] : [r, g, b]));

  const scaled = (srcCanvas, size) => {
    const [c, x] = canvas(size, size);
    x.drawImage(srcCanvas, 0, 0, size, size);
    return c;
  };
  const [blur, blx] = canvas(480, 480);
  blx.filter = 'blur(10px)';
  blx.drawImage(base, -40, -40, 560, 560);
  blx.filter = 'none';

  return {
    size: N,
    img: base,
    red,
    neg,
    paper,
    plain,
    small: scaled(base, 1024),
    paperSmall: scaled(paper, 1024),
    tiny: scaled(base, 720),
    blur,
  };
}

export function makeNoiseTiles(count = 8, size = 384, seed = 7) {
  const tiles = [];
  for (let k = 0; k < count; k++) {
    const [c, x] = canvas(size, size);
    const id = x.createImageData(size, size);
    for (let i = 0, p = 0; i < size * size; i++, p += 4) {
      const v = Math.floor(rnd(seed, k, i) * 256);
      id.data[p] = v;
      id.data[p + 1] = v;
      id.data[p + 2] = v;
      id.data[p + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    tiles.push(c);
  }
  return tiles;
}

export function makeVignette() {
  const [c, x] = canvas();
  const g = x.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0.85)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  return c;
}

export function makeScanlines() {
  const [c, x] = canvas();
  x.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < H; y += 4) x.fillRect(0, y, W, 2);
  return c;
}

// ------------------------------------------------------------- glyph layout
const measureCache = new Map();
function measure(ctx, font, size, ch) {
  const k = `${font}|${ch}`;
  let w = measureCache.get(k);
  if (w === undefined) {
    ctx.font = `100px ${font}`;
    w = ctx.measureText(ch).width / 100;
    measureCache.set(k, w);
  }
  return w * size;
}

/**
 * Lays a string out glyph by glyph (horizontal).  Spaces become a gap of `space` em.
 * Returns { glyphs:[{ch,x,w,i,word}], width, size, font }.
 */
export function layout(ctx, text, font, size, { tracking = 0, space = 0.5 } = {}) {
  const glyphs = [];
  let x = 0;
  let word = 0;
  const chars = [...text];
  chars.forEach((ch, i) => {
    if (ch === ' ') {
      x += size * space;
      word++;
      return;
    }
    const w = measure(ctx, font, size, ch);
    glyphs.push({ ch, x, w, i: glyphs.length, word, font });
    x += w + tracking * size;
  });
  const width = glyphs.length ? glyphs[glyphs.length - 1].x + glyphs[glyphs.length - 1].w : 0;
  return { glyphs, width, size, font, text, words: word + 1 };
}

/** Largest size <= max such that the laid out text fits into maxW. */
export function fitLayout(ctx, text, font, max, maxW, opts) {
  let L = layout(ctx, text, font, max, opts);
  if (L.width > maxW) L = layout(ctx, text, font, Math.floor((max * maxW) / L.width), opts);
  return L;
}

/**
 * Draws a laid-out block. `style(g)` may return per-glyph overrides:
 *   { dx, dy, sx, sy, rot, alpha, fill, ch, stroke, lw, skip }
 */
export function drawGlyphs(ctx, L, x, y, { align = 'center', fill = COL.white, style, alpha = 1, stroke, lw = 2 } = {}) {
  const x0 = align === 'center' ? x - L.width / 2 : align === 'right' ? x - L.width : x;
  ctx.font = `${L.size}px ${L.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const g of L.glyphs) {
    const s = style ? style(g) : null;
    if (s && (s.skip || s.alpha <= 0.002)) continue;
    const a = (s?.alpha ?? 1) * alpha;
    if (a <= 0.002) continue;
    ctx.save();
    ctx.translate(x0 + g.x + g.w / 2 + (s?.dx || 0), y + (s?.dy || 0));
    if (s?.rot) ctx.rotate(s.rot);
    if (s?.sx !== undefined || s?.sy !== undefined) ctx.scale(s.sx ?? 1, s.sy ?? 1);
    ctx.globalAlpha = a;
    const ch = s?.ch || g.ch;
    const st = s?.stroke ?? stroke;
    if (st) {
      ctx.strokeStyle = st;
      ctx.lineWidth = s?.lw ?? lw;
      ctx.lineJoin = 'round';
      ctx.strokeText(ch, 0, 0);
    }
    if ((s?.fill ?? fill) !== 'none') {
      ctx.fillStyle = s?.fill ?? fill;
      ctx.fillText(ch, 0, 0);
    }
    ctx.restore();
  }
  return x0;
}

/** Simple whole-string draw (HUD labels etc.). */
export function text(ctx, str, x, y, font, size, fill, { align = 'left', baseline = 'middle', alpha = 1, tracking = 0 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (tracking) ctx.letterSpacing = `${tracking}px`;
  ctx.fillText(str, x, y);
  ctx.restore();
}

export const SCRAMBLE = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン#%&@$*+=?!/<>■◆※';
export const SCRAMBLE_LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$*+=?!/<>';
const LATIN_FONTS = new Set(['Antonio', 'AntonioBold', 'Bebas', 'Mono']);
export const scrambleChar = (...seed) => SCRAMBLE[Math.floor(rnd(...seed) * SCRAMBLE.length)];
/** scramble glyph that exists in `font` */
export const scrambleFor = (font, ...seed) =>
  LATIN_FONTS.has(font) ? SCRAMBLE_LATIN[Math.floor(rnd(...seed) * SCRAMBLE_LATIN.length)] : scrambleChar(...seed);
