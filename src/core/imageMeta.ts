/**
 * Minimal reader for embedded pixel-density metadata:
 *   PNG  → `pHYs` chunk (pixels per metre)
 *   JPEG → JFIF APP0 density, else EXIF X/YResolution (tags 0x011A/0x011B/0x0128)
 *   WEBP → no density field in the format
 *
 * Density is informational only: it tells the user what their file *claims*,
 * it never drives the tiling (physical size comes from the user's controls).
 */

export interface Density {
  x: number;
  y: number;
  source: 'png:pHYs' | 'jpeg:JFIF' | 'jpeg:EXIF';
}

export function readDensity(buf: ArrayBuffer): Density | null {
  const v = new DataView(buf);
  if (v.byteLength < 16) return null;
  // PNG signature
  if (v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) return readPng(v);
  // JPEG SOI
  if (v.getUint16(0) === 0xffd8) return readJpeg(v);
  return null;
}

function readPng(v: DataView): Density | null {
  let off = 8;
  while (off + 8 <= v.byteLength) {
    const len = v.getUint32(off);
    const type = String.fromCharCode(
      v.getUint8(off + 4),
      v.getUint8(off + 5),
      v.getUint8(off + 6),
      v.getUint8(off + 7),
    );
    const data = off + 8;
    if (type === 'pHYs' && len >= 9 && data + 9 <= v.byteLength) {
      const unit = v.getUint8(data + 8);
      if (unit !== 1) return null; // unit 0 = unknown aspect only
      const ppmX = v.getUint32(data);
      const ppmY = v.getUint32(data + 4);
      if (!ppmX || !ppmY) return null;
      return { x: ppmX * 0.0254, y: ppmY * 0.0254, source: 'png:pHYs' };
    }
    if (type === 'IDAT' || type === 'IEND') return null;
    off = data + len + 4; // + CRC
  }
  return null;
}

function readJpeg(v: DataView): Density | null {
  let off = 2;
  let exif: Density | null = null;
  while (off + 4 <= v.byteLength) {
    if (v.getUint8(off) !== 0xff) {
      off++;
      continue;
    }
    const marker = v.getUint8(off + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end
    const len = v.getUint16(off + 2);
    const seg = off + 4;

    if (marker === 0xe0 && seg + 12 <= v.byteLength) {
      // JFIF: "JFIF\0", ver(2), units(1), Xdensity(2), Ydensity(2)
      const tag = String.fromCharCode(
        v.getUint8(seg),
        v.getUint8(seg + 1),
        v.getUint8(seg + 2),
        v.getUint8(seg + 3),
      );
      if (tag === 'JFIF') {
        const units = v.getUint8(seg + 7);
        const dx = v.getUint16(seg + 8);
        const dy = v.getUint16(seg + 10);
        if (units === 1 && dx && dy) return { x: dx, y: dy, source: 'jpeg:JFIF' };
        if (units === 2 && dx && dy) return { x: dx * 2.54, y: dy * 2.54, source: 'jpeg:JFIF' };
      }
    }
    if (marker === 0xe1 && !exif && seg + 6 <= v.byteLength) {
      const tag = String.fromCharCode(
        v.getUint8(seg),
        v.getUint8(seg + 1),
        v.getUint8(seg + 2),
        v.getUint8(seg + 3),
      );
      if (tag === 'Exif') exif = readExif(v, seg + 6);
    }
    off = seg + len - 2;
  }
  return exif;
}

function readExif(v: DataView, tiff: number): Density | null {
  if (tiff + 8 > v.byteLength) return null;
  const bom = v.getUint16(tiff);
  const le = bom === 0x4949;
  if (!le && bom !== 0x4d4d) return null;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > v.byteLength) return null;
  const count = u16(ifd0);
  let xres: number | null = null;
  let yres: number | null = null;
  let unit = 2; // 2 = inch, 3 = cm
  for (let i = 0; i < count; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > v.byteLength) break;
    const tag = u16(e);
    const type = u16(e + 2);
    if (tag === 0x0128) unit = u16(e + 8);
    if ((tag === 0x011a || tag === 0x011b) && type === 5) {
      const p = tiff + u32(e + 8);
      if (p + 8 > v.byteLength) continue;
      const num = u32(p);
      const den = u32(p + 4);
      if (!den) continue;
      if (tag === 0x011a) xres = num / den;
      else yres = num / den;
    }
  }
  if (!xres && !yres) return null;
  const x = xres ?? yres!;
  const y = yres ?? xres!;
  const k = unit === 3 ? 2.54 : 1;
  return { x: x * k, y: y * k, source: 'jpeg:EXIF' };
}

export interface LoadedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  name: string;
  bytes: number;
  type: string;
  density: Density | null;
  /** Object URL for cheap <img> previews. */
  url: string;
}

export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (file.type && !ACCEPTED.includes(file.type)) {
    throw new Error(`Unsupported file type "${file.type}". Use PNG, JPEG, WEBP or AVIF.`);
  }
  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], { type: file.type || 'image/png' });
  let bitmap: ImageBitmap;
  try {
    // colorSpaceConversion: keep the browser from re-tagging; we assume sRGB.
    bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'default' });
  } catch {
    throw new Error('That file could not be decoded as an image.');
  }
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    name: file.name,
    bytes: file.size,
    type: file.type || 'unknown',
    density: readDensity(buf),
    url: URL.createObjectURL(blob),
  };
}
