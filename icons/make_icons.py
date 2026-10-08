# The NextAlerts mark: a deep-teal tile, the letters N and A cut from one shape (the A's right leg becomes the N's
# upstroke) with a small spark where the A's crossbar would be. Writes every size each platform needs.
# Run: python icons/make_icons.py   (from the repo root)
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024
TEAL_TOP, TEAL_BOT = (26, 178, 164), (9, 110, 102)
INK = (255, 255, 255, 255)
MINT = (176, 242, 230, 255)
SPARK = (255, 209, 84, 255)


def spark(d, cx, cy, r1, r2, fill):
    pts = []
    for k in range(8):
        ang = -math.pi / 2 + k * math.pi / 4
        rr = r1 if k % 2 == 0 else r2
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    d.polygon(pts, fill=fill)


def mark(size=S, radius=0.22, pad=0.0, bg=True):
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
            gd.line([(0, y), (big, y)], fill=tuple(int(TEAL_TOP[i] + (TEAL_BOT[i] - TEAL_TOP[i]) * t) for i in range(3)) + (255,))
        mask = Image.new('L', (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([a, a, b, b], radius=int(w * radius), fill=255)
        im.paste(grad, (0, 0), mask)
        # a soft inner highlight so the tile does not look flat
        hl = Image.new('RGBA', (big, big), (0, 0, 0, 0))
        hd = ImageDraw.Draw(hl)
        hd.ellipse([a - w * 0.3, a - w * 0.55, a + w * 0.9, a + w * 0.45], fill=(255, 255, 255, 26))
        im.alpha_composite(Image.composite(hl, Image.new('RGBA', (big, big), (0, 0, 0, 0)), mask))
    d = ImageDraw.Draw(im)
    u = w / 100  # grid units
    sw = 10 * u  # stroke width
    # N: left leg up, diagonal down, right leg up — then the A leans on the N's right foot
    nx0, nx1 = a + 14 * u, a + 50 * u
    ax = a + 69 * u            # the A's apex
    ax2 = a + 88 * u           # the A's right foot
    top, bot = a + 24 * u, a + 76 * u
    d.line([(nx0, bot), (nx0, top)], fill=INK, width=int(sw))
    d.line([(nx0, top), (nx1, bot)], fill=INK, width=int(sw))
    d.line([(nx1, bot), (nx1, top)], fill=INK, width=int(sw))
    d.line([(nx1 + 2 * u, bot), (ax, top)], fill=MINT, width=int(sw))
    d.line([(ax, top), (ax2, bot)], fill=MINT, width=int(sw))
    for (x, y, c) in [(nx0, top, INK), (nx0, bot, INK), (nx1, bot, INK), (nx1, top, INK), (ax, top, MINT), (ax2, bot, MINT), (nx1 + 2 * u, bot, MINT)]:
        d.ellipse([x - sw / 2, y - sw / 2, x + sw / 2, y + sw / 2], fill=c)
    x1 = ax - 16 * u  # (keeps the spark line below unchanged)
    # the spark sits where the A's crossbar would be
    spark(d, x1 + 16 * u, a + 58 * u, 7.5 * u, 3 * u, SPARK)
    return im.resize((size, size), Image.LANCZOS)


def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)


# desktop (Electron)
save(mark(1024), f'{ROOT}/desktop/icon-1024.png')
save(mark(512), f'{ROOT}/desktop/icon.png')
mark(256).save(f'{ROOT}/desktop/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

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
