import { useEffect, useRef, useState } from 'react'
import { useFriends, type FriendshipWithProfile } from '../context/FriendsContext'

export function useNewFriendRequests() {
  const { incoming } = useFriends()
  const [newRequests, setNewRequests] = useState<FriendshipWithProfile[]>([])
  const seenIdsRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (seenIdsRef.current === null) {
      // Primeira vez que a lista carrega — tudo que já está pendente
      // nesse momento é "antigo", não dispara popup (senão, toda vez
      // que abrisse o app com pedidos pendentes, ia aparecer um popup
      // pra cada um).
      seenIdsRef.current = new Set(incoming.map((r) => r.id))
      return
    }

    const trulyNew = incoming.filter((r) => !seenIdsRef.current!.has(r.id))
    if (trulyNew.length > 0) {
      trulyNew.forEach((r) => seenIdsRef.current!.add(r.id))
      setNewRequests((prev) => [...prev, ...trulyNew])
    }
  }, [incoming])

  function dismiss(requestId: string) {
    setNewRequests((prev) => prev.filter((r) => r.id !== requestId))
  }

  return { newRequests, dismiss }
}
