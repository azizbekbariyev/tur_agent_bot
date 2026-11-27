/**
 * Logotip rasmini PDF'ga berishdan OLDIN tekshirish.
 * Sabab: pdfkit ichidagi png-js buzuq PNG'ni asinxron ochadi va xatoni tutib bo'lmaydi - butun server jarayoni yiqiladi.
 * Shuning uchun faqat to'liq sog'lom PNG (imzo, barcha bo'laklar CRC, IDAT zlib'i ochiladi) va JPEG o'tadi.
 */
import { inflateSync } from 'zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIDE = 4000;
const MAX_BYTES = 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function validPng(buf: Buffer): boolean {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return false;
  let pos = 8;
  const idat: Buffer[] = [];
  let sawHeader = false;
  let sawEnd = false;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8);
    const end = pos + 8 + len;
    if (end + 4 > buf.length) return false;
    if (crc32(buf.subarray(pos + 4, end)) !== buf.readUInt32BE(end))
      return false;
    const name = type.toString('latin1');
    if (name === 'IHDR') {
      if (len !== 13) return false;
      const w = buf.readUInt32BE(pos + 8);
      const h = buf.readUInt32BE(pos + 12);
      if (!w || !h || w > MAX_SIDE || h > MAX_SIDE) return false;
      sawHeader = true;
    } else if (name === 'IDAT') {
      idat.push(buf.subarray(pos + 8, end));
    } else if (name === 'IEND') {
      sawEnd = true;
      break;
    }
    pos = end + 4;
  }
  if (!sawHeader || !sawEnd || !idat.length) return false;
  try {
    inflateSync(Buffer.concat(idat), { maxOutputLength: 64 * 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function validJpeg(buf: Buffer): boolean {
  return (
    buf.length > 4 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[buf.length - 2] === 0xff &&
    buf[buf.length - 1] === 0xd9
  );
}

/** PDF'ga xavfsiz berish mumkin bo'lgan logotip: PNG yoki JPEG, sog'lom, 1 MB gacha */
export function isDrawableLogo(buf: Buffer | null, mime?: string): boolean {
  if (!buf || buf.length > MAX_BYTES) return false;
  if (mime === 'image/png') return validPng(buf);
  if (mime === 'image/jpeg') return validJpeg(buf);
  return false;
}

/** Fayl boshidan rasm turini aniqlash (chaqiruvchi mime bermasa) */
export function sniffMime(buf: Buffer): string | undefined {
  if (buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'image/png';
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  return undefined;
}
