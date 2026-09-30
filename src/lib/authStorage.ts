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
