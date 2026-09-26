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
const NOTES_KEY = 'mamacos-user-notes'

function readNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function getUserNote(userId: string): string {
  return readNotes()[userId] ?? ''
}

export function setUserNote(userId: string, note: string) {
  const all = readNotes()
  if (note.trim()) all[userId] = note.trim()
  else delete all[userId]
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(all))
  } catch {
    // best-effort
  }
}
