import { supabase } from '../lib/supabase'

export const RANKED_GAMES = ['kart', 'banana3d', 'cobra', 'memoria', 'reflexo'] as const
type Ranked = (typeof RANKED_GAMES)[number]
const LOWER_IS_BETTER = new Set<Ranked>(['kart', 'memoria', 'reflexo'])
const KEY = 'mamacos-mg-sent-v1'

function sentBests(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export async function submitMinigameResult(r: { game: string; score?: number }): Promise<void> {
  const game = r.game as Ranked
  if (!RANKED_GAMES.includes(game) || typeof r.score !== 'number' || !Number.isFinite(r.score)) return
  const value = Math.round(r.score)
  const sent = sentBests()
  const prev = sent[game]
  if (prev !== undefined && (LOWER_IS_BETTER.has(game) ? value >= prev : value <= prev)) return
  const { data, error } = await supabase.rpc('submit_minigame_score', { p_game: game, p_value: value })
  if (error || data === null || data === undefined) return
  sent[game] = data
  try {
    localStorage.setItem(KEY, JSON.stringify(sent))
  } catch {
  }
}

export interface RankingRow { name: string; value: number; me: boolean; avatarUrl: string | null }

export async function loadMinigameRanking(game: string, myId: string | undefined): Promise<{ rows: RankingRow[]; error?: boolean }> {
  const { data, error } = await supabase.rpc('get_friends_minigame_ranking', { p_game: game })
  if (error || !data) return { rows: [], error: true }
  return {
    rows: data.map((r) => ({ name: r.display_name || r.username, value: Number(r.value), me: r.user_id === myId, avatarUrl: r.avatar_url })),
  }
}
