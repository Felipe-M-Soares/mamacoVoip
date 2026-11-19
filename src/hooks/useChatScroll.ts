import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const BOTTOM_THRESHOLD = 80
const TOP_THRESHOLD = 200

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
      el.scrollTop = el.scrollHeight
      atBottomRef.current = true
      setShowJumpToLatest(false)
    } else if (firstId !== prev.firstId && lastId === prev.lastId && prev.firstId) {
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
  }, [viewKey, Boolean(lastId)])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !canLoadOlderRef.current) return
    if (el.scrollHeight <= el.clientHeight + TOP_THRESHOLD) loadOlderRef.current?.()
  }, [viewKey, firstId, hasMore, loadingOlder])

  return { containerRef, contentRef, onScroll, showJumpToLatest, scrollToBottom }
}
