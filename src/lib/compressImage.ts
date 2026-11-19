const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MIN_BYTES = 400 * 1024
const MAX_SIDE = 2560
const QUALITY = 0.85

export function shouldTryCompress(file: Pick<File, 'type' | 'size'>, width: number, height: number): boolean {
  if (!COMPRESSIBLE.has(file.type)) return false
  return file.size > MIN_BYTES || Math.max(width, height) > MAX_SIDE
}

export function targetSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= MAX_SIDE) return { width, height }
  const scale = MAX_SIDE / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function compressImageForUpload(file: File): Promise<File> {
  if (!COMPRESSIBLE.has(file.type) || typeof createImageBitmap !== 'function') return file
  try {
    const bitmap = await createImageBitmap(file)
    try {
      if (!shouldTryCompress(file, bitmap.width, bitmap.height)) return file
      const { width, height } = targetSize(bitmap.width, bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, width, height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY))
      if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file
      const base = file.name.replace(/\.[^.]+$/, '') || 'imagem'
      return new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: file.lastModified })
    } finally {
      bitmap.close()
    }
  } catch {
    return file
  }
}
