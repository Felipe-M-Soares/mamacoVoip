import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Tempo de uso do app (telão do modo 3D). A cada 5 min com a janela à
// vista, soma 5 min no dia (o banco limita: nunca mais que o tempo real
// desde a última soma). Se o banco ainda não tem a PARTE 30 do SQL, para
// em silêncio.
const PING_MS = 5 * 60 * 1000

export function useAppUsageHeartbeat(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return
    let stopped = false
    const id = window.setInterval(async () => {
      if (stopped || document.hidden) return
      const { error } = await supabase.rpc('track_app_usage', { p_seconds: 300 })
      if (error && (error.code === 'PGRST202' || /track_app_usage/.test(error.message))) {
        stopped = true
        window.clearInterval(id)
      }
    }, PING_MS)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [userId])
}

export type UsageRow = { userId: string; name: string; avatarUrl: string | null; seconds: number }

/** Ranking: você + amigos, últimos 7 dias. null = ainda carregando; 'erro' = indisponível. */
export function useFriendsUsage(enabled: boolean): UsageRow[] | null | 'erro' {
  const [rows, setRows] = useState<UsageRow[] | null | 'erro'>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void supabase.rpc('get_friends_app_usage', { p_days: 7 }).then(({ data, error }) => {
      if (!alive) return
      if (error || !data) { setRows('erro'); return }
      setRows(
        data.map((r) => ({ userId: r.user_id, name: r.display_name || r.username, avatarUrl: r.avatar_url, seconds: Number(r.seconds) || 0 }))
      )
    })
    return () => {
      alive = false
    }
  }, [enabled])
  return rows
}
