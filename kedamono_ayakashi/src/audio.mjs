// Time-indexed access to the precomputed audio analysis + the raw PCM (for oscilloscopes).
import fs from 'node:fs';

export const BPM = 141; // measured: grid search of BPM x phase over the onset envelope (best: 141.00)
export const BEAT0 = 0.112; // time of beat 0 (a downbeat) in the official 24-bit / 48 kHz master
export const SPB = 60 / BPM;

export class Audio {
  constructor(analysisFile, wavFile) {
    const a = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
    this.a = a;
    this.fps = a.fps;
    this.duration = a.duration;
    this.kicks = a.kicks;
    this.snares = a.snares;
    if (wavFile) this.loadWav(wavFile);
  }

  loadWav(file) {
    const buf = fs.readFileSync(file);
    let p = 12;
    let fmt = null;
    while (p + 8 <= buf.length) {
      const id = buf.toString('ascii', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (id === 'fmt ') {
        fmt = {
          format: buf.readUInt16LE(p + 8),
          channels: buf.readUInt16LE(p + 10),
          rate: buf.readUInt32LE(p + 12),
          bits: buf.readUInt16LE(p + 22),
        };
        // WAVE_FORMAT_EXTENSIBLE: the real format tag is the first field of the sub-format GUID
        if (fmt.format === 0xfffe && size >= 40) fmt.format = buf.readUInt16LE(p + 8 + 24);
      } else if (id === 'data') {
        this.pcm = { buf, start: p + 8, size: Math.min(size, buf.length - p - 8), ...fmt };
        break;
      }
      p += 8 + size + (size & 1);
    }
    if (!this.pcm || this.pcm.format !== 1 || ![16, 24, 32].includes(this.pcm.bits)) {
      throw new Error('expected 16/24/32-bit integer PCM wav');
    }
    this.pcm.bytes = this.pcm.bits / 8;
    this.pcm.scale = 2 ** (this.pcm.bits - 1);
  }

  /** mono sample at absolute sample index, [-1,1] */
  sample(i) {
    const { buf, start, size, channels, bytes, scale } = this.pcm;
    const frame = channels * bytes;
    const off = start + i * frame;
    if (i < 0 || off + frame > start + size) return 0;
    let v = 0;
    for (let c = 0; c < channels; c++) {
      const o = off + c * bytes;
      v += bytes === 3 ? buf.readIntLE(o, 3) : bytes === 4 ? buf.readInt32LE(o) : buf.readInt16LE(o);
    }
    return v / channels / scale;
  }

  /** n points of waveform centred on t spanning `span` seconds */
  wave(t, n, span = 0.04) {
    const out = new Float32Array(n);
    if (!this.pcm) return out;
    const r = this.pcm.rate;
    const s0 = Math.round((t - span / 2) * r);
    const step = (span * r) / n;
    for (let k = 0; k < n; k++) out[k] = this.sample(Math.round(s0 + k * step));
    return out;
  }

  /** linear interpolation into a per-frame feature array */
  f(name, t) {
    const arr = this.a[name];
    const x = t * this.fps;
    const i = Math.floor(x);
    if (i < 0) return arr[0];
    if (i >= arr.length - 1) return arr[arr.length - 1];
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  }

  spec(t) {
    const i = Math.max(0, Math.min(this.a.spec.length - 1, Math.round(t * this.fps)));
    return this.a.spec[i];
  }

  /** beat grid info */
  beat(t) {
    const b = (t - BEAT0) / SPB;
    const idx = Math.floor(b);
    return { b, idx, phase: b - idx, bar: Math.floor(idx / 4), inBar: ((idx % 4) + 4) % 4 };
  }

  /** time of beat number n */
  static beatTime(n) {
    return BEAT0 + n * SPB;
  }

  /** decaying pulse after every beat (1 at the beat, -> 0) */
  pulse(t, decay = 6, every = 1) {
    const b = (t - BEAT0) / (SPB * every);
    const ph = b - Math.floor(b);
    return Math.exp(-ph * SPB * every * decay);
  }

  /** strongest decaying envelope of events (kicks/snares) within `win` seconds before t */
  hit(list, t, decay = 10, win = 0.4, minS = 0) {
    let lo = 0;
    let hi = list.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (list[m].t <= t) {
        idx = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    let best = 0;
    for (let i = idx; i >= 0 && t - list[i].t <= win; i--) {
      if (list[i].s < minS) continue;
      best = Math.max(best, list[i].s * Math.exp(-(t - list[i].t) * decay));
    }
    return best;
  }
}
