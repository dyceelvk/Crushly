#!/usr/bin/env python3
"""Six candidate alert sounds for holUpp, so the member picks the one they hear.

Everything is synthesised from sine partials — no samples, no licensing. Each
candidate is a deliberate direction, not a volume variation on the first one:

  1 lumen   warm marimba, two notes rising          friendly, human, soft
  2 glass   FM bell with a shimmer                  bright, premium, iOS-ish
  3 pulse   muted pluck, low then a high tick        modern minimal, "tech"
  4 bloom   airy three-note pad swell                calm, ambient
  5 drip    short water-drop glide                   playful, small
  6 orbit   detuned two-tone synth                   confident, sci-fi edge

Rules shared by all of them: under a second, mono 44.1 kHz 16-bit, peak 0.6 so
it is a nudge and not an alarm, 4 ms fades so neither end clicks, and a decay
that is finished by the end of the file so nothing is cut off.
"""
from __future__ import annotations

import math
import pathlib
import wave

import numpy as np

SR = 44100
OUT = pathlib.Path(__file__).resolve().parents[2] / 'sound-options'


def env(n: int, attack: float, decay: float, curve: float = 3.0) -> np.ndarray:
    """Attack then exponential decay, in samples. Short attack = a strike."""
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    d = np.exp(-curve * np.maximum(t - attack, 0) / max(decay, 1e-4))
    return a * d


def note(freq: float, dur: float, attack: float = 0.004, decay: float = 0.25,
         curve: float = 3.0) -> np.ndarray:
    n = int(SR * dur)
    t = np.arange(n) / SR
    return np.sin(2 * math.pi * freq * t) * env(n, attack, decay, curve)


def add(base: np.ndarray, *parts: np.ndarray, at: float) -> np.ndarray:
    """Mix one or more voices in at the same offset, zero-padded to the longest."""
    part = np.sum(np.array([np.pad(p, (0, max(map(len, parts)) - len(p)))
                            for p in parts], dtype=float), axis=0)
    i = int(SR * at)
    need = i + len(part)
    if need > len(base):
        base = np.concatenate([base, np.zeros(need - len(base))])
    base[i:i + len(part)] += part
    return base


def finish(x: np.ndarray, peak: float = 0.6) -> np.ndarray:
    # 4 ms at each end: a hard start reads as a click on a phone speaker.
    f = int(SR * 0.004)
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    m = np.max(np.abs(x)) or 1.0
    return np.clip(x * (peak / m), -1, 1)


# ------------------------------------------------------------------ candidates

def lumen() -> np.ndarray:
    """Warm marimba, a rising third. Wood and air, not a beep."""
    x = np.zeros(int(SR * 0.62))
    for freq, at, amp in ((1046.5, 0.0, 1.0), (1568.0, 0.13, 0.85)):
        body = note(freq, 0.45, 0.003, 0.16, 2.6)
        # A struck bar has a partial at 4x, quiet and gone almost at once.
        strike = note(freq * 4, 0.12, 0.001, 0.03, 4.0) * 0.18
        x = add(x, body * amp, strike * amp, at=at)
    return finish(x)


def glass() -> np.ndarray:
    """FM bell: an inharmonic shimmer that settles into one clear note."""
    dur = 0.75
    n = int(SR * dur)
    t = np.arange(n) / SR
    carrier = 1318.5
    index = 2.6 * np.exp(-9 * t)          # brightness dies fast, note stays
    mod = np.sin(2 * math.pi * carrier * 3.5 * t) * index
    x = np.sin(2 * math.pi * carrier * t + mod)
    x += 0.12 * np.sin(2 * math.pi * carrier * 2.0 * t) * np.exp(-14 * t)
    return finish(x * env(n, 0.002, 0.34, 3.2))


def pulse() -> np.ndarray:
    """Muted pluck falling, then one high tick. Modern, dry, no ring."""
    n = int(SR * 0.5)
    t = np.arange(n) / SR
    # A falling gliss on the first 60 ms is what makes this read as a UI sound.
    f = 900 * np.exp(-8 * t) + 520
    phase = 2 * math.pi * np.cumsum(f) / SR
    x = np.sin(phase) * env(n, 0.001, 0.09, 4.0)
    x += 0.1 * np.sin(phase * 2) * env(n, 0.001, 0.05, 5.0)
    tick = note(1800, 0.09, 0.0005, 0.02, 5.0) * 0.35
    x = add(x, tick, at=0.085)
    return finish(x)


def bloom() -> np.ndarray:
    """An airy swell: three partials arriving together, then breathing out."""
    n = int(SR * 0.85)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for freq, amp in ((523.25, 1.0), (784.0, 0.7), (1046.5, 0.45)):
        # A touch of vibrato keeps it from sounding like a test tone.
        vib = 1 + 0.0025 * np.sin(2 * math.pi * 5.5 * t)
        x += amp * np.sin(2 * math.pi * freq * vib * t)
    return finish(x * env(n, 0.04, 0.4, 2.4))


def drip() -> np.ndarray:
    """A water drop: a fast glide up, gone before it is a note."""
    n = int(SR * 0.45)
    t = np.arange(n) / SR
    f = 380 + 1500 * (1 - np.exp(-18 * t))
    x = np.sin(2 * math.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.05, 4.5)
    x = add(x, note(1500, 0.2, 0.001, 0.04, 4.5) * 0.3, at=0.11)
    return finish(x)


def orbit() -> np.ndarray:
    """Two detuned tones, soft-clipped: bright without being harsh."""
    x = np.zeros(int(SR * 0.65))
    for freq, at in ((1174.7, 0.0), (1760.0, 0.1)):
        n = int(SR * 0.4)
        t = np.arange(n) / SR
        tone = (np.sin(2 * math.pi * freq * t)
                + 0.5 * np.sin(2 * math.pi * freq * 1.005 * t)
                + 0.25 * np.sin(2 * math.pi * freq * 2 * t))
        tone = np.tanh(tone * 1.4) * env(n, 0.006, 0.14, 3.4)
        x = add(x, tone * 0.8, at=at)
    return finish(x)


CANDIDATES = {'lumen': lumen, 'glass': glass, 'pulse': pulse,
              'bloom': bloom, 'drip': drip, 'orbit': orbit}


def write_wav(path: pathlib.Path, x: np.ndarray) -> tuple[int, float]:
    data = np.round(x * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    return path.stat().st_size, len(x) / SR


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, make in CANDIDATES.items():
        path = OUT / f'{name}.wav'
        size, secs = write_wav(path, make())
        print(f'{name:6s} {secs:0.2f}s {size:>7,} B  {path}')


if __name__ == '__main__':
    main()
