import { safeHttpUrl } from './messageFormatting'

// Buckets de anexos de mensagem. Desde a migration 017 os três são
// PRIVADOS: o arquivo só sai do Storage por uma URL assinada (com
// expiração), gerada pra quem passa na política de SELECT do bucket
// (membro do canal/grupo/conversa). Ver src/lib/storageUrls.ts.
export const ATTACHMENT_BUCKETS = ['attachments', 'dm-attachments', 'group-attachments'] as const
export type AttachmentBucket = (typeof ATTACHMENT_BUCKETS)[number]

// De onde o anexo vem, já resolvido a partir do que está gravado em
// file_url:
//  - 'storage': objeto do nosso Storage (bucket + caminho) → precisa de
//    URL assinada pra exibir;
//  - 'external': URL http(s) do NOSSO projeto (mesma origem de
//    VITE_SUPABASE_URL) mas fora do bucket esperado → usada como está,
//    já filtrada por safeHttpUrl;
//  - 'unavailable': URL de OUTRO host (outro projeto Supabase, CDN,
//    servidor de terceiro...) → NÃO é carregada: buscar o arquivo
//    entregaria o IP de quem abriu a conversa a quem controla o host
//    (rastreamento) e o conteúdo não passou pelas regras do nosso
//    Storage. A tela mostra "anexo indisponível".
export type AttachmentSource =
  | { kind: 'storage'; bucket: string; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'unavailable' }

const MAX_PATH_LENGTH = 1024
const STORAGE_OBJECT_PATH = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/

// Caminho relativo DENTRO de um bucket, como o cliente grava desde a
// 017 (ex.: "<server_id>/<channel_id>/<message_id>-foto.png"). Recusa
// qualquer coisa que pareça URL/esquema, caminho absoluto, "..",
// barra invertida ou caractere de controle.
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

// Extrai bucket + caminho de uma URL do nosso Storage
// (".../storage/v1/object/public/<bucket>/<caminho>", também aceita
// "sign"/"authenticated"). Devolve null se não for do nosso projeto ou
// não tiver esse formato.
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
    // "%" malformado
    return null
  }
}

// Converte o file_url gravado no banco na origem do arquivo.
//  - caminho puro (formato novo) → objeto do bucket esperado;
//  - URL do nosso Storage (formato antigo, bucket público) → mesmo
//    objeto, agora servido por URL assinada;
//  - outra URL http(s) do nosso projeto → externa (passa por safeHttpUrl);
//  - URL http(s) de outro host → 'unavailable' (não carrega);
//  - qualquer outra coisa → null (não exibe).
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

// Caminhos (dentro de `bucket`) dos anexos que são objetos do nosso
// Storage — usado pra apagar os arquivos junto com a mensagem.
export function storagePathsForBucket(fileUrls: Array<string | null | undefined>, bucket: string, supabaseUrl: string): string[] {
  const paths = new Set<string>()
  for (const fileUrl of fileUrls) {
    const source = resolveAttachmentSource(fileUrl, bucket, supabaseUrl)
    if (source?.kind === 'storage' && source.bucket === bucket) paths.add(source.path)
  }
  return [...paths]
}
