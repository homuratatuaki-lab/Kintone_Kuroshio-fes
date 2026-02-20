#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var dir = path.join(__dirname, '..', 'image');
var iconPath = path.join(dir, 'icon.png');

if (fs.existsSync(iconPath)) {
  console.log('image/icon.png exists, skip.');
  process.exit(0);
}

// CRC32 (PNG uses CRC-32)
var crcTable = [];
for (var n = 0; n < 256; n++) {
  var c = n;
  for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  var c = 0 ^ (-1);
  for (var i = 0; i < buf.length; i++) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  return ((c ^ (-1)) >>> 0) >>> 0;
}

function pngChunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var chunk = Buffer.concat([Buffer.from(type), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(chunk), 0);
  return Buffer.concat([len, chunk, crc]);
}

var w = 64, h = 64;
// Each row: filter byte 0 + 64 gray pixels (0x80)
var raw = Buffer.alloc((1 + w) * h);
for (var y = 0; y < h; y++) {
  raw[(1 + w) * y] = 0;
  for (var x = 0; x < w; x++) raw[(1 + w) * y + 1 + x] = 0x80;
}
var idat = zlib.deflateSync(raw, { level: 9 });
var ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0);
ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 0;  // color type grayscale
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

var png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', idat),
  pngChunk('IEND', Buffer.alloc(0))
]);

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(iconPath, png);
console.log('Created image/icon.png (64x64 placeholder).');
