#!/usr/bin/env python3
"""Make Photoshop (PSD/PSB) test fixtures in tests/fixtures/psd/ for tests/psd.test.mjs.

Two kinds of fixture:
- written by ImageMagick (`magick`): expected pixels are what ImageMagick itself decodes from the
  composite (`f.psd[0]`), reference "magick";
- written byte by byte here (write_psd below) for what ImageMagick cannot write (Lab, Duotone,
  32-bit float, ZIP compression, a file without a real composite): expected pixels are the source
  pixels they were built from, reference "source" (or "layers": the source layers composited with
  Pillow's alpha_composite).

For every fixture the manifest also records how far Pillow's own decode is from the expected
pixels (`pillow`: max channel difference, or null where Pillow cannot read the file), because the
decoders disagree on purpose in places (see the notes). Re-run only to change the fixtures:
    python3 scripts/make-psd-fixtures.py
"""
import gzip, io, json, os, struct, subprocess, tempfile, zlib
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'psd')
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    os.remove(os.path.join(OUT, f))
tmp = tempfile.mkdtemp()
W, H = 48, 32


def pattern(alpha=False):
    im = Image.new('RGBA', (W, H))
    px = im.load()
    for y in range(H):
        for x in range(W):
            px[x, y] = ((x * 37 + y * 91 + ((x * y) >> 3)) & 255, (x * 5 + y * 3) & 255,
                        255 - ((x * 2 + (y // 4) * 17) & 255), (x * 255) // (W - 1))
    return im if alpha else im.convert('RGB')


src = os.path.join(tmp, 'src.png'); pattern().save(src)
src_a = os.path.join(tmp, 'src-a.png'); pattern(True).save(src_a)


def magick(*args):
    subprocess.run(['magick', *args], check=True)


cases = {}  # name -> dict(file, reference, tolerance, note, expected raw bytes)


def from_magick(name, file, tol=0, note=''):
    raw = subprocess.run(['magick', f'{OUT}/{file}[0]', '-depth', '8', 'rgba:-'], check=True, capture_output=True).stdout
    assert len(raw) == W * H * 4, (name, len(raw))
    cases[name] = dict(file=file, reference='magick', tolerance=tol, note=note, raw=raw)


def from_source(name, file, raw, tol=0, note='', reference='source'):
    assert len(raw) == W * H * 4, (name, len(raw))
    cases[name] = dict(file=file, reference=reference, tolerance=tol, note=note, raw=raw)


# ---- written by ImageMagick ------------------------------------------------------------------
magick(src, f'{OUT}/rgb8-rle.psd'); from_magick('rgb8-rle', 'rgb8-rle.psd', note='RGB 8-bit, PackBits, one layer')
magick(src, '-compress', 'None', f'{OUT}/rgb8-raw.psd'); from_magick('rgb8-raw', 'rgb8-raw.psd', note='uncompressed')
magick(src_a, f'{OUT}/rgba8.psd')
from_magick('rgba8', 'rgba8.psd', tol=1, note='negative layer count: first extra channel is merged transparency; white matte removed (ImageMagick does the same)')
magick(src, '-colorspace', 'Gray', f'{OUT}/gray8.psd'); from_magick('gray8', 'gray8.psd')
magick(src, '-colorspace', 'Gray', '-depth', '16', f'{OUT}/gray16.psd'); from_magick('gray16', 'gray16.psd', tol=1, note='16-bit: high byte')
magick(src, '-depth', '16', f'{OUT}/rgb16.psd'); from_magick('rgb16', 'rgb16.psd', tol=1, note='16-bit: high byte')
magick(src, '-colorspace', 'CMYK', f'{OUT}/cmyk8.psd'); from_magick('cmyk8', 'cmyk8.psd', tol=1, note='CMYK stored inverted, naive conversion')
magick(src, '-colors', '16', '-type', 'Palette', f'{OUT}/indexed.psd'); from_magick('indexed', 'indexed.psd')
magick(src, '-monochrome', '-depth', '1', f'{OUT}/bitmap.psd'); from_magick('bitmap', 'bitmap.psd', note='Bitmap mode, 1 bit, 0 = white')
magick(src, f'PSB:{OUT}/rgb8.psb'); from_magick('psb-rgb8', 'rgb8.psb', note='PSB: 8-byte section lengths, 4-byte RLE row counts')
magick(src_a, f'PSB:{OUT}/rgba8.psb'); from_magick('psb-rgba8', 'rgba8.psb', tol=1, note='PSB with merged transparency')
# Layered: the first image is the composite, the others become layers (two, offset, one half transparent).
lay1 = os.path.join(tmp, 'lay1.png'); pattern().resize((40, 24)).save(lay1)
lay2 = os.path.join(tmp, 'lay2.png')
l2 = Image.new('RGBA', (20, 16), (30, 200, 90, 160)); l2.save(lay2)
comp = Image.new('RGBA', (W, H), (0, 0, 0, 0))
comp.alpha_composite(Image.open(lay1).convert('RGBA'), (4, 4))
comp.alpha_composite(l2, (24, 12))
comp_png = os.path.join(tmp, 'comp.png'); comp.save(comp_png)
magick(comp_png, '(', lay1, '-repage', '+4+4', ')', '(', lay2, '-repage', '+24+12', ')', f'{OUT}/layered.psd')
from_magick('layered', 'layered.psd', tol=1, note='three layers stored; the composite is read, not the layers')
# Extra channels that are NOT transparency: same RGBA pixels, but the layer count is positive /
# there is no layer section. ImageMagick reads the fourth channel as a non-alpha (meta) channel.
data = bytearray(open(f'{OUT}/rgba8.psd', 'rb').read())
p = 26; p += 4 + struct.unpack('>I', data[p:p + 4])[0]; p += 4 + struct.unpack('>I', data[p:p + 4])[0]
assert struct.unpack('>h', data[p + 8:p + 10])[0] == -1
data[p + 8:p + 10] = struct.pack('>h', 1)
open(f'{OUT}/extra-channel.psd', 'wb').write(data)
from_magick('extra-channel', 'extra-channel.psd', note='4 channels, positive layer count: the 4th is a saved selection, not alpha')
magick(src_a, '-define', 'psd:write-layers=false', f'{OUT}/extra-flat.psd')
from_magick('extra-flat', 'extra-flat.psd', note='4 channels, no layer section: the 4th is not alpha')
# Embedded Display P3 profile (from the HEIC fixture), assigned without converting pixels.
heic = open(os.path.join(ROOT, 'tests', 'fixtures', 'quadrants-p3.heic'), 'rb').read()
at = heic.index(b'colrprof'); icc = heic[at + 8:at - 4 + int.from_bytes(heic[at - 4:at], 'big')]
open(os.path.join(tmp, 'p3.icc'), 'wb').write(icc)
magick(src, '-profile', os.path.join(tmp, 'p3.icc'), f'{OUT}/rgb8-p3.psd')
from_magick('rgb8-p3', 'rgb8-p3.psd', note='ICC profile in image resource 1039 (pixels as stored)')


# ---- written here --------------------------------------------------------------------------
def packbits(row):
    out = bytearray(); i = 0
    while i < len(row):
        j = i
        while j + 1 < len(row) and row[j + 1] == row[i] and j - i < 127: j += 1
        if j > i:
            out += bytes([257 - (j - i + 1), row[i]]); i = j + 1; continue
        j = i
        while j < len(row) and j - i < 128 and not (j + 1 < len(row) and row[j + 1] == row[j]): j += 1
        j = max(j, i + 1)
        out += bytes([j - i - 1]) + row[i:j]; i = j
    return bytes(out)


def image_data(planes, row_bytes, rows, comp, version, depth):
    if comp == 0:
        return struct.pack('>H', 0) + b''.join(planes)
    if comp == 1:
        packed = [packbits(pl[r * row_bytes:(r + 1) * row_bytes]) for pl in planes for r in range(rows)]
        fmt = '>I' if version == 2 else '>H'
        return struct.pack('>H', 1) + b''.join(struct.pack(fmt, len(x)) for x in packed) + b''.join(packed)
    body = bytearray(b''.join(planes))
    if comp == 3:
        for r in range(len(body) // row_bytes):
            o = r * row_bytes
            row = body[o:o + row_bytes]
            if depth == 16:
                words = [int.from_bytes(row[i:i + 2], 'big') for i in range(0, len(row), 2)]
                d = [words[0]] + [(words[i] - words[i - 1]) & 0xffff for i in range(1, len(words))]
                body[o:o + row_bytes] = b''.join(v.to_bytes(2, 'big') for v in d)
            else:
                if depth == 32:  # split into byte planes first
                    n = row_bytes // 4
                    row = bytearray(row[x * 4 + k] for k in range(4) for x in range(n))
                body[o:o + row_bytes] = bytes([row[0]] + [(row[i] - row[i - 1]) & 255 for i in range(1, len(row))])
    return struct.pack('>H', comp) + zlib.compress(bytes(body))


def resource(rid, payload):
    return b'8BIM' + struct.pack('>H', rid) + b'\0\0' + struct.pack('>I', len(payload)) + payload + (b'\0' if len(payload) & 1 else b'')


def write_psd(path, mode, depth, planes, comp=1, version=1, colour_data=b'', resources=b'', layers=b''):
    row_bytes = (W + 7) // 8 if depth == 1 else W * depth // 8
    head = b'8BPS' + struct.pack('>H', version) + b'\0' * 6 + struct.pack('>HIIHH', len(planes), H, W, depth, mode)
    lm = struct.pack('>Q' if version == 2 else '>I', len(layers)) + layers
    body = head + struct.pack('>I', len(colour_data)) + colour_data + struct.pack('>I', len(resources)) + resources + lm
    open(path, 'wb').write(body + image_data(planes, row_bytes, H, comp, version, depth))


srgb = pattern().tobytes()
rgb_planes = [bytes(srgb[i::3]) for i in range(3)]
to_rgba = lambda im: im.convert('RGBA').tobytes()

# ZIP without and with prediction (Photoshop uses ZIP for layer channels; the format allows it here too).
write_psd(f'{OUT}/rgb8-zip.psd', 3, 8, rgb_planes, comp=2)
from_source('rgb8-zip', 'rgb8-zip.psd', to_rgba(pattern()), note='ZIP, no prediction')
write_psd(f'{OUT}/rgb8-zip-pred.psd', 3, 8, rgb_planes, comp=3)
from_source('rgb8-zip-pred', 'rgb8-zip-pred.psd', to_rgba(pattern()), note='ZIP with prediction')
rgb16_planes = [b''.join(struct.pack('>H', v * 257) for v in pl) for pl in rgb_planes]
write_psd(f'{OUT}/rgb16-zip-pred.psd', 3, 16, rgb16_planes, comp=3)
from_source('rgb16-zip-pred', 'rgb16-zip-pred.psd', to_rgba(pattern()), note='16-bit ZIP with prediction')
# 32-bit float: Photoshop stores linear light.
lin = lambda v: (v / 255 / 12.92) if v / 255 <= 0.04045 else ((v / 255 + 0.055) / 1.055) ** 2.4
rgb32_planes = [b''.join(struct.pack('>f', lin(v)) for v in pl) for pl in rgb_planes]
write_psd(f'{OUT}/rgb32.psd', 3, 32, rgb32_planes, comp=0)
from_source('rgb32', 'rgb32.psd', to_rgba(pattern()), tol=1, note='32-bit float, linear light, raw')
write_psd(f'{OUT}/rgb32-zip-pred.psd', 3, 32, rgb32_planes, comp=3)
from_source('rgb32-zip-pred', 'rgb32-zip-pred.psd', to_rgba(pattern()), tol=1, note='32-bit float, ZIP with prediction (byte planes)')
# Duotone: one grey channel plus an opaque duotone spec in the colour mode data; shown as grey.
grey = pattern().convert('L')
write_psd(f'{OUT}/duotone.psd', 8, 8, [grey.tobytes()], comp=1, colour_data=b'\0\x01' + b'\0' * 30)
from_source('duotone', 'duotone.psd', to_rgba(grey), note='Duotone shown as its grey channel')
# Lab 8-bit (L 0..255 = 0..100, a/b offset by 128; D50), PackBits, made from the sRGB pattern with
# LittleCMS (Pillow ImageCms). Expected pixels: LittleCMS converting those Lab bytes back to sRGB,
# unoptimised (its default 8-bit lookup-table transform is off by up to ~30 in saturated blues).
from PIL import ImageCms
srgb_p, lab_p = ImageCms.createProfile('sRGB'), ImageCms.createProfile('LAB', 5000)
lab = ImageCms.applyTransform(pattern(), ImageCms.buildTransform(srgb_p, lab_p, 'RGB', 'LAB', flags=ImageCms.Flags.NOOPTIMIZE))
write_psd(f'{OUT}/lab8.psd', 9, 8, [lab.getchannel(i).tobytes() for i in range(3)], comp=1)
lab_back = to_rgba(ImageCms.applyTransform(lab, ImageCms.buildTransform(lab_p, srgb_p, 'LAB', 'RGB', flags=ImageCms.Flags.NOOPTIMIZE)))
from_source('lab8', 'lab8.psd', lab_back, tol=3, reference='LittleCMS', note='Lab D50 to sRGB')
lab_magick = subprocess.run(['magick', f'{OUT}/lab8.psd[0]', '-depth', '8', 'rgba:-'], check=True, capture_output=True).stdout
print('lab8: ImageMagick max difference from LittleCMS:', max(abs(a - b) for a, b in zip(lab_magick, lab_back)))
# No real composite (saved without Maximize Compatibility): resource 1057 says so and the image
# data is plain white. Built from layered.psd: insert the resource, blank the composite.
data = open(f'{OUT}/layered.psd', 'rb').read()
p = 26; p += 4 + struct.unpack('>I', data[p:p + 4])[0]
res_len = struct.unpack('>I', data[p:p + 4])[0]
lm_at = p + 4 + res_len
lm_len = struct.unpack('>I', data[lm_at:lm_at + 4])[0]
channels = struct.unpack('>H', data[12:14])[0]
version_info = struct.pack('>IB', 1, 0) + struct.pack('>I', 0) + struct.pack('>I', 0) + struct.pack('>I', 1)
new_res = data[p + 4:lm_at] + resource(1057, version_info)
blank = struct.pack('>H', 0) + b'\xff' * (W * H * channels)
open(f'{OUT}/no-composite.psd', 'wb').write(data[:p] + struct.pack('>I', len(new_res)) + new_res + data[lm_at:lm_at + 4 + lm_len] + blank)
from_source('no-composite', 'no-composite.psd', comp.tobytes(), tol=2, reference='layers',
            note='resource 1057 hasRealMergedData = 0: rebuilt from the layers (approximate)')

# ---- expected pixels, Pillow cross-check, manifest ---------------------------------------
manifest = {}
for name, c in cases.items():
    raw = c.pop('raw')
    ref = f'{name}.rgba.gz'
    with gzip.open(f'{OUT}/{ref}', 'wb', compresslevel=9) as f: f.write(raw)
    try:
        pil = Image.open(f'{OUT}/{c["file"]}').convert('RGBA').tobytes()
        pillow = max(abs(a - b) for a, b in zip(pil, raw)) if len(pil) == len(raw) else None
    except Exception:
        pillow = None
    manifest[name] = {**c, 'expected': ref, 'width': W, 'height': H, 'pillow': pillow}
with open(f'{OUT}/manifest.json', 'w') as f: json.dump(manifest, f, indent=1)
print(len(manifest), 'cases;', sum(os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT)) // 1024, 'KB')
for name, c in manifest.items(): print(f'  {name:16} ref={c["reference"]:7} pillow={c["pillow"]}')
