const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MIN_SIDE = 320;
const MAX_SIDE = 12_000;
const MAX_PIXELS = 50_000_000;

export type ValidatedPetPhoto = {
  bytes: Uint8Array;
  extension: 'jpg' | 'png' | 'webp';
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  sha256: string;
};

const isPng = (bytes: Uint8Array) =>
  bytes.length >= 24
  && bytes[0] === 0x89
  && bytes[1] === 0x50
  && bytes[2] === 0x4e
  && bytes[3] === 0x47
  && bytes[4] === 0x0d
  && bytes[5] === 0x0a
  && bytes[6] === 0x1a
  && bytes[7] === 0x0a;

const isJpeg = (bytes: Uint8Array) =>
  bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;

const isWebp = (bytes: Uint8Array) =>
  bytes.length >= 30
  && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
  && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';

const readUint24LE = (bytes: Uint8Array, offset: number) =>
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);

function readPngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegSize(bytes: Uint8Array) {
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;

  while (offset + 8 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (sofMarkers.has(marker) && segmentLength >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += segmentLength;
  }

  throw new Error('无法读取这张 JPEG 的尺寸，请换一张照片');
}

function readWebpSize(bytes: Uint8Array) {
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      width: readUint24LE(bytes, 24) + 1,
      height: readUint24LE(bytes, 27) + 1,
    };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const width = 1 + ((bytes[21] | (bytes[22] << 8)) & 0x3fff);
    const height = 1 + (((bytes[22] >> 6) | (bytes[23] << 2) | (bytes[24] << 10)) & 0x3fff);
    return { width, height };
  }
  if (
    chunk === 'VP8 '
    && bytes.length >= 30
    && bytes[23] === 0x9d
    && bytes[24] === 0x01
    && bytes[25] === 0x2a
  ) {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  throw new Error('无法读取这张 WebP 的尺寸，请换一张照片');
}

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');

export async function validatePetPhoto(file: File): Promise<ValidatedPetPhoto> {
  if (file.size <= 0) throw new Error('这张照片是空文件');
  if (file.size > MAX_FILE_SIZE) throw new Error('照片不能超过 12MB');

  const bytes = new Uint8Array(await file.arrayBuffer());
  let extension: ValidatedPetPhoto['extension'];
  let mimeType: ValidatedPetPhoto['mimeType'];
  let size: { width: number; height: number };

  if (isJpeg(bytes)) {
    extension = 'jpg';
    mimeType = 'image/jpeg';
    size = readJpegSize(bytes);
  } else if (isPng(bytes)) {
    extension = 'png';
    mimeType = 'image/png';
    size = readPngSize(bytes);
  } else if (isWebp(bytes)) {
    extension = 'webp';
    mimeType = 'image/webp';
    size = readWebpSize(bytes);
  } else {
    throw new Error('只支持真实的 JPG、PNG 或 WebP 图片');
  }

  const { width, height } = size;
  if (!width || !height) throw new Error('无法读取照片尺寸');
  if (Math.min(width, height) < MIN_SIDE) throw new Error('照片太小，短边至少需要 320 像素');
  if (Math.max(width, height) > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new Error('照片尺寸过大，请先缩小后再上传');
  }

  return {
    bytes,
    extension,
    mimeType,
    width,
    height,
    sha256: toHex(await crypto.subtle.digest('SHA-256', bytes)),
  };
}
