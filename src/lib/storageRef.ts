import { safeHttpUrl } from './messageFormatting'

export const ATTACHMENT_BUCKETS = ['attachments', 'dm-attachments', 'group-attachments'] as const

export type AttachmentSource =
  | { kind: 'storage'; bucket: string; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'unavailable' }

const MAX_PATH_LENGTH = 1024
const STORAGE_OBJECT_PATH = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/

export function isSafeStoragePath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) return false
  if (path.startsWith('/') || path.includes('\\')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false
  return path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function parseStorageObjectUrl(url: string, supabaseUrl: string): { bucket: string; path: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const expectedOrigin = originOf(supabaseUrl)
  if (!expectedOrigin || parsed.origin !== expectedOrigin) return null
  const match = STORAGE_OBJECT_PATH.exec(parsed.pathname)
  if (!match) return null
  try {
    const bucket = decodeURIComponent(match[1])
    const path = match[2]
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
    return isSafeStoragePath(path) ? { bucket, path } : null
  } catch {
    return null
  }
}

export function resolveAttachmentSource(
  fileUrl: string | null | undefined,
  expectedBucket: string,
  supabaseUrl: string
): AttachmentSource | null {
  if (typeof fileUrl !== 'string' || fileUrl.length === 0) return null
  if (/^https?:\/\//i.test(fileUrl)) {
    const ref = parseStorageObjectUrl(fileUrl, supabaseUrl)
    if (ref && ref.bucket === expectedBucket) return { kind: 'storage', bucket: ref.bucket, path: ref.path }
    const safe = safeHttpUrl(fileUrl)
    if (!safe) return null
    const expectedOrigin = originOf(supabaseUrl)
    if (!expectedOrigin || originOf(safe) !== expectedOrigin) return { kind: 'unavailable' }
    return { kind: 'external', url: safe }
  }
  return isSafeStoragePath(fileUrl) ? { kind: 'storage', bucket: expectedBucket, path: fileUrl } : null
}

export function storagePathsForBucket(fileUrls: Array<string | null | undefined>, bucket: string, supabaseUrl: string): string[] {
  const paths = new Set<string>()
  for (const fileUrl of fileUrls) {
    const source = resolveAttachmentSource(fileUrl, bucket, supabaseUrl)
    if (source?.kind === 'storage' && source.bucket === bucket) paths.add(source.path)
  }
  return [...paths]
}
