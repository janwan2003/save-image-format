#!/usr/bin/env python3
"""Make TIFF test fixtures in tests/fixtures/tiff/ with ImageMagick (`magick`) and Pillow.

For every fixture <name>.tif it also writes <name>.rgba.gz: the pixels ImageMagick itself
decodes (8-bit RGBA, first page or the page in the name), which tests/tiff.test.mjs compares
our decoder against. Re-run only to change the fixtures:  python3 scripts/make-tiff-fixtures.py
"""
import gzip, json, os, subprocess, tempfile
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'tiff')
os.makedirs(OUT, exist_ok=True)
tmp = tempfile.mkdtemp()

def pattern(w, h, alpha=False):
    im = Image.new('RGBA' if alpha else 'RGB', (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            r = (x * 37 + y * 91 + ((x * y) >> 3)) & 255
            g = (x * 5 + y * 3) & 255
            b = 255 - ((x * 2 + (y // 4) * 17) & 255)
            px[x, y] = (r, g, b, (x * 255) // max(1, w - 1)) if alpha else (r, g, b)
    return im

src = os.path.join(tmp, 'src.png'); pattern(96, 64).save(src)
src_a = os.path.join(tmp, 'src-a.png'); pattern(96, 64, True).save(src_a)
big = os.path.join(tmp, 'big.png'); pattern(320, 200).save(big)
photo = os.path.join(tmp, 'photo.png')
Image.merge('RGB', [Image.radial_gradient('L').resize((96, 64)), Image.linear_gradient('L').resize((96, 64)), Image.linear_gradient('L').rotate(90).resize((96, 64))]).save(photo)

def magick(*args):
    subprocess.run(['magick', *args], check=True)

cases = {}
def case(name, tol=0, page=0, note=''):
    cases[name] = {'tolerance': tol, 'page': page, 'note': note}

magick(src, '-compress', 'None', f'{OUT}/rgb8-none.tif'); case('rgb8-none', note='RGB 8-bit, uncompressed, strips')
magick(src, '-compress', 'LZW', f'{OUT}/rgb8-lzw.tif'); case('rgb8-lzw')
magick(big, '-compress', 'LZW', '-define', 'tiff:rows-per-strip=200', f'{OUT}/rgb8-lzw-big.tif'); case('rgb8-lzw-big', note='one 192 KB strip: LZW table fills and resets')
magick(src, '-compress', 'Zip', '-define', 'tiff:predictor=2', f'{OUT}/rgb8-deflate-pred.tif'); case('rgb8-deflate-pred')
magick(src, '-compress', 'RLE', f'{OUT}/rgb8-packbits.tif'); case('rgb8-packbits')
magick(src_a, '-compress', 'LZW', '-define', 'tiff:alpha=unassociated', f'{OUT}/rgba8-lzw.tif'); case('rgba8-lzw')
# Associated (premultiplied) alpha: Pillow writes RGBA as unassociated (ExtraSamples = 2), so store
# premultiplied pixels and patch the tag to 1. Expected pixels are the source, un-premultiplied (below).
pm = Image.open(src_a).copy(); px = pm.load()
for y in range(pm.height):
    for x in range(pm.width):
        r, g, b, a = px[x, y]; px[x, y] = (r * a // 255, g * a // 255, b * a // 255, a)
pm.save(f'{OUT}/rgba8-assoc.tif')
pm_pixels = pm.load()  # premultiplied values as stored (Pillow would un-premultiply on reading the file back)
data = bytearray(open(f'{OUT}/rgba8-assoc.tif', 'rb').read())
ifd = int.from_bytes(data[4:8], 'little'); n = int.from_bytes(data[ifd:ifd + 2], 'little')
for i in range(n):
    e = ifd + 2 + 12 * i
    if int.from_bytes(data[e:e + 2], 'little') == 338: data[e + 8:e + 10] = (1).to_bytes(2, 'little')
open(f'{OUT}/rgba8-assoc.tif', 'wb').write(data)
case('rgba8-assoc', tol=0, note='premultiplied (associated) alpha; pixels with alpha < 32 are skipped by the test')
magick(src, '-depth', '16', '-endian', 'MSB', '-compress', 'Zip', '-define', 'tiff:predictor=2', f'{OUT}/rgb16-be-deflate.tif'); case('rgb16-be-deflate', tol=1)
magick(src, '-colorspace', 'Gray', '-define', 'tiff:tile-geometry=32x32', '-compress', 'LZW', f'{OUT}/gray8-tiled.tif'); case('gray8-tiled', note='tiles that overhang the right and bottom edge')
magick(src, '-colors', '16', '-type', 'Palette', '-compress', 'LZW', f'{OUT}/palette4.tif'); case('palette4', tol=1)
magick(src, '-colorspace', 'CMYK', '-compress', 'LZW', f'{OUT}/cmyk8.tif'); case('cmyk8', tol=2)
magick(src, '-interlace', 'Plane', '-compress', 'LZW', f'{OUT}/rgb8-planar.tif'); case('rgb8-planar')
magick(src, '-monochrome', '-compress', 'Group4', f'{OUT}/bilevel-g4.tif'); case('bilevel-g4')
magick(src, '-monochrome', '-compress', 'Fax', f'{OUT}/bilevel-g3.tif'); case('bilevel-g3')
magick(src, '-monochrome', '-compress', 'None', f'{OUT}/bilevel-none.tif'); case('bilevel-none')
magick(src, '-compress', 'LZW', f'TIFF64:{OUT}/bigtiff.tif'); case('bigtiff')
magick(src, '-orient', 'RightTop', '-compress', 'LZW', f'{OUT}/orient6.tif'); case('orient6', note='Orientation 6: shown rotated 90° clockwise')
magick(photo, '-compress', 'JPEG', '-quality', '92', f'{OUT}/jpeg-ycbcr.tif'); case('jpeg-ycbcr', tol=6, note='JPEG-in-TIFF (needs a browser)')
# Multi-page: three solid pages.
magick('-size', '40x30', 'xc:#d02020', 'xc:#20a040', 'xc:#2040c0', '-compress', 'LZW', f'{OUT}/multipage.tif')
for p in range(3):
    case(f'multipage[{p}]', page=p)
# Pillow (libtiff) variants with a different writer.
Image.open(src).save(f'{OUT}/pil-rgb-lzw-le.tif', compression='tiff_lzw'); case('pil-rgb-lzw-le')
Image.open(src).convert('L').save(f'{OUT}/pil-gray-deflate.tif', compression='tiff_adobe_deflate'); case('pil-gray-deflate')

# Display P3 ICC profile (taken from the P3 HEIC fixture) on four mid-saturation quadrants. Not in the
# manifest: tests/site.test.mjs compares the result with Chromium's own Display P3 conversion.
heic = open(os.path.join(ROOT, 'tests', 'fixtures', 'quadrants-p3.heic'), 'rb').read()
at = heic.index(b'colrprof'); icc = heic[at + 8:at - 4 + int.from_bytes(heic[at - 4:at], 'big')]
q = Image.new('RGB', (64, 48))
for i, c in enumerate(['#c87830', '#30b040', '#3070c8', '#b04090']):
    q.paste(c, ((i % 2) * 32, (i // 2) * 24, (i % 2) * 32 + 32, (i // 2) * 24 + 24))
q.save(f'{OUT}/quadrants-p3.tif', compression='tiff_lzw', icc_profile=icc)
q.save(f'{OUT}/quadrants-untagged.tif', compression='tiff_lzw')

manifest = {}
for name, info in cases.items():
    base = name.split('[')[0]
    if base == 'rgba8-assoc':
        pmx = pm_pixels; w, h = 96, 64; out = bytearray()
        for y in range(h):
            for x in range(w):
                r, g, b, a = pmx[x, y]
                out += bytes([min(255, round(c * 255 / a)) if a else 0 for c in (r, g, b)] + [a])
        raw = bytes(out)
        ref = 'rgba8-assoc.rgba.gz'
        with gzip.open(f'{OUT}/{ref}', 'wb', compresslevel=9) as f: f.write(raw)
        manifest[name] = {'file': 'rgba8-assoc.tif', 'expected': ref, 'width': w, 'height': h, **info}
        continue
    raw = subprocess.run(['magick', f'{OUT}/{base}.tif[{info["page"]}]', '-auto-orient', '-depth', '8', 'rgba:-'], check=True, capture_output=True).stdout
    size = subprocess.run(['magick', 'identify', '-format', '%w %h', f'{OUT}/{base}.tif[{info["page"]}]'], check=True, capture_output=True, text=True).stdout.split()
    w, h = int(size[0]), int(size[1])
    if base == 'orient6': w, h = h, w
    assert len(raw) == w * h * 4, (name, len(raw), w, h)
    ref = f'{name.replace("[", "-p").replace("]", "")}.rgba.gz'
    with gzip.open(f'{OUT}/{ref}', 'wb', compresslevel=9) as f: f.write(raw)
    manifest[name] = {'file': f'{base}.tif', 'expected': ref, 'width': w, 'height': h, **info}
with open(f'{OUT}/manifest.json', 'w') as f: json.dump(manifest, f, indent=1)
print(len(manifest), 'cases;', sum(os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT)) // 1024, 'KB')
