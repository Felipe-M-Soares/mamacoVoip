function soundboardUrlPrefix(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/soundboard/`
}

export function isAllowedSoundboardUrl(
  url: unknown,
  supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL as string
): url is string {
  if (typeof url !== 'string' || url.length > 2048 || !supabaseUrl) return false
  if (!url.startsWith(soundboardUrlPrefix(supabaseUrl))) return false
  return !url.includes('..')
}
