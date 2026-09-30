import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

export const THEMES = [
  { id: 'vermelho', label: 'Vermelho', description: 'O padrão da Mamacos Voip', swatch: '#ee3a34' },
  { id: 'azul', label: 'Clássico', description: 'Tons neutros em azul-acinzentado', swatch: '#6366f1' },
  { id: 'roxo', label: 'Roxo Meia-noite', description: 'Escuro e roxo', swatch: '#8b5cf6' },
  { id: 'oceano', label: 'Oceano', description: 'Azul-petróleo, calmo pra longas sessões', swatch: '#14b8a6' },
  { id: 'neon', label: 'Neon', description: 'Magenta elétrico com brilho ciano', swatch: '#c616c6' },
  { id: 'floresta', label: 'Floresta', description: 'Verde-musgo, fundo quase preto', swatch: '#1a8646' },
  { id: 'por-do-sol', label: 'Pôr do sol', description: 'Rosa-coral e dourado sobre vinho', swatch: '#d42a5f' },
  { id: 'grafite', label: 'Grafite', description: 'Monocromático, acento branco', swatch: '#e4e4e7' },
  { id: 'sakura', label: 'Sakura', description: 'Rosa suave com fundo ameixa', swatch: '#cc2b7a' },
  { id: 'cyber', label: 'Cyber', description: 'Ciano com destaques em amarelo', swatch: '#facc15' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

const STORAGE_KEY = 'mamacos-theme'
// O vermelho é a identidade da marca (foco em público gamer) — fica
// como padrão. O tema "Clássico" (paleta azul-acinzentada) continua
// disponível em Configurações → Aparência pra quem preferir, só não é
// mais o que quem abre o app pela primeira vez recebe.
const DEFAULT_THEME: ThemeId = 'vermelho'

function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((t) => t.id === value)
}

function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isThemeId(stored)) return stored
  } catch {
    // localStorage indisponível — usa o padrão
  }
  return DEFAULT_THEME
}

interface ThemeContextValue {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(loadTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // best-effort — se não der pra persistir, vale só pra essa sessão
    }
  }, [])

  // Memoizado: o ThemeProvider fica no topo do app — um objeto novo a cada
  // render forçaria todo consumidor de tema a re-renderizar junto.
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
