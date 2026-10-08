# Draws the NextAlerts app icon (teal tile, the word "Next Alerts" with a spark) and writes every size each
# platform needs.  Run: python icons/make_icons.py   (from the repo root)
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024
FONT = next((f for f in [r'C:\Windows\Fonts\segoeuib.ttf', r'C:\Windows\Fonts\arialbd.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if os.path.exists(f)), None)


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
            gd.line([(0, y), (big, y)], fill=(int(28 - 14 * t), int(170 - 42 * t), int(158 - 36 * t), 255))
        mask = Image.new('L', (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([a, a, b, b], radius=int(w * radius), fill=255)
        im.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(im)
    # the word on two lines, a spark above it
    f1 = ImageFont.truetype(FONT, int(w * 0.26)) if FONT else ImageFont.load_default()
    cx = a + w / 2
    for i, (txt, col) in enumerate([('Next', (255, 255, 255, 255)), ('Alerts', (190, 245, 235, 255))]):
        bb = d.textbbox((0, 0), txt, font=f1)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        d.text((cx - tw / 2 - bb[0], a + w * (0.36 + 0.25 * i) - bb[1]), txt, font=f1, fill=col)
    # spark
    import math
    sc, sy, r1, r2 = cx, a + w * 0.22, w * 0.075, w * 0.03
    pts = []
    for k in range(10):
        ang = -math.pi / 2 + k * math.pi / 5
        rr = r1 if k % 2 == 0 else r2
        pts.append((sc + rr * math.cos(ang), sy + rr * math.sin(ang)))
    d.polygon(pts, fill=(255, 214, 92, 255))
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

# website (home-screen app on phones + favicon)
web = f'{ROOT}/../nextalerts-hq/public'
if os.path.isdir(web):
    for px in (192, 512):
        save(tile(px), f'{web}/icon-{px}.png')
    m = Image.new('RGB', (512, 512)); m.paste(tile(512, radius=0.0, pad=0.0).convert('RGB')); save(m, f'{web}/icon-maskable.png')
    a = Image.new('RGB', (180, 180)); a.paste(tile(180, radius=0.0).convert('RGB')); save(a, f'{web}/apple-touch-icon.png')
print('icons written')
