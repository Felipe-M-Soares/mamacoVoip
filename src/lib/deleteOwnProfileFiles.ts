import { supabase } from './supabase'
import { parseStorageObjectUrl } from './storageRef'
import { SUPABASE_URL } from './storageUrls'

const PROFILE_BUCKETS = ['avatars', 'profile-banners', 'avatar-decorations'] as const

export async function deleteOwnProfileFiles(
  userId: string,
  knownUrls: Array<string | null | undefined> = []
): Promise<void> {
  const byBucket = new Map<string, Set<string>>()
  for (const b of PROFILE_BUCKETS) byBucket.set(b, new Set())

  for (const url of knownUrls) {
    if (!url) continue
    const ref = parseStorageObjectUrl(url, SUPABASE_URL)
    if (!ref || !byBucket.has(ref.bucket)) continue
    if (!ref.path.startsWith(`${userId}/`)) continue
    byBucket.get(ref.bucket)!.add(ref.path)
  }

  await Promise.all(
    PROFILE_BUCKETS.map(async (bucket) => {
      const paths = byBucket.get(bucket)!
      try {
        const { data, error } = await supabase.storage.from(bucket).list(userId, { limit: 1000 })
        if (!error && data) {
          for (const obj of data) {
            if (obj.name && obj.id) paths.add(`${userId}/${obj.name}`)
          }
        }
      } catch {
      }
      if (paths.size === 0) return
      try {
        const { error } = await supabase.storage.from(bucket).remove([...paths])
        if (error) console.warn(`[excluir conta] não foi possível apagar arquivos de ${bucket}:`, error.message)
      } catch (err) {
        console.warn(`[excluir conta] falha ao apagar arquivos de ${bucket}:`, err)
      }
    })
  )
}
