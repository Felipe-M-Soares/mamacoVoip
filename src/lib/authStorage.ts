export interface AsyncAuthStorage {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export interface SecureStorageBridge {
  getItem: (key: string) => Promise<{ ok: boolean; value?: string | null }>
  setItem: (key: string, value: string) => Promise<{ ok: boolean }>
  removeItem: (key: string) => Promise<{ ok: boolean }>
}

const SECURE_STORAGE_PREFIX = 'sb-'

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function localGet(key: string): string | null {
  try {
    return safeLocalStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function localSet(key: string, value: string) {
  try {
    safeLocalStorage()?.setItem(key, value)
  } catch {
  }
}

function localRemove(key: string) {
  try {
    safeLocalStorage()?.removeItem(key)
  } catch {
  }
}

export function createAuthStorage(bridge: SecureStorageBridge | null | undefined): AsyncAuthStorage {
  if (!bridge) {
    return {
      getItem: async (key) => localGet(key),
      setItem: async (key, value) => localSet(key, value),
      removeItem: async (key) => localRemove(key),
    }
  }

  const secure = (key: string) => key.startsWith(SECURE_STORAGE_PREFIX)

  return {
    async getItem(key) {
      if (!secure(key)) return localGet(key)
      let result: { ok: boolean; value?: string | null }
      try {
        result = await bridge.getItem(key)
      } catch {
        result = { ok: false }
      }
      if (!result.ok) return localGet(key)
      if (typeof result.value === 'string') return result.value

      const legacy = localGet(key)
      if (legacy === null) return null
      try {
        const saved = await bridge.setItem(key, legacy)
        if (saved.ok) localRemove(key)
      } catch {
      }
      return legacy
    },
    async setItem(key, value) {
      if (!secure(key)) return localSet(key, value)
      let ok = false
      try {
        ok = (await bridge.setItem(key, value)).ok
      } catch {
        ok = false
      }
      if (ok) localRemove(key)
      else localSet(key, value)
    },
    async removeItem(key) {
      localRemove(key)
      if (!secure(key)) return
      try {
        await bridge.removeItem(key)
      } catch {
      }
    },
  }
}

export interface NativePrefs {
  get: (o: { key: string }) => Promise<{ value: string | null }>
  set: (o: { key: string; value: string }) => Promise<void>
  remove: (o: { key: string }) => Promise<void>
}

export function createNativeAuthStorage(load: () => Promise<NativePrefs>): AsyncAuthStorage {
  let prefsPromise: Promise<NativePrefs | null> | null = null
  const prefs = () => {
    if (!prefsPromise) prefsPromise = load().catch(() => null)
    return prefsPromise
  }
  return {
    async getItem(key) {
      const p = await prefs()
      if (!p) return localGet(key)
      try {
        const { value } = await p.get({ key })
        if (typeof value === 'string') return value
      } catch {
        return localGet(key)
      }
      const legacy = localGet(key)
      if (legacy !== null) {
        try {
          await p.set({ key, value: legacy })
          localRemove(key)
        } catch {
        }
      }
      return legacy
    },
    async setItem(key, value) {
      const p = await prefs()
      if (!p) return localSet(key, value)
      try {
        await p.set({ key, value })
        localRemove(key)
      } catch {
        localSet(key, value)
      }
    },
    async removeItem(key) {
      localRemove(key)
      const p = await prefs()
      if (!p) return
      try {
        await p.remove({ key })
      } catch {
      }
    },
  }
}
