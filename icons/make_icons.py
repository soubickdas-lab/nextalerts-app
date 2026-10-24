# The NextAlerts mark, quiet version: a charcoal tile, one thin geometric "N" drawn as a single stroke, and a small
# lime dot at the top right — the alert. Nothing else. Writes every size each platform needs.
# Run: python icons/make_icons.py   (from the repo root)
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024
INK = (20, 20, 22, 255)
PAPER = (255, 255, 255, 255)
LIME = (228, 245, 92, 255)


def mark(size=S, radius=0.22, pad=0.0, bg=True, invert=False):
    """pad = empty margin around the tile (fraction); radius = corner radius (fraction of the tile)."""
    big = size * 4
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    a, b = int(big * pad), int(big * (1 - pad))
    w = b - a
    d = ImageDraw.Draw(im)
    tile, stroke = (PAPER, INK) if invert else (INK, PAPER)
    if bg:
        d.rounded_rectangle([a, a, b, b], radius=int(w * radius), fill=tile)
    u = w / 100
    sw = 7.5 * u
    # the N: left leg up, one diagonal, right leg up — slightly condensed, centred a touch left to leave room for the dot
    x0, x1 = a + 30 * u, a + 62 * u
    top, bot = a + 28 * u, a + 72 * u
    pts = [(x0, bot), (x0, top), (x1, bot), (x1, top)]
    d.line(pts, fill=stroke, width=int(sw), joint='curve')
    for (x, y) in pts:
        d.ellipse([x - sw / 2, y - sw / 2, x + sw / 2, y + sw / 2], fill=stroke)
    # the alert dot
    r = 6.5 * u
    cx, cy = a + 74 * u, a + 28 * u
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=LIME)
    return im.resize((size, size), Image.LANCZOS)


def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)


# desktop (Electron)
save(mark(1024), f'{ROOT}/desktop/icon-1024.png')
save(mark(512), f'{ROOT}/desktop/icon.png')
mark(256).save(f'{ROOT}/desktop/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# Mac menu bar: a template image — black on transparent, macOS tints it for light/dark menu bars
def tray_template(px):
    big = px * 8
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    u = big / 100; sw = 11 * u
    x0, x1, top, bot = 18 * u, 62 * u, 20 * u, 80 * u
    pts = [(x0, bot), (x0, top), (x1, bot), (x1, top)]
    d.line(pts, fill=(0, 0, 0, 255), width=int(sw), joint='curve')
    for (x, y) in pts: d.ellipse([x - sw / 2, y - sw / 2, x + sw / 2, y + sw / 2], fill=(0, 0, 0, 255))
    r = 10 * u; d.ellipse([80 * u - r, 20 * u - r, 80 * u + r, 20 * u + r], fill=(0, 0, 0, 255))
    return im.resize((px, px), Image.LANCZOS)
save(tray_template(18), f'{ROOT}/desktop/trayTemplate.png')
save(tray_template(36), f'{ROOT}/desktop/trayTemplate@2x.png')

# Android launcher icons (legacy square-ish + round) and the adaptive foreground
for name, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    save(mark(px, radius=0.24, pad=0.04), f'{ROOT}/android/app/src/main/res/mipmap-{name}/ic_launcher.png')
    save(mark(px, radius=0.5, pad=0.04), f'{ROOT}/android/app/src/main/res/mipmap-{name}/ic_launcher_round.png')
    save(mark(int(px * 108 / 48), pad=0.25, bg=False), f'{ROOT}/android/app/src/main/res/mipmap-{name}/ic_launcher_foreground.png')

# iOS: one opaque 1024 square (no transparency, no rounded corners — iOS rounds it)
flat = Image.new('RGB', (1024, 1024))
flat.paste(mark(1024, radius=0.0).convert('RGB'))
save(flat, f'{ROOT}/ios/NextAlerts/Assets.xcassets/AppIcon.appiconset/icon-1024.png')

# website (home-screen app on phones + favicon) and the mark the dashboard shows beside the name
web = f'{ROOT}/../nextalerts-hq/public'
if os.path.isdir(web):
    for px in (192, 512):
        save(mark(px), f'{web}/icon-{px}.png')
    m = Image.new('RGB', (512, 512)); m.paste(mark(512, radius=0.0, pad=0.0).convert('RGB')); save(m, f'{web}/icon-maskable.png')
    ap = Image.new('RGB', (180, 180)); ap.paste(mark(180, radius=0.0).convert('RGB')); save(ap, f'{web}/apple-touch-icon.png')
    save(mark(128), f'{web}/mark.png')
print('icons written')
