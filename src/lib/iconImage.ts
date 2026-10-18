// Prepara uma imagem pequena de ícone (categoria): cabe num quadrado de
// 128 px sem cortar nem distorcer, mantém o fundo transparente e sai em
// PNG. Recusa arquivo que não é imagem ou é grande demais.

export const ICON_MAX_INPUT_BYTES = 8 * 1024 * 1024
const ICON_SIZE = 128
const ACCEPTED = new Set(['image/png', 'image/webp', 'image/jpeg', 'image/gif'])

export function iconFitSize(width: number, height: number, box = ICON_SIZE): { width: number; height: number } {
  const scale = Math.min(1, box / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function prepareIconImage(file: File): Promise<{ file: File | null; error: string | null }> {
  if (!ACCEPTED.has(file.type)) return { file: null, error: 'Use uma imagem PNG, WebP, JPG ou GIF (PNG sem fundo fica melhor).' }
  if (file.size > ICON_MAX_INPUT_BYTES) return { file: null, error: 'Imagem grande demais (máximo 8 MB).' }
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const { width, height } = iconFitSize(bitmap.width, bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = ICON_SIZE
      canvas.height = ICON_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) return { file: null, error: 'Não foi possível ler a imagem.' }
      ctx.imageSmoothingQuality = 'high'
      // Centralizado num quadrado transparente.
      ctx.drawImage(bitmap, Math.round((ICON_SIZE - width) / 2), Math.round((ICON_SIZE - height) / 2), width, height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) return { file: null, error: 'Não foi possível converter a imagem.' }
      return { file: new File([blob], 'icone.png', { type: 'image/png' }), error: null }
    } finally {
      bitmap.close()
    }
  } catch {
    return { file: null, error: 'Não foi possível ler a imagem.' }
  }
}
