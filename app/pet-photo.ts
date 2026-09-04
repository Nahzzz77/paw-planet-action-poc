export const PET_PHOTO_MAX_BYTES = 12 * 1024 * 1024;
export const PET_PHOTO_MIN_SIDE = 320;

export type PetPhotoInfo = {
  width: number;
  height: number;
  size: number;
};

const detectPhotoFormat = async (file: File) => {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isWebp = bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;

  if (!isJpeg && !isPng && !isWebp) throw new Error('请上传真实的 JPG、PNG 或 WebP 图片');
};

const readDimensions = async (file: File) => {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const inspectPetPhoto = async (file: File): Promise<PetPhotoInfo> => {
  if (!file.size) throw new Error('这张照片是空文件，请重新选择');
  if (file.size > PET_PHOTO_MAX_BYTES) throw new Error('照片不能超过 12MB');
  await detectPhotoFormat(file);

  const { width, height } = await readDimensions(file);
  if (Math.min(width, height) < PET_PHOTO_MIN_SIDE) {
    throw new Error('照片太小，请选择短边至少 320 像素的清晰照片');
  }
  if (width > 12_000 || height > 12_000 || width * height > 50_000_000) {
    throw new Error('照片分辨率过高，请先缩小后再选择');
  }

  return { width, height, size: file.size };
};
