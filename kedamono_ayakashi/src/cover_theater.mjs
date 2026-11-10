// Cover for the 影絵劇場 version: 1920x1080 (16:9) + a centred 1440x1080 (4:3) crop.
// Rendered at 2x and downsampled for clean edges.
//   node src/cover_theater.mjs [outdir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATERIALS, registerFonts, loadCover, W, H, canvas } from './lib.mjs';
import { Audio } from './audio.mjs';
import { Theater } from './theater.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] || path.join(root, 'output');
const mat = (f) => path.join(root, 'materials', f);
registerFonts(path.join(root, 'assets/fonts'));
const cover = await loadCover(mat(MATERIALS.cover));
const audio = new Audio(path.join(root, 'build/analysis.json'), mat(MATERIALS.audio));
const lrcText = fs.readFileSync(mat(MATERIALS.lyrics), 'utf8');
const R = await Theater.create({ cover, audio, lrcText, scale: 2, derivedDir: path.join(root, 'assets/derived') });
const big = R.poster();

const [c, x] = canvas(W, H);
x.drawImage(big, 0, 0, W, H);
const w43 = (H * 4) / 3;
const [c43, x43] = canvas(w43, H);
x43.drawImage(big, ((W - w43) / 2) * 2, 0, w43 * 2, H * 2, 0, 0, w43, H);
fs.mkdirSync(outdir, { recursive: true });
fs.writeFileSync(path.join(outdir, 'cover_16x9.png'), await c.encode('png'));
fs.writeFileSync(path.join(outdir, 'cover_16x9.jpg'), await c.encode('jpeg', 95));
fs.writeFileSync(path.join(outdir, 'cover_4x3.jpg'), await c43.encode('jpeg', 95));
console.log(`wrote cover_16x9.{png,jpg} (1920x1080) and cover_4x3.jpg (1440x1080) to ${outdir}`);
