// CLI: render stills or a frame range of the lyric video.
//
//   node src/render.mjs --stills 3.9,44.8 [--outdir build/stills]
//   node src/render.mjs --from 0 --to 2535 --out build/seg_00.mkv [--fps 60 --crf 17 --preset slow]
//
// Frame ranges are [from, to) in frame numbers, so several processes can render
// disjoint ranges in parallel (see scripts/render_video.sh).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATERIALS, registerFonts, loadCover, W, H } from './lib.mjs';
import { Audio } from './audio.mjs';
import { Renderer } from './scene.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mat = (f) => path.join(root, 'materials', f);
registerFonts(path.join(root, 'assets/fonts'));
const cover = await loadCover(mat(MATERIALS.cover));
const audio = new Audio(path.join(root, 'build/analysis.json'), mat(MATERIALS.audio));
const K = Number(args.scale || 1); // 1 = 1920x1080, 2 = 3840x2160
const R = new Renderer({ cover, audio, lrcText: fs.readFileSync(mat(MATERIALS.lyrics), 'utf8'), scale: K });

if (args.stills) {
  const outdir = args.outdir || path.join(root, 'build/stills');
  fs.mkdirSync(outdir, { recursive: true });
  for (const ts of String(args.stills).split(',')) {
    const t = Number(ts);
    const t0 = performance.now();
    const c = R.frame(t);
    const file = path.join(outdir, `still_${t.toFixed(2).padStart(6, '0')}.png`);
    fs.writeFileSync(file, await c.encode('png'));
    console.log(`${file}  (${(performance.now() - t0).toFixed(0)} ms)`);
  }
} else {
  const fps = Number(args.fps || 60);
  const total = Math.round(audio.duration * fps);
  const from = Number(args.from || 0);
  const to = Math.min(total, Number(args.to ?? total));
  const out = args.out || path.join(root, 'build/video.mkv');
  const ff = spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error', '-nostats',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W * K}x${H * K}`, '-framerate', String(fps), '-i', 'pipe:0',
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p',
      '-c:v', 'libx264', '-preset', String(args.preset || 'slow'), '-crf', String(args.crf || 17),
      '-profile:v', 'high', '-level:v', K > 1 ? '5.2' : '4.2', '-g', String(fps * 2), '-bf', '3',
      '-threads', String(args.threads || 2),
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
      '-an', out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise((res, rej) => ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));
  const tStart = performance.now();
  for (let f = from; f < to; f++) {
    const frame = R.frame(f / fps).data(); // data() returns a fresh copy of the pixels
    if (!ff.stdin.write(frame)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((f - from) % 240 === 0 || f === to - 1) {
      const el = (performance.now() - tStart) / 1000;
      const n = f - from + 1;
      console.log(`[${path.basename(out)}] frame ${f} (${n}/${to - from})  ${(n / el).toFixed(1)} fps  eta ${((to - f - 1) / (n / el)).toFixed(0)}s`);
    }
  }
  ff.stdin.end();
  await done;
}
