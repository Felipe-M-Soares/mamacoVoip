import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Distância (px) do fim da lista que ainda conta como "estou no fim".
const BOTTOM_THRESHOLD = 80
// Distância (px) do topo que dispara "carregar mensagens mais antigas".
const TOP_THRESHOLD = 200

/**
 * Rolagem de uma lista de chat, compartilhada por canal, DM e grupo.
 *
 * Antes cada lista fazia `scrollIntoView({ behavior: 'smooth' })` sempre
 * que `messages.length` mudava, o que causava:
 *  - arrancar a pessoa lá de cima pro fim da conversa a cada mensagem nova
 *    de outra pessoa enquanto ela lia o histórico;
 *  - ao trocar pra um canal com o MESMO número de mensagens, não rolar
 *    nada (ficava no meio/topo do canal novo);
 *  - animação lenta de rolagem desde o topo ao abrir um canal;
 *  - imagens carregando depois empurravam o fim pra fora da tela.
 *
 * Agora: abre sempre no fim (instantâneo), só acompanha mensagens novas se
 * a pessoa já estava no fim (ou se a mensagem é dela), mantém a posição ao
 * carregar mensagens antigas no topo e segue "grudado" no fim quando o
 * conteúdo cresce (imagem/preview carregando).
 */
export function useChatScroll({
  viewKey,
  firstId,
  lastId,
  lastIsOwn,
  hasMore,
  loadingOlder,
  onLoadOlder,
}: {
  viewKey: string
  firstId: string | undefined
  lastId: string | undefined
  lastIsOwn: boolean
  hasMore?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const prevRef = useRef<{ viewKey: string | null; firstId?: string; lastId?: string; scrollHeight: number }>({
    viewKey: null,
    scrollHeight: 0,
  })
  const loadOlderRef = useRef(onLoadOlder)
  loadOlderRef.current = onLoadOlder
  const canLoadOlderRef = useRef(false)
  canLoadOlderRef.current = Boolean(hasMore && !loadingOlder && onLoadOlder)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    atBottomRef.current = true
    setShowJumpToLatest(false)
  }, [])

  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
    atBottomRef.current = atBottom
    if (atBottom) setShowJumpToLatest(false)
    prevRef.current.scrollHeight = el.scrollHeight
    if (el.scrollTop < TOP_THRESHOLD && canLoadOlderRef.current) loadOlderRef.current?.()
  }, [])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const prev = prevRef.current
    if (prev.viewKey !== viewKey) {
      // Canal/conversa novo (ou a lista acabou de aparecer): vai direto pro fim.
      el.scrollTop = el.scrollHeight
      atBottomRef.current = true
      setShowJumpToLatest(false)
    } else if (firstId !== prev.firstId && lastId === prev.lastId && prev.firstId) {
      // Mensagens antigas entraram no TOPO: compensa a altura adicionada pra
      // tela não "pular".
      el.scrollTop += el.scrollHeight - prev.scrollHeight
    } else if (lastId !== prev.lastId) {
      if (atBottomRef.current || lastIsOwn) {
        el.scrollTo({ top: el.scrollHeight, behavior: prev.lastId ? 'smooth' : 'auto' })
        atBottomRef.current = true
      } else {
        setShowJumpToLatest(true)
      }
    }
    prevRef.current = { viewKey, firstId, lastId, scrollHeight: el.scrollHeight }
  }, [viewKey, firstId, lastId, lastIsOwn])

  // Conteúdo cresceu depois de renderizar (imagem, GIF, preview de link
  // carregando): se estava no fim, continua no fim.
  useEffect(() => {
    const content = contentRef.current
    const el = containerRef.current
    if (!content || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight
      prevRef.current.scrollHeight = el.scrollHeight
    })
    ro.observe(content)
    return () => ro.disconnect()
    // containerRef/contentRef mudam de elemento quando a lista remonta
    // (skeleton -> lista); viewKey/lastId cobrem esses casos.
  }, [viewKey, Boolean(lastId)])

  // Se a primeira página não enche a tela, não existe rolagem pra disparar
  // o "carregar mais" — então pede direto.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !canLoadOlderRef.current) return
    if (el.scrollHeight <= el.clientHeight + TOP_THRESHOLD) loadOlderRef.current?.()
  }, [viewKey, firstId, hasMore, loadingOlder])

  return { containerRef, contentRef, onScroll, showJumpToLatest, scrollToBottom }
}
