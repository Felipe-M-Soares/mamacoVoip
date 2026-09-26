// Limites dos 3 tipos de imagem personalizável do perfil — usados tanto
// pra validar ANTES de tentar subir (evita esperar o upload só pra
// descobrir que o arquivo é grande demais) quanto pro texto de ajuda na
// tela de edição. Os tamanhos em bytes precisam bater exatamente com o
// `file_size_limit` de cada bucket em 007_profile_customization.sql —
// se mudar um lado, muda o outro também.
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024 // 10MB — bucket 'avatars'
export const BANNER_MAX_BYTES = 15 * 1024 * 1024 // 15MB — bucket 'profile-banners'
export const DECORATION_MAX_BYTES = 5 * 1024 * 1024 // 5MB — bucket 'avatar-decorations'

export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
export const BANNER_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
// Decoração não aceita JPG de propósito — precisa de transparência ao
// redor do círculo do avatar, e JPG não tem canal alfa.
export const DECORATION_ACCEPT = 'image/png,image/webp,image/gif'

export const AVATAR_HELP = 'PNG, JPG, WEBP ou GIF animado — até 10MB. Recomendado: imagem quadrada, pelo menos 128×128px (fica melhor a partir de 512×512px).'
export const BANNER_HELP = 'PNG, JPG, WEBP ou GIF animado — até 15MB. Recomendado: 1200×600px (a área de banner é bem maior agora, cobre boa parte do card de perfil).'
export const DECORATION_HELP = 'PNG, WEBP ou GIF animado, com fundo transparente — até 5MB. Recomendado: 512×512px, com o miolo vazado onde o avatar vai aparecer.'

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`
}

// Validação client-side simples (tipo + tamanho) — a Storage do Supabase
// também confere isso no bucket, mas checar antes evita gastar tempo de
// upload só pra descobrir que passou do limite.
export function validateProfileAsset(file: File, maxBytes: number, accept: string): string | null {
  const allowed = accept.split(',')
  if (!allowed.includes(file.type)) {
    return 'Formato de arquivo não aceito.'
  }
  if (file.size > maxBytes) {
    return `Arquivo muito grande — o máximo é ${formatMB(maxBytes)}.`
  }
  return null
}
