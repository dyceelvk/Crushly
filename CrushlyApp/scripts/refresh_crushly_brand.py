"""Prepare native/web brand assets from the supplied official Crushly lockup.

The source artwork has a black matte. This script removes it, preserves the
coral/pink mark and off-white supplied wordmark, then creates the app icon
family Expo expects. Run after replacing `assets/brand/source-logo.png`.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets' / 'brand' / 'source-logo.png'
BRAND = ROOT / 'assets' / 'brand'
ASSETS = ROOT / 'assets'
PUBLIC = ROOT / 'public' / 'brand'
PLUM = (42, 15, 43, 255)
INK = (252, 247, 248, 255)


def clean_matte(image: Image.Image) -> Image.Image:
    image = image.convert('RGBA')
    px = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = px[x, y]
            maximum = max(r, g, b)
            if maximum <= 8:
                px[x, y] = (r, g, b, 0)
            elif maximum < 26:
                px[x, y] = (r, g, b, int((maximum - 8) / 18 * 255))
    return image


def padded(image: Image.Image, margin: int = 24) -> Image.Image:
    alpha = image.getchannel('A')
    bbox = alpha.getbbox()
    if not bbox:
        raise ValueError('The supplied logo has no visible pixels.')
    cropped = image.crop(bbox)
    output = Image.new('RGBA', (cropped.width + margin * 2, cropped.height + margin * 2), (0, 0, 0, 0))
    output.alpha_composite(cropped, (margin, margin))
    return output


def recolour_word(image: Image.Image) -> Image.Image:
    """Keep the official coral/pink mark; make just the pale word readable on light UI."""
    out = image.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            # The mark contains strong coral/pink. Only its pale near-neutral lettering is recoloured.
            if a and r > 210 and g > 205 and b > 205 and max(r, g, b) - min(r, g, b) < 30:
                px[x, y] = PLUM[:3] + (a,)
    return out


def cover_mark(mark: Image.Image, size: int, scale: float = .74) -> Image.Image:
    out = Image.new('RGBA', (size, size), PLUM)
    target = int(size * scale)
    ratio = target / max(mark.width, mark.height)
    art = mark.resize((round(mark.width * ratio), round(mark.height * ratio)), Image.Resampling.LANCZOS)
    out.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2 + round(size * .015)))
    return out


def foreground_mark(mark: Image.Image, size: int) -> Image.Image:
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    target = int(size * .66)
    ratio = target / max(mark.width, mark.height)
    art = mark.resize((round(mark.width * ratio), round(mark.height * ratio)), Image.Resampling.LANCZOS)
    out.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2 + round(size * .015)))
    return out


def monochrome_mark(mark: Image.Image, size: int) -> Image.Image:
    rgba = foreground_mark(mark, size)
    alpha = rgba.getchannel('A')
    solid = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    solid.putalpha(alpha)
    return solid


def main() -> None:
    BRAND.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    logo = padded(clean_matte(Image.open(SOURCE)), 24)

    # Source coordinates: the supplied circle mark ends well before x=400;
    # split on that whitespace rather than trying to reconstruct the typography.
    content_box = logo.getchannel('A').getbbox()
    lockup = logo
    mark = padded(logo.crop((0, 0, min(400, logo.width), logo.height)), 16)
    word = padded(logo.crop((400, 0, logo.width, logo.height)), 16)
    word_light = recolour_word(word)

    lockup.save(BRAND / 'crushly-lockup-light.png')
    mark.save(BRAND / 'crushly-mark.png')
    word.save(BRAND / 'crushly-word-light.png')
    word_light.save(BRAND / 'crushly-word-plum.png')
    mark.save(PUBLIC / 'crushly-mark.png')

    # Expo/launcher/icon family
    icon = cover_mark(mark, 1024)
    icon.convert('RGB').save(ASSETS / 'icon.png')
    icon.resize((128, 128), Image.Resampling.LANCZOS).save(ASSETS / 'favicon.png')
    Image.new('RGB', (1024, 1024), PLUM[:3]).save(ASSETS / 'android-icon-background.png')
    foreground_mark(mark, 1024).save(ASSETS / 'android-icon-foreground.png')
    monochrome_mark(mark, 1024).save(ASSETS / 'android-icon-monochrome.png')

    # Native splash source: a full official lockup on the official plum canvas.
    splash = Image.new('RGBA', (1408, 768), PLUM)
    target_w = 720
    ratio = target_w / lockup.width
    artwork = lockup.resize((target_w, round(lockup.height * ratio)), Image.Resampling.LANCZOS)
    splash.alpha_composite(artwork, ((splash.width - artwork.width) // 2, (splash.height - artwork.height) // 2))
    splash.convert('RGB').save(ASSETS / 'splash-icon.png')

if __name__ == '__main__':
    main()
