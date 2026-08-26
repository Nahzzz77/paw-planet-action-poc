export const PET_PHOTO_MAX_BYTES = 12 * 1024 * 1024;
export const PET_PHOTO_MIN_SIDE = 320;

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

export type PetPhotoInfo = {
  width: number;
  height: number;
  size: number;
};

type DecodedPhoto = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

const decodePhoto = async (file: File): Promise<DecodedPhoto> => {
  if ('createImageBitmap' in window) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bitmap = await createImageBitmap(file);
    }
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
};

export const inspectPetPhoto = async (file: File): Promise<PetPhotoInfo> => {
  if (!file.size) throw new Error('这张照片是空文件，请重新选择');
  if (file.size > PET_PHOTO_MAX_BYTES) {
    throw new Error('照片不能超过 12MB');
  }
  await detectPhotoFormat(file);

  const decoded = await decodePhoto(file);
  try {
    if (Math.min(decoded.width, decoded.height) < PET_PHOTO_MIN_SIDE) {
      throw new Error('照片太小，请选择短边至少 320 像素的清晰照片');
    }
    if (decoded.width > 12_000 || decoded.height > 12_000 || decoded.width * decoded.height > 50_000_000) {
      throw new Error('照片分辨率过高，请先缩小后再选择');
    }
    return { width: decoded.width, height: decoded.height, size: file.size };
  } finally {
    decoded.dispose();
  }
};

const canvasToBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('浏览器没有成功生成预览，请换一张照片重试'));
  }, 'image/jpeg', 0.92);
});

const yieldToBrowser = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

export const createLocalCartoonPreview = async (file: File): Promise<Blob> => {
  const decoded = await decodePhoto(file);
  const workWidth = 432;
  const workHeight = 576;
  const workCanvas = document.createElement('canvas');
  workCanvas.width = workWidth;
  workCanvas.height = workHeight;
  const workContext = workCanvas.getContext('2d', { willReadFrequently: true });

  if (!workContext) {
    decoded.dispose();
    throw new Error('当前浏览器不支持照片处理');
  }

  try {
    const scale = Math.max(workWidth / decoded.width, workHeight / decoded.height);
    const drawWidth = decoded.width * scale;
    const drawHeight = decoded.height * scale;
    const drawX = (workWidth - drawWidth) / 2;
    const drawY = (workHeight - drawHeight) / 2;

    workContext.fillStyle = '#f5f0e7';
    workContext.fillRect(0, 0, workWidth, workHeight);
    workContext.imageSmoothingEnabled = true;
    workContext.imageSmoothingQuality = 'high';
    workContext.filter = 'blur(.65px) saturate(1.22) contrast(1.08) brightness(1.03)';
    workContext.drawImage(decoded.source, drawX, drawY, drawWidth, drawHeight);
    workContext.filter = 'none';

    const imageData = workContext.getImageData(0, 0, workWidth, workHeight);
    const pixels = imageData.data;
    const luminance = new Float32Array(workWidth * workHeight);

    for (let y = 0; y < workHeight; y += 1) {
      for (let x = 0; x < workWidth; x += 1) {
        const point = y * workWidth + x;
        const pixel = point * 4;
        luminance[point] = pixels[pixel] * 0.299 + pixels[pixel + 1] * 0.587 + pixels[pixel + 2] * 0.114;
      }
      if (y > 0 && y % 96 === 0) await yieldToBrowser();
    }

    const colorStep = 42.5;
    for (let y = 1; y < workHeight - 1; y += 1) {
      for (let x = 1; x < workWidth - 1; x += 1) {
        const point = y * workWidth + x;
        const topLeft = luminance[point - workWidth - 1];
        const top = luminance[point - workWidth];
        const topRight = luminance[point - workWidth + 1];
        const left = luminance[point - 1];
        const right = luminance[point + 1];
        const bottomLeft = luminance[point + workWidth - 1];
        const bottom = luminance[point + workWidth];
        const bottomRight = luminance[point + workWidth + 1];
        const gradientX = -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
        const gradientY = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
        const edgeStrength = Math.min(255, Math.hypot(gradientX, gradientY));
        const lineMix = Math.max(0, Math.min(0.68, (edgeStrength - 58) / 215));
        const offset = point * 4;

        for (let channel = 0; channel < 3; channel += 1) {
          const posterized = Math.round(pixels[offset + channel] / colorStep) * colorStep;
          pixels[offset + channel] = Math.round(posterized * (1 - lineMix) + 28 * lineMix);
        }
      }
      if (y > 0 && y % 96 === 0) await yieldToBrowser();
    }

    workContext.putImageData(imageData, 0, 0);

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = 576;
    outputCanvas.height = 768;
    const outputContext = outputCanvas.getContext('2d');
    if (!outputContext) throw new Error('当前浏览器不支持照片输出');
    outputContext.fillStyle = '#f7f2e9';
    outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(workCanvas, 0, 0, outputCanvas.width, outputCanvas.height);

    return await canvasToBlob(outputCanvas);
  } finally {
    decoded.dispose();
  }
};
