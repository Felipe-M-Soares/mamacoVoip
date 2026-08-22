import { useContext } from 'react'
import { PresenceContext } from '../context/PresenceContext'

// true só quando o socket em tempo real dessa pessoa está mesmo aberto
// agora — ver o comentário grande em PresenceContext.tsx pra entender por
// que isso é diferente (e mais confiável) do que só olhar profiles.status.
export function useIsPresent(userId: string | null | undefined): boolean {
  const { onlineIds } = useContext(PresenceContext)
  if (!userId) return false
  return onlineIds.has(userId)
}

// Pro caso de listas inteiras (lista de membros, lista de amigos) que
// separam quem está "online" de quem está "offline" — em vez de chamar o
// hook por pessoa dentro de um .filter(), pega o Set uma vez só e cruza
// com profiles.status ali mesmo. Ver PresenceContext.tsx pro porquê.
export function useOnlineIds(): Set<string> {
  return useContext(PresenceContext).onlineIds
}
