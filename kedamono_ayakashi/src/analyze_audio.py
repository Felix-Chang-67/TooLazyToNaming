"""Offline audio analysis for the lyric video renderer.

Produces build/analysis.json with per-video-frame features (loudness, band energies,
transient envelopes, a log-frequency spectrum) and event lists (beats, downbeats, kicks,
snares). Everything the renderer needs is precomputed here so that any frame can be
rendered independently (and therefore in parallel).

usage: python3 -I src/analyze_audio.py materials/song.wav build/analysis.json [fps]
"""
import json
import sys

import librosa
import numpy as np
import soundfile as sf

wav_path, out_path = sys.argv[1], sys.argv[2]
FPS = int(sys.argv[3]) if len(sys.argv) > 3 else 60
SR = 400 * FPS  # analysis sample rate -> hop of 400 samples == exactly one video frame
HOP = SR // FPS
N_FFT = 2048

data, sr0 = sf.read(wav_path, dtype="float32", always_2d=True)
duration = data.shape[0] / sr0
mono = data.mean(axis=1)
y = librosa.resample(mono, orig_sr=sr0, target_sr=SR, res_type="soxr_hq")
n_frames = int(round(duration * FPS))


def fit(a):
    """Pad / trim a per-frame array to exactly n_frames."""
    a = np.asarray(a, dtype=np.float64)
    if len(a) >= n_frames:
        return a[:n_frames]
    return np.pad(a, (0, n_frames - len(a)), mode="edge")


def norm(a, pct=99.0):
    hi = np.percentile(a, pct)
    return np.clip(a / (hi + 1e-12), 0.0, 1.0)


def smooth_ar(a, attack, release):
    """One-pole attack/release follower (coefficients per frame, 0..1)."""
    out = np.empty_like(a)
    v = 0.0
    for i, x in enumerate(a):
        k = attack if x > v else release
        v += (x - v) * k
        out[i] = v
    return out


S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP, center=True))
freqs = librosa.fft_frequencies(sr=SR, n_fft=N_FFT)


def band(lo, hi):
    idx = (freqs >= lo) & (freqs < hi)
    return fit(np.sqrt((S[idx] ** 2).mean(axis=0)))


rms = norm(fit(librosa.feature.rms(y=y, frame_length=N_FFT, hop_length=HOP)[0]))
low = norm(band(25, 140))
mid = norm(band(140, 2000))
high = norm(band(2000, 11000))

# transient envelopes: positive spectral flux restricted to bands
logS = np.log1p(S * 10)
flux = np.maximum(0, np.diff(logS, axis=1, prepend=logS[:, :1]))


def band_flux(lo, hi):
    idx = (freqs >= lo) & (freqs < hi)
    return norm(fit(flux[idx].mean(axis=0)), 99.5)


low_flux = band_flux(30, 160)
snare_flux = band_flux(1500, 8000)
onset = norm(fit(librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)), 99.5)

# beat tracking
tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=SR, hop_length=HOP, tightness=120)
tempo = float(np.atleast_1d(tempo)[0])
beats = [float(f) / FPS for f in beat_frames]


def peaks(env, delta, wait_s):
    p = librosa.util.peak_pick(env, pre_max=3, post_max=3, pre_avg=12, post_avg=6, delta=delta, wait=int(wait_s * FPS))
    return [{"t": round(float(i) / FPS, 4), "s": round(float(env[i]), 3)} for i in p]


kicks = peaks(low_flux, 0.12, 0.12)
snares = peaks(snare_flux, 0.12, 0.12)

# downbeat phase: which of the 4 beat phases carries the most low-end transients
bf = np.array(beat_frames, dtype=int)
bf = bf[bf < n_frames]
scores = [float(low_flux[bf[p::4]].mean()) if len(bf[p::4]) else 0 for p in range(4)]
phase = int(np.argmax(scores))
downbeats = [float(f) / FPS for f in bf[phase::4]]

# log-frequency spectrum for visualisers (48 bands, 0..1, smoothed)
mel = librosa.feature.melspectrogram(S=S**2, sr=SR, n_mels=48, fmin=30, fmax=11000)
mel_db = librosa.power_to_db(mel, ref=np.max)
spec = np.clip((mel_db + 72.0) / 66.0, 0, 1)  # (48, frames)
spec = np.stack([smooth_ar(fit(b), 0.85, 0.18) for b in spec], axis=1)  # (frames, 48)

result = {
    "fps": FPS,
    "duration": duration,
    "frames": n_frames,
    "tempo": tempo,
    "beats": [round(b, 4) for b in beats],
    "downbeats": [round(b, 4) for b in downbeats],
    "downbeat_phase_scores": scores,
    "kicks": kicks,
    "snares": snares,
    "rms": [round(float(v), 3) for v in smooth_ar(rms, 0.6, 0.12)],
    "low": [round(float(v), 3) for v in smooth_ar(low, 0.7, 0.15)],
    "mid": [round(float(v), 3) for v in smooth_ar(mid, 0.6, 0.12)],
    "high": [round(float(v), 3) for v in smooth_ar(high, 0.7, 0.2)],
    "lowFlux": [round(float(v), 3) for v in low_flux],
    "onset": [round(float(v), 3) for v in onset],
    "spec": [[int(round(v * 255)) for v in row] for row in spec],
}
with open(out_path, "w") as f:
    json.dump(result, f, separators=(",", ":"))

print(f"duration={duration:.3f}s frames={n_frames} tempo={tempo:.2f} beats={len(beats)} "
      f"kicks={len(kicks)} snares={len(snares)} downbeat_phase={phase} scores={np.round(scores, 3)}")
