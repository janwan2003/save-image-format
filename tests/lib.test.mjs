import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNameFromUrl, targetFilename } from '../extension/lib/filename.js';
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
  assert.equal(sniffType(s('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')), 'svg');
  assert.equal(sniffType(s('hello world')), null);
});
