import { createContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

interface PresenceContextValue {
  onlineIds: Set<string>
}

export const PresenceContext = createContext<PresenceContextValue>({ onlineIds: new Set() })

// Corrige o bug de usuário desconectado (fechou o app, caiu a internet,
// travou) continuar aparecendo com a bolinha verde de "online" pra sempre.
//
// A coluna profiles.status é uma ESCOLHA manual da pessoa (online / ausente
// / não perturbe / invisível) e só muda quando ela troca explicitamente ou
// faz logout normal — não existe (nem existiria, sem um servidor próprio
// rodando o tempo todo) um jeito de "zerar" essa coluna sozinha quando o
// app fecha do jeito errado.
//
// Em vez disso, usamos um canal de Presence do Supabase Realtime: cada
// cliente autenticado se anuncia aqui assim que conecta, e o Realtime já
// cuida de avisar automaticamente todo mundo quando esse socket cai —
// não importa o motivo (fechar a aba, cair a rede, o processo travar).
// Não precisa de heartbeat manual nem de gravar nada no banco: é
// exatamente pra isso que Presence existe. `onlineIds` reflete só isso —
// "o socket dessa pessoa está mesmo aberto agora" — e é cruzado com
// profiles.status na hora de decidir a bolinha (ver Avatar.tsx): só conta
// como online/ausente/não perturbe se as DUAS coisas baterem.
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    if (!user) {
      setOnlineIds(new Set())
      return
    }

    const channel = supabase.channel('presence:online', {
      config: { presence: { key: user.id } },
    })
    channelRef.current = channel

    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.track({ online_at: new Date().toISOString() })
        }
      })

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [user])

  return <PresenceContext.Provider value={{ onlineIds }}>{children}</PresenceContext.Provider>
}
