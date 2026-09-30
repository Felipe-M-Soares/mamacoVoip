import { describe, expect, it } from 'vitest'
import { isSafeStoragePath, parseStorageObjectUrl, resolveAttachmentSource, storagePathsForBucket } from './storageRef'

const SB = 'https://abcd.supabase.co'
const S = '11111111-1111-1111-1111-111111111111'
const C = '22222222-2222-2222-2222-222222222222'

describe('isSafeStoragePath', () => {
  it('aceita caminhos relativos normais', () => {
    expect(isSafeStoragePath(`${S}/${C}/msg-foto.png`)).toBe(true)
    expect(isSafeStoragePath(`${S}/msg-audio.webm`)).toBe(true)
  })
  it('recusa esquemas, absolutos, traversal e lixo', () => {
    expect(isSafeStoragePath('javascript:alert(1)')).toBe(false)
    expect(isSafeStoragePath('https://x.com/a')).toBe(false)
    expect(isSafeStoragePath('/etc/passwd')).toBe(false)
    expect(isSafeStoragePath(`${S}/../outro/a.png`)).toBe(false)
    expect(isSafeStoragePath(`${S}//a.png`)).toBe(false)
    expect(isSafeStoragePath(`${S}\\a.png`)).toBe(false)
    expect(isSafeStoragePath(`${S}/a\n.png`)).toBe(false)
    expect(isSafeStoragePath('')).toBe(false)
    expect(isSafeStoragePath(null)).toBe(false)
    expect(isSafeStoragePath('a'.repeat(2000))).toBe(false)
  })
})

describe('parseStorageObjectUrl', () => {
  it('extrai bucket e caminho de URL pública antiga', () => {
    expect(parseStorageObjectUrl(`${SB}/storage/v1/object/public/dm-attachments/${S}/m-a%20b.png`, SB)).toEqual({
      bucket: 'dm-attachments',
      path: `${S}/m-a b.png`,
    })
  })
  it('aceita sign/authenticated e ignora query string', () => {
    expect(parseStorageObjectUrl(`${SB}/storage/v1/object/sign/attachments/${S}/${C}/x.png?token=abc`, SB)).toEqual({
      bucket: 'attachments',
      path: `${S}/${C}/x.png`,
    })
  })
  it('recusa outro host, outro formato e traversal codificado', () => {
    expect(parseStorageObjectUrl(`https://evil.com/storage/v1/object/public/attachments/${S}/x.png`, SB)).toBeNull()
    expect(parseStorageObjectUrl(`${SB}/rest/v1/messages`, SB)).toBeNull()
    // "/../" com a barra codificada só aparece depois do decode — tem que ser recusado
    expect(parseStorageObjectUrl(`${SB}/storage/v1/object/public/attachments/${S}%2F..%2Fx.png`, SB)).toBeNull()
    expect(parseStorageObjectUrl(`${SB}/storage/v1/object/public/attachments/${S}/%E0%A4%A`, SB)).toBeNull()
    expect(parseStorageObjectUrl('nem-url', SB)).toBeNull()
  })
})

describe('resolveAttachmentSource', () => {
  it('caminho puro vira objeto do bucket esperado', () => {
    expect(resolveAttachmentSource(`${S}/m-a.png`, 'group-attachments', SB)).toEqual({
      kind: 'storage',
      bucket: 'group-attachments',
      path: `${S}/m-a.png`,
    })
  })
  it('URL pública antiga do mesmo bucket vira objeto (pra assinar)', () => {
    expect(resolveAttachmentSource(`${SB}/storage/v1/object/public/attachments/${S}/${C}/m.png`, 'attachments', SB)).toEqual({
      kind: 'storage',
      bucket: 'attachments',
      path: `${S}/${C}/m.png`,
    })
  })
  it('URL de outro bucket do projeto fica como externa; outro host fica indisponível; esquemas perigosos somem', () => {
    expect(resolveAttachmentSource(`${SB}/storage/v1/object/public/avatars/${S}/a.png`, 'attachments', SB)).toEqual({
      kind: 'external',
      url: `${SB}/storage/v1/object/public/avatars/${S}/a.png`,
    })
    // Host de fora do projeto: não carrega (evita rastreamento por IP).
    expect(resolveAttachmentSource('https://cdn.exemplo.com/a.png', 'attachments', SB)).toEqual({ kind: 'unavailable' })
    expect(resolveAttachmentSource(`https://outro.supabase.co/storage/v1/object/public/attachments/${S}/${C}/m.png`, 'attachments', SB)).toEqual({
      kind: 'unavailable',
    })
    expect(resolveAttachmentSource('javascript:alert(1)', 'attachments', SB)).toBeNull()
    expect(resolveAttachmentSource('data:text/html,x', 'attachments', SB)).toBeNull()
    expect(resolveAttachmentSource(null, 'attachments', SB)).toBeNull()
  })
})

describe('storagePathsForBucket', () => {
  it('junta só os objetos do bucket, sem repetir', () => {
    expect(
      storagePathsForBucket(
        [
          `${S}/a.png`,
          `${SB}/storage/v1/object/public/dm-attachments/${S}/b.png`,
          `${SB}/storage/v1/object/public/attachments/${S}/c.png`,
          'https://cdn.exemplo.com/d.png',
          `${S}/a.png`,
        ],
        'dm-attachments',
        SB
      )
    ).toEqual([`${S}/a.png`, `${S}/b.png`])
  })
})
