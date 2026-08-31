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
