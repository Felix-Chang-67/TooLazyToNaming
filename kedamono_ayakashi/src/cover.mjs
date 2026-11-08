// Video cover / thumbnail that works both as 16:9 and as a centred 4:3 crop.
//
//   node src/cover.mjs [outdir]   ->  cover_16x9.jpg / cover_16x9.png / cover_4x3.jpg
//
// Everything that matters (album art, title, labels) sits inside the central 4:3 safe area
// (x 240..1680) and above the bottom band where video sites overlay duration / play counts.
// The two side strips only carry background (silhouette, light, embers, marquee).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerFonts, loadCover, W, H, COL, canvas, layout, drawGlyphs, text, rr, rnd } from './lib.mjs';
import { Audio } from './audio.mjs';
import { Renderer } from './scene.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] || path.join(root, 'output');
const mat = (f) => path.join(root, 'materials', f);
registerFonts(path.join(root, 'assets/fonts'));
const cover = await loadCover(mat('KEDAMONO_AYAKASHI-Cover.jpg'));
const audio = new Audio(path.join(root, 'build/analysis.json'), mat('KEDAMONO_AYAKASHI_96kHz_PCM32.wav'));
const R = new Renderer({ cover, audio, lrcText: fs.readFileSync(mat('KEDAMONO_AYAKASHI.lrc'), 'utf8') });

const SAFE_X0 = (W - (H * 4) / 3) / 2; // 240
const SAFE_X1 = W - SAFE_X0; // 1680
const T = 46.4; // a chorus instant: drives the spectrum / ember snapshot

const [c, s] = canvas();

// ---------------------------------------------------------------- background (full 16:9 bleed)
s.fillStyle = COL.black;
s.fillRect(0, 0, W, H);
R.cover(s, cover.red, 1180, 1190, 1450);
R.dim(s, 0.5);
s.save();
s.globalCompositeOperation = 'lighter';
const glow = s.createRadialGradient(1380, 420, 0, 1380, 420, 900);
glow.addColorStop(0, 'rgba(255,50,35,0.45)');
glow.addColorStop(1, 'rgba(255,50,35,0)');
s.fillStyle = glow;
s.fillRect(0, 0, W, H);
s.restore();
R.rays(s, 3.3, 560, 470, 0.045);
R.marquee(s, 12.0, 0.1);
R.embers(s, T, 1);
R.spectrum(s, T, 0.75);

// claw marks behind the title
s.save();
s.globalAlpha = 0.7;
for (let i = 0; i < 3; i++) {
  const ox = 1250 + (i - 1) * 120;
  R.slash(s, ox - 220, 690, ox + 210, 150, 34, 1, i === 1 ? COL.redHot : COL.red);
}
s.restore();

// glitch bands only on the background, so the title stays crisp
{
  const [snap, sn] = canvas();
  sn.drawImage(c, 0, 0);
  for (let i = 0; i < 6; i++) {
    const y = Math.floor(rr(110, 980, 'cvy', i));
    const h = Math.floor(rr(4, 26, 'cvh', i));
    const dx = Math.round(rr(-70, 70, 'cvx', i));
    s.drawImage(snap, 0, y, W, h, dx, y, W, h);
    if (rnd('cvi', i) < 0.4) {
      s.save();
      s.globalCompositeOperation = 'difference';
      s.fillStyle = i % 2 ? '#ffffff' : COL.red;
      s.globalAlpha = 0.6;
      s.fillRect(rr(0, W * 0.6, 'cvr', i), y, rr(120, 600, 'cvw', i), h);
      s.restore();
    }
  }
}

// ---------------------------------------------------------------- album art card (left of centre)
R.card(s, 0, 560, { x: 580, y: 470, rot: -0.05, img: cover.small });

// ---------------------------------------------------------------- title block (right of centre)
const tx = 930;
const maxW = SAFE_X1 - 40 - tx;
const shadow = (on) => {
  s.shadowColor = on ? 'rgba(0,0,0,0.9)' : 'transparent';
  s.shadowBlur = on ? 26 : 0;
  s.shadowOffsetY = on ? 6 : 0;
};
const fit = (str, font, size) => {
  let L = layout(s, str, font, size, { tracking: 0.02 });
  if (L.width > maxW) L = layout(s, str, font, Math.floor((size * maxW) / L.width), { tracking: 0.02 });
  return L;
};
// the only large text is the song title; the block is centred on the album art (y = 470)
shadow(true);
const l1 = fit('KEDAMONO', 'AntonioBold', 196);
const l2 = fit('_AYAKASHI', 'AntonioBold', 196);
const y1 = 330;
const y2 = y1 + l1.size * 0.98;
drawGlyphs(s, l1, tx, y1, { align: 'left', fill: COL.white });
drawGlyphs(s, l2, tx, y2, { align: 'left', fill: COL.redHot });
shadow(false);

// labels
const ly = y2 + l2.size * 0.5 + 72;
s.font = '40px SCBold';
const tag = '中日双语歌词';
const tagW = s.measureText(tag).width + 44;
s.fillStyle = COL.redHot;
s.fillRect(tx + 4, ly - 30, tagW, 60);
text(s, tag, tx + 26, ly + 1, 'SCBold', 40, '#ffffff');
text(s, 'LYRIC VIDEO', tx + tagW + 28, ly + 2, 'Mono', 30, COL.white, { tracking: 6 });

// HUD details inside the safe area
text(s, '■ KEDAMONO_AYAKASHI', SAFE_X0 + 40, 70, 'Mono', 22, 'rgba(244,240,232,0.75)', { tracking: 4 });
text(s, '141 BPM  ▪ 96kHz / 32bit', SAFE_X1 - 40, 70, 'Mono', 22, 'rgba(244,240,232,0.75)', { align: 'right', tracking: 4 });
s.save();
s.strokeStyle = 'rgba(244,240,232,0.55)';
s.lineWidth = 3;
const cb = 38;
for (const [x, y, dx, dy] of [
  [SAFE_X0 + 24, 104, 1, 1],
  [SAFE_X1 - 24, 104, -1, 1],
  [SAFE_X0 + 24, 930, 1, -1],
  [SAFE_X1 - 24, 930, -1, -1],
]) {
  s.beginPath();
  s.moveTo(x, y + dy * cb);
  s.lineTo(x, y);
  s.lineTo(x + dx * cb, y);
  s.stroke();
}
s.restore();

// ---------------------------------------------------------------- finishing: grain, vignette, scanlines
s.save();
s.globalCompositeOperation = 'overlay';
s.globalAlpha = 0.1;
s.fillStyle = R.noisePat[3];
s.fillRect(0, 0, W, H);
s.restore();
s.drawImage(R.vignette, 0, 0);
s.globalAlpha = 0.2;
s.drawImage(R.scan, 0, 0);
s.globalAlpha = 1;

// ---------------------------------------------------------------- export
fs.mkdirSync(outdir, { recursive: true });
fs.writeFileSync(path.join(outdir, 'cover_16x9.png'), await c.encode('png'));
fs.writeFileSync(path.join(outdir, 'cover_16x9.jpg'), await c.encode('jpeg', 95));
const [c43, x43] = canvas((H * 4) / 3, H);
x43.drawImage(c, SAFE_X0, 0, (H * 4) / 3, H, 0, 0, (H * 4) / 3, H);
fs.writeFileSync(path.join(outdir, 'cover_4x3.jpg'), await c43.encode('jpeg', 95));
console.log(`wrote cover_16x9.{png,jpg} (1920x1080) and cover_4x3.jpg (1440x1080) to ${outdir}`);
