// Tipos do catálogo de jogos (electron/gameCatalog.cjs) — só pros testes
// do Vitest/TypeScript; o main.cjs usa o .cjs direto.
export type AntiCheatKey =
  | 'vanguard'
  | 'eac'
  | 'battleye'
  | 'ricochet'
  | 'javelin'
  | 'ace'
  | 'gameguard'
  | 'hyperion'
  | 'mhyprot'
  | 'vac'
  | 'faceit'
  | 'neac'
  | 'defense'

export interface GameCatalogEntry {
  name: string
  exes: string[]
  antiCheat: AntiCheatKey | null
  category: string
}

export interface GenericGameDetection {
  label: string
  store: string
  processName: string
  antiCheat: AntiCheatKey | null
}

export declare const GAME_CATALOG: GameCatalogEntry[]
export declare const ANTI_CHEAT_LABELS: Record<AntiCheatKey, string>
export declare function buildKnownGamesMap(): Record<string, string>
export declare function findGameByProcessName(name: string | null | undefined): GameCatalogEntry | null
export declare function findGameByName(label: string | null | undefined): GameCatalogEntry | null
export declare function processNamesForGame(label: string): string[]
export declare function antiCheatLabel(key: AntiCheatKey | null | undefined): string | null
export declare function detectGenericGameFromPath(exePath: string | null | undefined): GenericGameDetection | null
export declare function normalizeExeName(name: string | null | undefined): string
