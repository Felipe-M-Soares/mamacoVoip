// Só aceita tocar sons do soundboard que venham do NOSSO bucket público
// do Supabase ('soundboard' — ver useSoundboard.ts/getUrl). Antes,
// qualquer participante podia mandar, pelo canal Realtime da call, uma
// URL arbitrária (rastreador de IP, arquivo gigante, áudio de horas) que
// o app de TODO mundo na call baixava e tocava sozinho.
function soundboardUrlPrefix(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/soundboard/`
}

export function isAllowedSoundboardUrl(
  url: unknown,
  supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL as string
): url is string {
  if (typeof url !== 'string' || url.length > 2048 || !supabaseUrl) return false
  if (!url.startsWith(soundboardUrlPrefix(supabaseUrl))) return false
  // Sem "../" pra escapar do bucket via normalização de caminho.
  return !url.includes('..')
}
