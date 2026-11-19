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
  }
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
  }
}

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
        }
      }
    }
  } catch {
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
