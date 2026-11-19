const cache = new Map<string, boolean>()
const MAX_CACHE = 500
const listeners = new Set<() => void>()

export function subscribeTransparency(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function mayHaveTransparency(url: string): boolean {
  const path = url.split(/[?#]/)[0].toLowerCase()
  return !/\.(jpe?g)$/.test(path)
}

export function edgeTransparencyRatio(data: Uint8ClampedArray, width: number, height: number): number {
  let total = 0
  let transparent = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue
      total++
      if (data[(y * width + x) * 4 + 3] < 16) transparent++
    }
  }
  return total === 0 ? 0 : transparent / total
}

export function getCachedTransparency(url: string): boolean | undefined {
  return cache.get(url)
}

export function detectTransparency(img: HTMLImageElement): boolean {
  const url = img.currentSrc || img.src
  const cached = cache.get(url)
  if (cached !== undefined) return cached
  let result = false
  if (mayHaveTransparency(url) && img.naturalWidth > 0) {
    try {
      const size = 32
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        result = edgeTransparencyRatio(data, size, size) >= 0.25
      }
    } catch {
      result = false
    }
  }
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string)
  cache.set(url, result)
  if (result) listeners.forEach((l) => l())
  return result
}
