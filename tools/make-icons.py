#!/usr/bin/env python3
"""Renders the app icons from src/logo.svg into public/.

    python3 tools/make-icons.py

Needs Python with Playwright and Pillow, and a Chrome/Chromium binary (set CHROME to its path if it is not
/usr/bin/google-chrome). The results are committed, so this only has to run again when the logo changes.
"""
import asyncio, base64, io, os, pathlib, re
from PIL import Image
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'public'
SVG = (ROOT / 'src' / 'logo.svg').read_text()
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')


def sized(svg, px):
    return svg.replace('<svg ', '<svg width="%d" height="%d" style="display:block" ' % (px, px), 1)


def full_bleed(svg, scale):
    """Square background to the edges, the letter smaller: for icons the system crops itself (iOS, maskable)."""
    svg = svg.replace('<rect width="100" height="100" rx="23"', '<rect width="100" height="100" rx="0"')
    svg = re.sub(r'<rect x="1\.25"[^>]*/>\s*', '', svg)
    start = svg.index('<circle cx="50" cy="50" r="46"')
    end = svg.rindex('</svg>')
    return svg[:start] + '<g transform="translate(50 50) scale(%s) translate(-50 -50)">' % scale + svg[start:end] + '</g></svg>'


def font_face(name, file, weight):
    data = base64.b64encode((ROOT / 'src' / 'fonts' / file).read_bytes()).decode()
    return "@font-face{font-family:'%s';font-weight:%s;src:url(data:font/woff2;base64,%s) format('woff2');}" % (name, weight, data)


OG = """<html><head><style>
%s
html,body{margin:0;width:1200px;height:630px;background:#000;overflow:hidden}
body{display:flex;align-items:center;justify-content:center;gap:54px;
 background:radial-gradient(60%% 80%% at 50%% 45%%,#2a1f4d 0%%,#0e0b18 62%%,#000 100%%)}
.w{font-family:'Luckiest Guy';font-size:132px;line-height:1;color:#fff;transform:skewX(-8deg);letter-spacing:2px;text-shadow:0 7px 0 rgba(0,0,0,.55)}
.w b{font-weight:400;color:#ffc531}
.t{font-family:'Outfit';font-weight:600;font-size:38px;color:#b9b2d0;margin-top:14px}
</style></head><body><div style="filter:drop-shadow(0 18px 50px rgba(255,190,40,.35))">%s</div>
<div><div class="w">Gundi<b>Chest</b></div><div class="t">Open chests. Collect cards. Trade with friends.</div></div></body></html>"""


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])

        async def shot(html, w, h, transparent):
            page = await browser.new_page(viewport={'width': w, 'height': h})
            await page.set_content('<html><body style="margin:0;background:%s">%s</body></html>' % ('transparent' if transparent else '#0a0811', html) if not html.startswith('<html>') else html)
            await page.wait_for_timeout(150)
            data = await page.screenshot(omit_background=transparent)
            await page.close()
            return Image.open(io.BytesIO(data))

        rounded = {px: await shot(sized(SVG, px), px, px, True) for px in (16, 32, 48, 192, 512)}
        rounded[192].save(PUBLIC / 'icon-192.png', optimize=True)
        rounded[512].save(PUBLIC / 'icon-512.png', optimize=True)
        rounded[48].save(PUBLIC / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)], append_images=[rounded[16], rounded[32]])
        (await shot(sized(full_bleed(SVG, '.74'), 512), 512, 512, False)).convert('RGB').save(PUBLIC / 'icon-maskable-512.png', optimize=True)
        (await shot(sized(full_bleed(SVG, '.9'), 180), 180, 180, False)).convert('RGB').save(PUBLIC / 'apple-touch-icon.png', optimize=True)
        fonts = font_face('Luckiest Guy', 'luckiest-guy-latin-400-normal.woff2', '400') + font_face('Outfit', 'outfit-latin-wght-normal.woff2', '100 900')
        (await shot(OG % (fonts, sized(SVG, 300)), 1200, 630, False)).convert('RGB').save(PUBLIC / 'og.png', optimize=True)
        await browser.close()
    (PUBLIC / 'favicon.svg').write_text(SVG)
    for f in ('favicon.svg', 'favicon.ico', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'og.png'):
        print('%-24s %6.1f KB' % (f, (PUBLIC / f).stat().st_size / 1024))

asyncio.run(main())
