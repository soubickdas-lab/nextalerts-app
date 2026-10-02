# Draws the NextAlerts app icon (violet tile, white N) and writes every size each platform needs.
# Run: python icons/make_icons.py   (from the repo root)
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024


def tile(size=S, radius=0.22, pad=0.0, bg=True):
    """pad = empty margin around the tile (fraction); radius = corner radius (fraction of the tile)."""
    big = size * 4
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    a, b = int(big * pad), int(big * (1 - pad))
    w = b - a
    if bg:
        grad = Image.new('RGBA', (big, big))
        gd = ImageDraw.Draw(grad)
        for y in range(big):
            t = y / big
            gd.line([(0, y), (big, y)], fill=(int(124 - 34 * t), int(108 - 34 * t), int(255 - 25 * t), 255))
        mask = Image.new('L', (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([a, a, b, b], radius=int(w * radius), fill=255)
        im.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(im)
    # the N: up the left, down the diagonal, up the right
    u = w / 32
    pts = [(a + 9.5 * u, a + 22.5 * u), (a + 9.5 * u, a + 9.5 * u), (a + 22.5 * u, a + 22.5 * u), (a + 22.5 * u, a + 9.5 * u)]
    sw = int(3.1 * u)
    d.line(pts, fill='white', width=sw, joint='curve')
    for x, y in pts:
        d.ellipse([x - sw / 2, y - sw / 2, x + sw / 2, y + sw / 2], fill='white')
    return im.resize((size, size), Image.LANCZOS)


def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)


# desktop (Electron)
save(tile(1024), f'{ROOT}/desktop/icon-1024.png')
save(tile(512), f'{ROOT}/desktop/icon.png')
tile(256).save(f'{ROOT}/desktop/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# Android launcher icons (legacy square-ish + round) and the adaptive foreground
for name, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    save(tile(px, radius=0.24, pad=0.04), f'{ROOT}/android/app/src/main/res/mipmap-{name}/ic_launcher.png')
    save(tile(px, radius=0.5, pad=0.04), f'{ROOT}/android/app/src/main/res/mipmap-{name}/ic_launcher_round.png')
    save(tile(int(px * 108 / 48), pad=0.25, bg=False), f'{ROOT}/android/app/src/main/res/mipmap-{name}/ic_launcher_foreground.png')

# iOS: one opaque 1024 square (no transparency, no rounded corners — iOS rounds it)
flat = Image.new('RGB', (1024, 1024))
flat.paste(tile(1024, radius=0.0).convert('RGB'))
save(flat, f'{ROOT}/ios/NextAlerts/Assets.xcassets/AppIcon.appiconset/icon-1024.png')

# website (home-screen app on phones)
web = f'{ROOT}/../nextalerts-hq/public'
if os.path.isdir(web):
    for px in (192, 512):
        save(tile(px), f'{web}/icon-{px}.png')
    m = Image.new('RGB', (512, 512)); m.paste(tile(512, radius=0.0, pad=0.0).convert('RGB')); save(m, f'{web}/icon-maskable.png')
    a = Image.new('RGB', (180, 180)); a.paste(tile(180, radius=0.0).convert('RGB')); save(a, f'{web}/apple-touch-icon.png')
print('icons written')
