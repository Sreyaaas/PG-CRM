const MAX_DIMENSION = 1024
const TARGET_BYTES = 180_000

export interface CompressedImage {
  blob: Blob
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'
  sizeBytes: number
}

function loadImageElement(file: File): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then((bmp) => ({
      width: bmp.width,
      height: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
      close: () => bmp.close(),
    }))
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        close: () => URL.revokeObjectURL(url),
      })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read image file'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

/**
 * Compress an image in the browser (max 1600px longest side, JPEG ~0.8, target < 1 MB).
 * Falls back to the original file if canvas rendering is unavailable (e.g. non-image PDF or jsdom).
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  if (file.type === 'application/pdf') {
    return { blob: file, contentType: 'application/pdf', sizeBytes: file.size }
  }

  const probe = document.createElement('canvas')
  if (!probe.getContext?.('2d')) {
    return fallbackOriginal(file)
  }

  try {
    const img = await loadImageElement(file)
    try {
      const longest = Math.max(img.width, img.height)
      const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1
      const width = Math.max(1, Math.round(img.width * scale))
      const height = Math.max(1, Math.round(img.height * scale))

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return fallbackOriginal(file)
      }

      ctx.drawImage = ctx.drawImage.bind(ctx)
      img.draw(ctx, width, height)

      for (const quality of [0.8, 0.7, 0.6]) {
        const blob = await canvasToBlob(canvas, quality)
        if (blob && (blob.size <= TARGET_BYTES || quality === 0.6)) {
          return { blob, contentType: 'image/jpeg', sizeBytes: blob.size }
        }
      }
      return fallbackOriginal(file)
    } finally {
      img.close?.()
    }
  } catch {
    return fallbackOriginal(file)
  }
}

function fallbackOriginal(file: File): CompressedImage {
  const ct =
    file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/jpeg'
      ? file.type
      : 'image/jpeg'
  return { blob: file, contentType: ct, sizeBytes: file.size }
}
