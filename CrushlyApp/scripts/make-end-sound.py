#!/usr/bin/env python3
"""The one second the end card opens on: a drop, and a voice saying the name.

The brief, in the owner's words: *a drop sound and a hazy sound that goes
"holup", very non-realistic and slightly understood, hazy, bassy, very deep, one
second, clear, no reverb, no delay.*

No reverb and no delay is the hard part — a deep voice sounds like a bathroom
unless it is dry, and dryness is a thing you get by removing the space, not by
adding it. So: a formant read of `hoh-lup`, pitched down to roughly half speed,
low-passed until the consonants are suggested rather than spoken, driven into
soft saturation for the bass, and a sub sine underneath to give it a floor. No
tail, nothing after the envelope closes.

The drop in front of it is a falling sine with a fast decay — the sound of a
stone into water — plus a low thump so it lands on a phone speaker too.

    make-end-sound.py [--out assets/share/holup-end-sound.wav]

Needs `espeak-ng` for the voice. The generated WAV is committed, so a build that
does not have espeak still produces the same card.
"""
from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SHARE = HERE.parent / "assets/share"
RATE = 48000

VOICE_RATE = 15600     # espeak's output, resampled down to RATE later: that
                       # resample is the pitch drop, and it is why the words come
                       # out at about half speed
PITCH = 0.52           # ~-11 semitones. Deeper than this stops being a word.
WORD = "hoh lup"


def read_wav(path: Path) -> np.ndarray:
    import wave

    with wave.open(str(path)) as handle:
        raw = handle.readframes(handle.getnframes())
        rate = handle.getframerate()
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    if rate != VOICE_RATE:
        samples = resample(samples, rate, VOICE_RATE)
    return samples


def resample(samples: np.ndarray, rate_from: int, rate_to: int) -> np.ndarray:
    """Linear resample — good enough for a voice this dark."""
    count = int(round(len(samples) * rate_to / rate_from))
    source = np.linspace(0, len(samples) - 1, count)
    return np.interp(source, np.arange(len(samples)), samples)


def lowpass(samples: np.ndarray, cutoff: float, order: int = 4) -> np.ndarray:
    from scipy.signal import butter, sosfilt

    sos = butter(order, cutoff / (RATE / 2), btype="low", output="sos")
    return sosfilt(sos, samples)


def bandpass(samples: np.ndarray, low: float, high: float, order: int = 2) -> np.ndarray:
    from scipy.signal import butter, sosfilt

    sos = butter(order, [low / (RATE / 2), high / (RATE / 2)], btype="band", output="sos")
    return sosfilt(sos, samples)


def envelope(length: int, attack: float, release: float) -> np.ndarray:
    """A dry envelope: straight in, straight out, nothing after it."""
    env = np.ones(length)
    a = max(1, int(attack * RATE))
    r = max(1, int(release * RATE))
    env[:a] = np.linspace(0, 1, a) ** 0.6
    env[-r:] = np.linspace(1, 0, r) ** 2.2
    return env


def speak() -> np.ndarray:
    """Say the name once, slowly and low, with no space around it."""
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "word.wav"
        subprocess.run(
            ["espeak-ng", "-v", "en-us", "-s", "92", "-p", "18", "-a", "180",
             "-w", str(target), WORD],
            check=True, capture_output=True,
        )
        voice = read_wav(target)

    voice = voice / (np.max(np.abs(voice)) + 1e-9)
    voice = lowpass(voice, 900, order=4)          # the consonants go first
    voice = np.tanh(voice * 2.6) * 0.75           # soft saturation = the bass
    return voice


def the_drop() -> np.ndarray:
    """A stone into water, then the thump behind it."""
    length = int(0.55 * RATE)
    t = np.arange(length) / RATE

    sweep = 1150 * np.exp(-t / 0.055) + 190      # falls fast, then settles
    phase = 2 * np.pi * np.cumsum(sweep) / RATE
    splash = np.sin(phase) * np.exp(-t / 0.09)

    thump = np.sin(2 * np.pi * 62 * t) * np.exp(-t / 0.16) * 0.85
    body = lowpass(splash, 3000, order=2) * 0.55 + thump
    return np.tanh(body * 1.8) * 0.9


def build() -> np.ndarray:
    drop = the_drop()
    voice = speak()
    voice = voice * envelope(len(voice), 0.012, 0.24)

    total = 1.0
    out = np.zeros(int(total * RATE))
    out[: len(drop)] += drop * 0.85
    start = int(0.10 * RATE)
    end = min(len(out), start + len(voice))
    out[start:end] += voice[: end - start] * 0.95

    # A sub sine under the whole second, so it is felt on a phone speaker that
    # cannot reproduce anything below the voice. It is not a musical note: it is
    # 52 Hz with a slow fall, mixed low enough to be a floor rather than a tone.
    t = np.arange(len(out)) / RATE
    sub = np.sin(2 * np.pi * (52 - 6 * t / total) * t) * np.exp(-t / 0.5) * 0.22
    out += sub

    out = np.tanh(out * 1.25)
    out *= 0.89 / (np.max(np.abs(out)) + 1e-9)
    return out


def write(path: Path, samples: np.ndarray) -> None:
    import wave

    stereo = np.stack([samples, samples], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(pcm.tobytes())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=SHARE / "holup-end-sound.wav")
    args = parser.parse_args()
    samples = build()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    write(args.out, samples)
    print(f"{args.out.name}: {len(samples) / RATE:.2f}s, {args.out.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
