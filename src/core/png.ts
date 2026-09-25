/**
 * `canvas.toBlob()` writes a PNG with no physical-density information, so photo
 * software opens the tile as "72 DPI" and a naive print lands at the wrong size.
 * We splice a `pHYs` chunk in after `IHDR` declaring the real density, which is
 * what makes "print at 100%" reproduce the exact centimetres we designed for.
 */

import { dpiToPixelsPerMetre } from './units.ts';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function buildPhys(dpi: number): Uint8Array {
  const ppm = dpiToPixelsPerMetre(dpi);
  const chunk = new Uint8Array(21); // len(4) + type(4) + data(9) + crc(4)
  const v = new DataView(chunk.buffer);
  v.setUint32(0, 9);
  chunk[4] = 0x70; // p
  chunk[5] = 0x48; // H
  chunk[6] = 0x59; // Y
  chunk[7] = 0x73; // s
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  v.setUint32(17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

/** Return a copy of `pngBytes` whose density is tagged as `dpi`. */
export function tagPngDpi(pngBytes: Uint8Array, dpi: number): Uint8Array {
  for (let i = 0; i < 8; i++) {
    if (pngBytes[i] !== PNG_SIG[i]) return pngBytes; // not a PNG, leave it alone
  }
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);

  // Walk the chunk list: find the end of IHDR and any existing pHYs to drop.
  let off = 8;
  let insertAt = -1;
  const drop: Array<[number, number]> = [];
  while (off + 8 <= pngBytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(
      pngBytes[off + 4],
      pngBytes[off + 5],
      pngBytes[off + 6],
      pngBytes[off + 7],
    );
    const total = 12 + len;
    if (type === 'IHDR') insertAt = off + total;
    else if (type === 'pHYs') drop.push([off, total]);
    if (type === 'IDAT' || type === 'IEND') break;
    off += total;
  }
  if (insertAt < 0) return pngBytes;

  const phys = buildPhys(dpi);
  const dropped = drop.reduce((n, [, len]) => n + len, 0);
  const out = new Uint8Array(pngBytes.length + phys.length - dropped);

  // Build the output as bulk segment copies: everything except the dropped
  // ranges, with the new chunk spliced in right after IHDR.
  const cuts = [...drop].sort((a, b) => a[0] - b[0]);
  /** Byte ranges of [from, to) that survive, i.e. minus the dropped chunks. */
  const keep = (from: number, to: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    let cur = from;
    for (const [d0, dl] of cuts) {
      const d1 = d0 + dl;
      if (d1 <= cur || d0 >= to) continue;
      if (d0 > cur) out.push([cur, d0]);
      cur = Math.max(cur, d1);
    }
    if (cur < to) out.push([cur, to]);
    return out;
  };

  let w = 0;
  const emit = (ranges: Array<[number, number]>) => {
    for (const [a, b] of ranges) {
      out.set(pngBytes.subarray(a, b), w);
      w += b - a;
    }
  };
  emit(keep(0, insertAt));
  out.set(phys, w);
  w += phys.length;
  emit(keep(insertAt, pngBytes.length));
  return out.subarray(0, w);
}

export async function pngBlobWithDpi(canvasBlob: Blob, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await canvasBlob.arrayBuffer());
  const tagged = tagPngDpi(bytes, dpi);
  return new Blob([tagged as unknown as BlobPart], { type: 'image/png' });
}
