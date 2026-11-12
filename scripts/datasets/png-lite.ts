// Minimal PNG reader for object masks (8-bit grey / grey+alpha / RGB / RGBA, non-interlaced). Returns one grey channel (alpha for LA/RGBA when present, else luminance).
import { inflateSync } from 'node:zlib';
export function decodePngMask(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]; if (sig.some((b, i) => bytes[i] !== b)) throw new Error('DATASET_PNG_FORMAT');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let o = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0; const idat: Uint8Array[] = [];
  while (o + 8 <= bytes.length) { const len = dv.getUint32(o), type = String.fromCharCode(...bytes.subarray(o + 4, o + 8)), body = bytes.subarray(o + 8, o + 8 + len); if (type === 'IHDR') { width = dv.getUint32(o + 8); height = dv.getUint32(o + 12); depth = bytes[o + 16]!; ctype = bytes[o + 17]!; interlace = bytes[o + 20]!; } else if (type === 'IDAT') idat.push(body); else if (type === 'IEND') break; o += 12 + len; }
  if (depth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(ctype) || !width || !height) throw new Error('DATASET_PNG_UNSUPPORTED');
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype as 0 | 2 | 4 | 6]!, raw = inflateSync(Buffer.concat(idat)), stride = width * ch, img = new Uint8Array(height * stride);
  if (raw.length < height * (stride + 1)) throw new Error('DATASET_PNG_FORMAT');
  for (let y = 0; y < height; y++) { const f = raw[y * (stride + 1)]!, src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) { const a = x >= ch ? img[y * stride + x - ch]! : 0, b = y ? img[(y - 1) * stride + x]! : 0, c = x >= ch && y ? img[(y - 1) * stride + x - ch]! : 0, r = raw[src + x]!; let v: number;
      if (f === 0) v = r; else if (f === 1) v = r + a; else if (f === 2) v = r + b; else if (f === 3) v = r + ((a + b) >> 1); else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); } else throw new Error('DATASET_PNG_FORMAT'); img[y * stride + x] = v & 255; } }
  const data = new Uint8Array(width * height); for (let i = 0; i < width * height; i++) { const p = i * ch; data[i] = ctype === 0 ? img[p]! : ctype === 4 ? img[p + 1]! : ctype === 6 ? img[p + 3]! : Math.round(0.299 * img[p]! + 0.587 * img[p + 1]! + 0.114 * img[p + 2]!); }
  return { width, height, data };
}
