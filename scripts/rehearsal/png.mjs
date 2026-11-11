/**
 * Just enough PNG to compare two screenshots, with no dependency.
 *
 * Playwright writes 8-bit RGBA or RGB, non-interlaced. That is the only shape
 * `decodePng` accepts; anything else throws, and the caller records the pair as
 * "could not compare" rather than guessing. `encodePng` writes the diff picture
 * as 8-bit RGBA.
 *
 * The diff counts a pixel as changed when any channel moves by more than
 * `channelTolerance` (out of 255). Anti-aliasing and font hinting move a few
 * channels by a few steps; a real change moves them by far more. A screenshot
 * is "changed" when the share of changed pixels is above `ratio`.
 */
import zlib from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      px[o] = line[x * bpp];
      px[o + 1] = line[x * bpp + 1];
      px[o + 2] = line[x * bpp + 2];
      px[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: px };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Compares two decoded images. Returns the changed share and, when asked, a
 * picture: the old image faded, changed pixels in solid red.
 */
export function diffImages(a, b, { channelTolerance = 24, ratio = 0.005, picture = false } = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    return { comparable: false, changed: true, reason: `size ${a.width}x${a.height} became ${b.width}x${b.height}` };
  }
  const n = a.width * a.height;
  let changedPx = 0;
  const out = picture ? Buffer.alloc(n * 4) : null;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const moved =
      Math.abs(a.data[o] - b.data[o]) > channelTolerance ||
      Math.abs(a.data[o + 1] - b.data[o + 1]) > channelTolerance ||
      Math.abs(a.data[o + 2] - b.data[o + 2]) > channelTolerance ||
      Math.abs(a.data[o + 3] - b.data[o + 3]) > channelTolerance;
    if (moved) changedPx++;
    if (out) {
      if (moved) {
        out[o] = 230;
        out[o + 1] = 30;
        out[o + 2] = 30;
      } else {
        const g = Math.round((b.data[o] + b.data[o + 1] + b.data[o + 2]) / 3);
        const faded = 255 - Math.round((255 - g) * 0.25);
        out[o] = out[o + 1] = out[o + 2] = faded;
      }
      out[o + 3] = 255;
    }
  }
  const share = changedPx / n;
  return {
    comparable: true,
    changedPixels: changedPx,
    share,
    changed: share > ratio,
    picture: out ? { width: a.width, height: a.height, data: out } : undefined,
  };
}
