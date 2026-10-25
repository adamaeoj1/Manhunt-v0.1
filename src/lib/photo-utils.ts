'use client';

/**
 * Compresses and resizes a camera image File or Data URL via an offscreen HTML5 Canvas
 * so high-resolution mobile photos (iPhone / Android) preview instantaneously and
 * transmit reliably over mobile networks.
 */
export async function compressImageFileToDataUrl(
  file: File,
  maxDimension = 960,
  quality = 0.78
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read selected photo file.'));
    reader.onload = () => {
      const rawDataUrl = reader.result;
      if (typeof rawDataUrl !== 'string') {
        reject(new Error('Invalid image file data.'));
        return;
      }

      const img = new Image();
      img.onerror = () => {
        // Fallback to raw Data URL if image decoding fails
        resolve(rawDataUrl);
      };
      img.onload = () => {
        try {
          let width = img.naturalWidth || img.width || 640;
          let height = img.naturalHeight || img.height || 480;

          if (width > maxDimension || height > maxDimension) {
            if (width >= height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(rawDataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', quality);
          resolve(compressed);
        } catch {
          resolve(rawDataUrl);
        }
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}
