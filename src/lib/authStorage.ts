// Onde o supabase-js guarda a sessão (access/refresh token) e o
// code_verifier do PKCE.
//
// - Web / Android: localStorage (comportamento padrão de antes).
// - App desktop (Electron): arquivo cifrado com o safeStorage do sistema
//   (DPAPI no Windows, Keychain no macOS, libsecret no Linux) via IPC —
//   ver "secure-storage:*" em electron/main.cjs. Antes os tokens ficavam
//   em texto puro no localStorage do perfil do Electron (Local Storage/
//   leveldb na pasta de dados do app): qualquer programa rodando como o
//   usuário copiava a sessão inteira.
//
// Migração: na primeira leitura de uma chave que ainda não existe no
// armazenamento cifrado, pega o valor antigo do localStorage, grava
// cifrado e apaga o antigo — a pessoa continua logada.
//
// Se o sistema não tiver cifragem disponível (ex.: Linux sem chaveiro),
// o processo principal recusa e cai de volta no localStorage — pior
// caso = o comportamento de antes, nunca deslogar a pessoa por isso.

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

// Só chaves do supabase-js passam pelo cofre (o processo principal
// também confere).
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
    // cota cheia / bloqueado — nada a fazer
  }
}

function localRemove(key: string) {
  try {
    safeLocalStorage()?.removeItem(key)
  } catch {
    // best-effort
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

      // Ainda não está no cofre: migra do localStorage (sessão de uma
      // versão anterior do app), sem deslogar.
      const legacy = localGet(key)
      if (legacy === null) return null
      try {
        const saved = await bridge.setItem(key, legacy)
        if (saved.ok) localRemove(key)
      } catch {
        // fica no localStorage por enquanto; tenta de novo na próxima
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
        // best-effort
      }
    },
  }
}

// App Android/iOS (Capacitor): a sessão vai pro armazenamento NATIVO do
// app (SharedPreferences no Android, via @capacitor/preferences), que é
// gravado no disco na hora. O localStorage da WebView às vezes não
// chegava a ser salvo quando o Android fechava o app — e a pessoa tinha
// que logar de novo toda vez que abria. Migra a sessão antiga do
// localStorage na primeira leitura (ninguém é deslogado por isso).
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
          // fica no localStorage até a próxima
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
        // best-effort
      }
    },
  }
}
