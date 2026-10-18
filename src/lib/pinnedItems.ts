// Fixar canal/conversa no topo da lista — preferência pessoal,
// guardada localmente (não sincroniza entre dispositivos, mas evita
// precisar de uma tabela nova no banco pra algo puramente de
// interface).
const STORAGE_KEY = 'mamacos-pinned-items'

function readAll(): Record<string, true> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeAll(data: Record<string, true>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // best-effort — se o localStorage falhar, só não persiste
  }
}

export function isPinned(id: string): boolean {
  return Boolean(readAll()[id])
}

export function togglePinned(id: string): boolean {
  const all = readAll()
  const next = !all[id]
  if (next) all[id] = true
  else delete all[id]
  writeAll(all)
  return next
}

export function getPinnedSet(): Set<string> {
  return new Set(Object.keys(readAll()))
}

// Nota privada sobre um usuário — só quem escreveu vê (não sincroniza
// com o banco, fica só no seu dispositivo, igual o "fixar" acima).
//
// No app de PC as notas ficam CIFRADAS pelo sistema (DPAPI no Windows,
// Keychain no Mac — o mesmo cofre da sessão, ver "secure-storage:*" em
// electron/main.cjs). Ficam numa cópia em memória pra leitura instantânea;
// a gravação no cofre é em segundo plano. Notas antigas, que estavam em
// texto puro no localStorage, são migradas pro cofre e apagadas de lá.
// No site/Android (ou sem cofre disponível) continua no localStorage.
const LEGACY_NOTES_KEY = 'mamacos-user-notes'
const SECURE_NOTES_KEY = 'mv-user-notes'

let notesCache: Record<string, string> | null = null
let useSecure = false

function bridge() {
  try {
    return typeof window !== 'undefined' ? (window.electronAPI?.secureStorage ?? null) : null
  } catch {
    return null
  }
}

function parseNotes(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Record<string, string> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k] = val
    return out
  } catch {
    return {}
  }
}

function readLegacy(): Record<string, string> {
  try {
    return parseNotes(localStorage.getItem(LEGACY_NOTES_KEY))
  } catch {
    return {}
  }
}

function readNotes(): Record<string, string> {
  if (!notesCache) notesCache = readLegacy()
  return notesCache
}

function persistNotes(all: Record<string, string>) {
  const json = JSON.stringify(all)
  const b = bridge()
  if (useSecure && b) {
    void b.setItem(SECURE_NOTES_KEY, json).then((r) => {
      // Cofre falhou: não perde a nota — guarda no lugar antigo.
      if (!r.ok) writeLegacy(json)
    })
    return
  }
  writeLegacy(json)
}

function writeLegacy(json: string) {
  try {
    if (json === '{}') localStorage.removeItem(LEGACY_NOTES_KEY)
    else localStorage.setItem(LEGACY_NOTES_KEY, json)
  } catch {
    // best-effort
  }
}

/** Carrega as notas do cofre (app de PC). Chamado uma vez ao abrir o app. */
export async function initSecureNotes(): Promise<void> {
  const b = bridge()
  if (!b) return
  try {
    const res = await b.getItem(SECURE_NOTES_KEY)
    if (!res.ok) return
    const secure = parseNotes(res.value ?? null)
    const legacy = readLegacy()
    const merged = { ...legacy, ...secure, ...(notesCache ?? {}) }
    useSecure = true
    notesCache = merged
    if (Object.keys(legacy).length || JSON.stringify(secure) !== JSON.stringify(merged)) {
      const saved = await b.setItem(SECURE_NOTES_KEY, JSON.stringify(merged))
      if (saved.ok) {
        try {
          localStorage.removeItem(LEGACY_NOTES_KEY)
        } catch {
          // best-effort
        }
      }
    }
  } catch {
    // sem cofre: segue no localStorage
  }
}

export function getUserNote(userId: string): string {
  return readNotes()[userId] ?? ''
}

export function setUserNote(userId: string, note: string) {
  const all = { ...readNotes() }
  if (note.trim()) all[userId] = note.trim()
  else delete all[userId]
  notesCache = all
  persistNotes(all)
}

/** Ao sair da conta: apaga as notas (do cofre e do localStorage). */
export function clearUserNotes() {
  notesCache = {}
  writeLegacy('{}')
  const b = bridge()
  if (b) void b.removeItem(SECURE_NOTES_KEY).catch(() => {})
}

if (typeof window !== 'undefined') {
  void initSecureNotes()
  window.addEventListener('mamacos:signed-out', clearUserNotes)
}
