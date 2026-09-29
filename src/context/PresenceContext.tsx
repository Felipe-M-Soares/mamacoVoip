import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { openSharedChannel } from '../lib/realtimeChannel'
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
  // Só o ID: o objeto `user` troca de identidade a cada renovação do token
  // (~1h). Antes isso derrubava e recriava o canal de presença com o
  // MESMO nome — e como a saída do canal antigo é assíncrona, o
  // `supabase.channel()` devolvia o canal antigo ainda "saindo", a
  // inscrição nova não acontecia e a pessoa sumia como offline pra todo
  // mundo até recarregar o app.
  const userId = user?.id ?? null
  const [onlineIds, setOnlineIds] = useState<Set<string>>(EMPTY_SET)

  useEffect(() => {
    if (!userId) {
      setOnlineIds(EMPTY_SET)
      return
    }

    return openSharedChannel('presence:online', { config: { presence: { key: userId } } }, (channel) => {
      channel
        .on('presence', { event: 'sync' }, () => {
          const next = new Set(Object.keys(channel.presenceState()))
          // Só troca o Set se o conteúdo mudou de verdade — todo Avatar do
          // app lê isso, então um Set novo a cada "sync" re-renderizava
          // todos eles mesmo sem ninguém ter entrado/saído.
          setOnlineIds((prev) => (sameSet(prev, next) ? prev : next))
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void channel.track({ online_at: new Date().toISOString() })
          }
        })
    })
  }, [userId])

  const value = useMemo(() => ({ onlineIds }), [onlineIds])
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
}

const EMPTY_SET: Set<string> = new Set()

function sameSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}
