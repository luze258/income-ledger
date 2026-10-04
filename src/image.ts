const MAX_DIMENSION = 1600;

/** 将常见照片压缩成适合本地账本备份的 JPEG；透明图片保留原格式。 */
export async function optimizeImage(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取图片'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  if (file.type === 'image/png' || file.type === 'image/gif' || file.size < 500 * 1024)
    return source;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('图片格式不受支持'));
    element.src = source;
  });
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

export const imageDataBytes = (data: string) => Math.ceil((data.length * 3) / 4);
