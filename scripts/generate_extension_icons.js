const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height, drawFn) {
  const buffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = drawFn(x, y, width, height);
      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = a;
    }
  }

  const rawRows = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(Buffer.from([0])); // filter none
    rawRows.push(buffer.subarray(y * width * 4, (y + 1) * width * 4));
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) {
        c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const combined = Buffer.concat([typeBuf, data]);
    crcBuf.writeUInt32BE(crc32(combined), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

// Icon Drawing: Hive Hexagon + Glowing Amber Bee/Core on dark sapphire background
function hiveIconShader(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Rounded squircle container
  const cornerRadius = r * 0.85;
  if (Math.abs(dx) > cornerRadius && Math.abs(dy) > cornerRadius) {
    const cdx = Math.abs(dx) - cornerRadius;
    const cdy = Math.abs(dy) - cornerRadius;
    if (cdx * cdx + cdy * cdy > (r - cornerRadius) * (r - cornerRadius)) {
      return [0, 0, 0, 0]; // transparent
    }
  }

  // Base gradient: Deep space navy to indigo
  let red = 10;
  let green = 14;
  let blue = 26;

  // Hexagon honeycomb shape check
  const q2x = Math.abs(dx);
  const q2y = Math.abs(dy);
  const hexRadius = r * 0.65;
  const inHex = (q2x * 0.866025 + q2y * 0.5 <= hexRadius) && (q2y <= hexRadius * 0.95);

  if (inHex) {
    // Honeycomb amber core (#f59e0b to #fbbf24)
    const hexDist = Math.sqrt(dx * dx + dy * dy) / hexRadius;
    const coreGlow = Math.max(0, 1 - hexDist);
    red = Math.min(255, Math.floor(245 * coreGlow + 99 * (1 - coreGlow)));
    green = Math.min(255, Math.floor(158 * coreGlow + 102 * (1 - coreGlow)));
    blue = Math.min(255, Math.floor(11 * coreGlow + 241 * (1 - coreGlow)));
  } else {
    // Outer border glow
    const borderDist = Math.abs(dist - r * 0.85);
    if (borderDist < 2) {
      red = 99;
      green = 102;
      blue = 241;
    }
  }

  return [red, green, blue, 255];
}

const iconsDir = path.join(__dirname, '../extension/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const png = createPng(size, size, hiveIconShader);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`✓ Generated ${outPath} (${png.length} bytes)`);
});
