// 生成一个 32x32 像素风 .ico（PNG-in-ICO），用作快捷方式图标
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const S = 32;
const px = Buffer.alloc(S * S * 4); // RGBA

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

// 机身底色
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    const border = x < 2 || y < 2 || x > S - 3 || y > S - 3;
    if (border) set(x, y, 0, 0, 0);
    else set(x, y, 0x2c, 0x2c, 0x3c);
  }
// 像素倒角（四角抠掉）
[[0, 0], [1, 0], [0, 1]].forEach(([dx, dy]) => {
  set(dx, dy, 0, 0, 0, 0); set(S - 1 - dx, dy, 0, 0, 0, 0);
  set(dx, S - 1 - dy, 0, 0, 0, 0); set(S - 1 - dx, S - 1 - dy, 0, 0, 0, 0);
});
// 5x3 霓虹绿小屏
const cols = 5, rows = 3, cw = 4, ch = 5, gap = 1;
const totalW = cols * cw + (cols - 1) * gap;
const totalH = rows * ch + (rows - 1) * gap;
const ox = Math.floor((S - totalW) / 2);
const oy = Math.floor((S - totalH) / 2);
for (let r = 0; r < rows; r++)
  for (let c = 0; c < cols; c++) {
    const bx = ox + c * (cw + gap);
    const by = oy + r * (ch + gap);
    for (let yy = 0; yy < ch; yy++)
      for (let xx = 0; xx < cw; xx++) {
        const edge = xx === 0 || yy === 0 || xx === cw - 1 || yy === ch - 1;
        if (edge) set(bx + xx, by + yy, 0x0c, 0x1a, 0x12);
        else set(bx + xx, by + yy, 0x5c, 0xff, 0x8f);
      }
  }

// ---- PNG 编码 ----
function crcTable() {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8bit RGBA
// 原始扫描线（每行前置 filter=0）
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const idat = zlib.deflateSync(raw);
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

// ---- ICO 封装（内嵌 PNG）----
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = S; entry[1] = S; entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12);
const ico = Buffer.concat([dir, entry, png]);

const out = path.join(__dirname, 'icon.ico');
fs.writeFileSync(out, ico);
console.log('wrote', out, ico.length, 'bytes');
