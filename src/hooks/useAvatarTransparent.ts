import { useSyncExternalStore } from 'react'
import { getCachedTransparency, subscribeTransparency } from '../lib/imageTransparency'

/**
 * true quando a foto de perfil é um PNG/WebP/GIF sem fundo (depois que o
 * <Avatar> carregou e detectou). Usado pra tirar a moldura/anel que os
 * cartões de perfil desenham em volta da foto — num recorte sem fundo
 * ela aparece como um contorno estranho.
 */
export function useAvatarTransparent(url: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribeTransparency,
    () => (url ? getCachedTransparency(url) === true : false),
    () => false
  )
}
