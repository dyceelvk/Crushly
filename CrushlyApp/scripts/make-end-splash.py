"""HOLUP end splash — 6 seconds, 1080x1920, the last clip on a video.

TikTok and Instagram end a clip on a branded splash, and every copy that leaves
the app carries the platform's mark burnt in. This is that splash: the mark and
the wordmark centred, the handle quiet underneath, and the address small enough
to read only if you are looking for it.

Deliberately restrained. A splash that moves is a splash people skip, and this
one has to survive being the final six seconds of a video somebody already
watched. One slow settle in, a long hold, a short fade out — nothing else.
"""
from pathlib import Path
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import imageio.v2 as imageio

W, H, FPS, SECONDS = 1080, 1920, 30, 6.0
ROOT = Path('/home/user')
LOGO = ROOT / 'uploads/file_00000000d67c82118b57d679067a5118.png'
SILENT = ROOT / 'holup-end-splash-6s-silent.mp4'
OUT = ROOT / 'holup-end-splash-6s-1080x1920.mp4'
CORAL, PINK, WHITE = (255, 135, 142), (240, 53, 180), (250, 247, 250)
DEEP = (18, 6, 16)


def clamp(x): return max(0.0, min(1.0, x))
def smooth(x): x = clamp(x); return x * x * (3 - 2 * x)
def ease(x): return 1 - (1 - clamp(x)) ** 4


# The mark and the wordmark are separate glyphs in the supplied artwork, so they
# are cropped apart and placed by hand instead of scaled as one lockup.
logo = Image.open(LOGO).convert('RGBA')
symbol = logo.crop((67, 145, 695, 528))
wordmark = logo.crop((779, 145, 2111, 528))

SYM_W = 210
symbol = symbol.resize((SYM_W, round(symbol.height * SYM_W / symbol.width)), Image.Resampling.LANCZOS)
WORD_W = 470
wordmark = wordmark.resize((WORD_W, round(wordmark.height * WORD_W / wordmark.width)), Image.Resampling.LANCZOS)

font_handle = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 34)
font_micro = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 21)

# Static plate: the background never moves, so the only thing in motion is the
# mark settling. A drift-free plate also compresses to a small file.
plate = Image.new('RGBA', (W, H), DEEP + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((W / 2 - 430, 790, W / 2 + 430, 1650), fill=PINK + (46,))
glow = glow.filter(ImageFilter.GaussianBlur(150))
plate = Image.alpha_composite(plate, glow)

d = ImageDraw.Draw(plate)
# A single hairline rule under the lockup, coral to pink, the same pair the
# other exports use.
rule_y = 1150
d.line((W / 2 - 170, rule_y, W / 2 - 20, rule_y), fill=CORAL + (210,), width=3)
d.line((W / 2 - 20, rule_y, W / 2 + 170, rule_y), fill=PINK + (210,), width=3)

writer = imageio.get_writer(str(SILENT), format='FFMPEG', fps=FPS, codec='libx264', pixelformat='yuv420p',
                            macro_block_size=1, quality=8, ffmpeg_log_level='warning')
for i in range(round(FPS * SECONDS)):
    t = i / FPS
    frame = plate.copy()

    # The lockup settles from 104% to 100% over the first 700ms. Enough to feel
    # intentional, not enough to read as an animation.
    settle = ease((t - 0.05) / 0.70)
    scale = 1.04 - 0.04 * settle
    alpha = smooth((t - 0.05) / 0.55) * (1 - smooth((t - 5.55) / 0.40))

    sym = symbol.resize((max(1, round(symbol.width * scale)), max(1, round(symbol.height * scale))),
                        Image.Resampling.LANCZOS)
    wm = wordmark.resize((max(1, round(wordmark.width * scale)), max(1, round(wordmark.height * scale))),
                         Image.Resampling.LANCZOS)
    for asset, cy in ((sym, 900), (wm, 1080)):
        a = asset.copy()
        a.putalpha(a.getchannel('A').point(lambda v: int(v * clamp(alpha))))
        frame.alpha_composite(a, (round(W / 2 - a.width / 2), round(cy - a.height / 2)))

    # Attribution is deliberately quiet: the handle and the address sit below the
    # rule, small, and share the fade with the lockup.
    fd = ImageDraw.Draw(frame)
    # No handle here, on purpose. The splash is one shared file appended to every
    # export; the creator's handle belongs on the mark, which is drawn per clip
    # from the post's author. A handle burned into a shared asset would credit
    # whoever happened to be first.
    fd.text((W / 2, 1270), 'HOLUP ORIGINAL', anchor='ma', font=font_micro,
            fill=(255, 255, 255, int(130 * alpha)))
    fd.text((W / 2, 1790), 'holupapp.vercel.app', anchor='ma', font=font_micro,
            fill=(255, 255, 255, int(88 * alpha)))

    writer.append_data(np.asarray(frame.convert('RGB')))
writer.close()

# Audio: silence, so the splash can be appended to a clip that already has a bed
# without cutting its sound.
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(SILENT),
                '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
                '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart', str(OUT)], check=True)
print('wrote', OUT, OUT.stat().st_size, 'bytes')
