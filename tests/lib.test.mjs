import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNameFromUrl, targetFilename, buildFilename } from '../extension/lib/filename.js';
import { sniffType } from '../extension/lib/convert.js';

test('filenames from URLs', () => {
  assert.equal(targetFilename('https://cdn.example.com/a/b/photo.webp?w=800', 'png'), 'photo.png');
  assert.equal(targetFilename('https://x.com/media/My%20Cat.JPEG', 'jpg'), 'My Cat.jpg');
  assert.equal(targetFilename('https://x.com/', 'png'), 'image.png');
  assert.equal(targetFilename('https://ichef.example/live/abc.jpg.webp', 'png'), 'abc.png');
  assert.equal(targetFilename('https://x.com/.webp', 'png'), 'image.png');
  assert.equal(targetFilename('data:image/webp;base64,AAAA', 'png'), 'image.png');
  assert.equal(targetFilename('blob:https://x.com/1234-5678', 'png'), 'image.png');
  assert.equal(targetFilename('https://x.com/a/what%3Fis:this*.avif', 'jpg'), 'what_is_this_.jpg');
  assert.equal(targetFilename('https://x.com/con.png', 'png'), 'con_.png');
  assert.equal(targetFilename('https://x.com/image.php?id=3', 'png'), 'image.php.png');
  assert.equal(baseNameFromUrl('https://x.com/' + 'a'.repeat(300) + '.webp').length, 100);
  assert.equal(targetFilename('https://x.com/..%2F..%2Fetc%2Fpasswd', 'png'), 'etc_passwd.png');
  assert.ok(!baseNameFromUrl('https://x.com/..%2F..%2Fetc%2Fpasswd').includes('/'));
});

test('sniffType recognises common formats', () => {
  const b = (...x) => new Uint8Array(x);
  const s = (str) => new TextEncoder().encode(str);
  assert.equal(sniffType(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)), 'png');
  assert.equal(sniffType(b(0xff, 0xd8, 0xff, 0xe0)), 'jpeg');
  assert.equal(sniffType(s('GIF89a')), 'gif');
  assert.equal(sniffType(s('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(sniffType(s('\0\0\0\x1cftypavif')), 'avif');
  // HEIF family: major brand alone, or mif1 + compatible brands (an AVIF can also start with mif1).
  assert.equal(sniffType(s('\0\0\0\x18ftypheic\0\0\0\0mif1heic')), 'heic');
  assert.equal(sniffType(s('\0\0\0\x18ftypmif1\0\0\0\0mif1heic')), 'heic');
  assert.equal(sniffType(s('\0\0\0\x18ftypmif1\0\0\0\0mif1avif')), 'avif');
  assert.equal(sniffType(s('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')), 'svg');
  assert.equal(sniffType(s('hello world')), null);
});

test('file name patterns and subfolders', () => {
  const now = new Date(2026, 10, 5, 7, 8, 9);
  const src = 'https://cdn.example.com/a/photo.jpg.webp';
  const f = (o) => buildFilename({ src, ext: 'png', now, ...o });
  assert.equal(f({}), 'photo.png');
  assert.equal(f({ pattern: '' }), 'photo.png');
  assert.equal(f({ pattern: '{site} {date} {time} {name}', pageUrl: 'https://www.shop.example/p/1' }),
    'shop.example 2026-11-05 07-08-09 photo.png');
  assert.equal(f({ pattern: '{site}-{name}' }), 'cdn.example.com-photo.png', 'site falls back to the image host');
  assert.equal(f({ pattern: '{name}_{width}x{height}', width: 640, height: 480 }), 'photo_640x480.png');
  assert.equal(f({ pattern: '{nope} {name}' }), '{nope} photo.png', 'unknown tokens stay as typed');
  assert.equal(f({ pattern: 'a/b:c {name}' }), 'a_b_c photo.png', 'no path separators from the pattern');
  assert.equal(f({ pattern: '...' }), 'photo.png', 'empty after cleaning falls back to the name');
  assert.equal(f({ subfolder: 'Saveform' }), 'Saveform/photo.png');
  assert.equal(f({ subfolder: '/../Pics\\2026//x:y/ ' }), 'Pics/2026/x_y/photo.png');
  assert.equal(f({ subfolder: '../..' }), 'photo.png');
  assert.equal(buildFilename({ src: 'data:image/png;base64,AA', pageUrl: 'about:blank', ext: 'jpg', pattern: '{site}{name}' }), 'image.jpg');
});
