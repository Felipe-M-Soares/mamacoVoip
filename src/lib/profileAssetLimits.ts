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
function validateProfileAsset(file: File, maxBytes: number, accept: string): string | null {
  const allowed = accept.split(',')
  if (!allowed.includes(file.type)) {
    return 'Formato de arquivo não aceito.'
  }
  if (file.size > maxBytes) {
    return `Arquivo muito grande — o máximo é ${formatMB(maxBytes)}.`
  }
  return null
}

// Descobre o tipo REAL da imagem pelos primeiros bytes ("assinatura" do
// arquivo). `file.type` vem só da extensão do nome — um "foto.png" que
// na verdade é um HTML/SVG/executável passaria na checagem de cima.
// Devolve o mime detectado, ou null se não for PNG/JPEG/GIF/WEBP.
export function sniffImageMime(bytes: Uint8Array): string | null {
  const b = bytes
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return 'image/png'
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) {
    return 'image/gif'
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  ) {
    return 'image/webp'
  }
  return null
}

// Validação completa: tipo declarado + tamanho + conteúdo real do
// arquivo (assinatura) batendo com o tipo declarado.
export async function validateProfileAssetDeep(file: File, maxBytes: number, accept: string): Promise<string | null> {
  const basic = validateProfileAsset(file, maxBytes, accept)
  if (basic) return basic
  if (file.size === 0) return 'Arquivo vazio.'
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
    const real = sniffImageMime(head)
    if (!real || !accept.split(',').includes(real)) return 'O conteúdo do arquivo não é uma imagem válida.'
  } catch {
    return 'Não foi possível ler o arquivo.'
  }
  return null
}
