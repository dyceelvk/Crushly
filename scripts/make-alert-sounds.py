#!/usr/bin/env python3
"""
The two sounds holUpp makes, synthesised so they can be regenerated and so
nothing has to be licensed.

Design: soft, short, and in the brand's key. A message is a two-note rise (a
question answered); a notification is a single note with a shimmer on top. Both
are gentle on a phone speaker, both end before they can overlap the next one,
and neither is a klaxon — an app that shouts every thirty seconds gets muted,
and then it has no sounds at all.

    python3 scripts/make-alert-sounds.py
"""
import numpy as np
import wave

SR = 44100
OUT = "CrushlyApp/assets/sounds"


def tone(freq, seconds, gain, attack=0.004, decay=0.5, harmonics=((1, 1.0), (2, 0.28), (3, 0.10))):
    n = int(SR * seconds)
    t = np.arange(n) / SR
    wave_ = np.zeros(n)
    for mult, amp in harmonics:
        wave_ += amp * np.sin(2 * np.pi * freq * mult * t)
    env = np.ones(n)
    a = max(1, int(attack * SR))
    env[:a] = np.linspace(0, 1, a) ** 1.4
    env[a:] = np.exp(-(t[a:] - t[a]) / decay)
    return wave_ * env * gain


def save(path, samples):
    peak = np.max(np.abs(samples)) or 1.0
    samples = samples / peak * 0.62                     # headroom, no clipping
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(path, round(len(pcm.tobytes()) / 1024, 1), "KB")


def message():
    """A small rise: E5 then A5, the second note entering as the first fades."""
    dur = 0.46
    n = int(SR * dur)
    out = np.zeros(n)
    a = tone(659.25, 0.30, 1.0, decay=0.14)
    b = tone(880.00, 0.34, 0.85, decay=0.16)
    out[:len(a)] += a
    start = int(0.115 * SR)
    out[start:start + len(b)] += b[:n - start]
    # a breath of air on the second note so it reads as a chime, not a beep
    k = np.arange(n - start) / SR
    out[start:] += np.random.randn(n - start) * 0.006 * np.exp(-k * 26)
    return out


def notification():
    """One note with its octave and a slow shimmer: the sound of something else."""
    dur = 0.70
    n = int(SR * dur)
    out = np.zeros(n)
    body = tone(523.25, 0.62, 1.0, decay=0.22, harmonics=((1, 1.0), (2, 0.22), (4, 0.06)))
    out[:len(body)] += body
    echo = tone(783.99, 0.40, 0.42, decay=0.16)
    start = int(0.075 * SR)
    out[start:start + len(echo)] += echo[:n - start]
    t = np.arange(n) / SR
    out *= 1 + 0.04 * np.sin(2 * np.pi * 5.5 * t)       # a gentle tremble
    return out


if __name__ == "__main__":
    save(f"{OUT}/message.wav", message())
    save(f"{OUT}/notification.wav", notification())
