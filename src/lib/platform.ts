import { Capacitor } from '@capacitor/core'

// VIGÉSIMA SEXTA RODADA — primeira versão do app mobile (Android, via
// Capacitor — ver capacitor.config.ts e a pasta android/). Fora do app
// nativo (Capacitor.isNativePlatform() === false), isto sempre devolve
// false — inclusive dentro do Electron e no navegador comum — então
// nada muda pra quem já usa o app de desktop ou o site.
//
// Usado pra esconder, no app mobile, recursos que dependem do Electron
// (compartilhar tela/jogo, todos os fallbacks nativos de captura,
// overlay em jogo, atalhos globais) — nenhum deles existe/faz sentido
// num celular. O CÓDIGO desses recursos continua intacto e funcionando
// normal no desktop; aqui só decide se o BOTÃO aparece ou não.
export function isNativeMobileApp(): boolean {
  return Capacitor.isNativePlatform()
}

// Modo Escritório (3D): só no computador. No celular (app nativo ou site
// aberto no celular/tablet) a opção nem aparece — tela pequena, toque e
// placa de vídeo fraca deixam a experiência ruim e gastam bateria.
export function canUseOffice3d(): boolean {
  if (isNativeMobileApp()) return false
  if (typeof navigator === 'undefined') return true
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return false
  // iPad novo se apresenta como Mac: tem toque e não tem mouse
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return false
  if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches) return false
  return true
}
