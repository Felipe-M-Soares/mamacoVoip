import { Capacitor } from '@capacitor/core'

export function isNativeMobileApp(): boolean {
  return Capacitor.isNativePlatform()
}

export function canUseOffice3d(): boolean {
  if (isNativeMobileApp()) return false
  if (typeof navigator === 'undefined') return true
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return false
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return false
  if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches) return false
  return true
}
