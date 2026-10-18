// Diminui fotos antes de enviar no chat — o plano grátis do Supabase tem
// ~1 GB pra todos os arquivos, e foto de celular/print em 4K costuma ter
// 3–8 MB sem nenhum ganho visível no chat.
//
// Regras:
//  - Só JPEG/PNG/WebP (GIF animado, SVG, vídeo, áudio etc. vão como estão).
//  - Só mexe se o arquivo for grande (> 400 KB) ou a imagem passar de 2560 px.
//  - Lado maior limitado a 2560 px, salvo em WebP qualidade 0.85 (mantém
//    transparência de PNG).
//  - Se o resultado não ficar menor, manda o original.
//  - Qualquer falha → manda o original (nunca impede o envio).

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
