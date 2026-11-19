export interface Achievement {
  id: string
  icon: string
  name: string
  desc: string
  stat: string
  goal: number
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'primeiro-cafe', icon: '☕', name: 'Primeiro cafezinho', desc: 'Tome um café na copa.', stat: 'coffee', goal: 1 },
  { id: 'cafeinado', icon: '⚡', name: 'Movido a café', desc: 'Tome 25 cafés.', stat: 'coffee', goal: 25 },
  { id: 'energizado', icon: '🔋', name: 'Energizado', desc: 'Tome 10 energéticos do galão da copa.', stat: 'energy', goal: 10 },
  { id: 'andarilho', icon: '👣', name: 'Andarilho', desc: 'Ande 1 km pelo escritório.', stat: 'walk', goal: 1000 },
  { id: 'maratonista', icon: '🏃', name: 'Maratonista do corredor', desc: 'Ande 10 km.', stat: 'walk', goal: 10000 },
  { id: 'social', icon: '👋', name: 'Simpatia', desc: 'Acene 20 vezes.', stat: 'wave', goal: 20 },
  { id: 'expressivo', icon: '🎉', name: 'Expressivo', desc: 'Mande 30 emotes.', stat: 'emote', goal: 30 },
  { id: 'reunioes', icon: '🎙️', name: 'Rato de reunião', desc: 'Entre em 15 salas de call pelo escritório.', stat: 'room', goal: 15 },
  { id: 'sentado', icon: '🪑', name: 'Confortável', desc: 'Sente 30 vezes.', stat: 'sit', goal: 30 },
  { id: 'soneca', icon: '😴', name: 'Soneca estratégica', desc: 'Deite no sofá ou na rede.', stat: 'lie', goal: 1 },
  { id: 'banheiro', icon: '🚻', name: 'Necessidades básicas', desc: 'Use o banheiro.', stat: 'wc', goal: 1 },
  { id: 'piloto', icon: '🏁', name: 'Piloto', desc: 'Termine uma corrida do Kart 3D.', stat: 'kart_race', goal: 1 },
  { id: 'campeao', icon: '🏆', name: 'Campeão do kart', desc: 'Vença uma corrida do Kart 3D.', stat: 'kart_win', goal: 1 },
  { id: 'tri', icon: '🥇', name: 'Tricampeão', desc: 'Vença 3 corridas.', stat: 'kart_win', goal: 3 },
  { id: 'colheita', icon: '🍌', name: 'Boa colheita', desc: 'Faça 30 pontos na Chuva de Banana.', stat: 'banana_best', goal: 30 },
  { id: 'lendario', icon: '🐒', name: 'Mamaco lendário', desc: 'Faça 60 pontos na Chuva de Banana.', stat: 'banana_best', goal: 60 },
  { id: 'memoria', icon: '🧠', name: 'Memória de elefante', desc: 'Termine a Memória em até 12 jogadas.', stat: 'memoria_ok', goal: 1 },
  { id: 'reflexo', icon: '⚡', name: 'Reflexo felino', desc: 'Média abaixo de 280 ms no Reflexo.', stat: 'reflexo_ok', goal: 1 },
  { id: 'cobra', icon: '🐍', name: 'Encantador de cobra', desc: '20 bananas na Cobra Faminta.', stat: 'cobra_best', goal: 20 },
]

const KEY = 'mamacos-3d-stats-v1'
type Stats = Record<string, number>

export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return v && typeof v === 'object' ? (v as Stats) : {}
  } catch {
    return {}
  }
}
function saveStats(s: Stats) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
  }
}

export function bumpStat(name: string, n = 1): Achievement[] {
  const s = loadStats()
  const before = { ...s }
  if (name.endsWith('_best')) s[name] = Math.max(s[name] ?? 0, n)
  else s[name] = (s[name] ?? 0) + n
  saveStats(s)
  return ACHIEVEMENTS.filter((a) => a.stat === name && (before[name] ?? 0) < a.goal && s[name] >= a.goal)
}

export function statsFromResult(r: { game: string; score?: number; place?: number }): [string, number][] {
  if (r.game === 'kart3d') return [['kart_race', 1], ...(r.place === 1 ? ([['kart_win', 1]] as [string, number][]) : [])]
  if (r.game === 'banana3d' && typeof r.score === 'number') return [['banana_best', r.score]]
  if (r.game === 'cobra' && typeof r.score === 'number') return [['cobra_best', r.score]]
  if (r.game === 'memoria' && typeof r.score === 'number' && r.score <= 12) return [['memoria_ok', 1]]
  if (r.game === 'reflexo' && typeof r.score === 'number' && r.score < 280) return [['reflexo_ok', 1]]
  return []
}
