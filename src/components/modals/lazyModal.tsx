import { lazy, Suspense, useState, type ComponentType } from 'react'

export type PreloadableComponent<P> = ComponentType<P> & { preload: () => Promise<unknown> }

const registry = new Set<() => Promise<unknown>>()
const started = new Set<() => Promise<unknown>>()

export function lazyComponent<P extends object>(loader: () => Promise<ComponentType<P>>): PreloadableComponent<P> {
  let resolved: ComponentType<P> | null = null
  let promise: Promise<ComponentType<P>> | null = null
  const load = () => {
    if (!promise) {
      promise = loader().then(
        (c) => (resolved = c),
        (err) => {
          promise = null
          throw err
        }
      )
    }
    return promise
  }
  const Lazy = lazy(async () => ({ default: await load() }))
  function LazyComponent(props: P) {
    const [Direct] = useState(() => resolved)
    return Direct ? <Direct {...props} /> : <Lazy {...props} />
  }
  const preload = () => load().catch(() => {})
  registry.add(preload)
  return Object.assign(LazyComponent, { preload })
}

export function lazyModal<P extends object>(loader: () => Promise<ComponentType<P>>): PreloadableComponent<P> {
  const Inner = lazyComponent(loader)
  function LazyModal(props: P) {
    return (
      <Suspense fallback={null}>
        <Inner {...props} />
      </Suspense>
    )
  }
  return Object.assign(LazyModal, { preload: Inner.preload })
}

export function preloadLazyChunks() {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  let cancelled = false
  let handle: number | null = null
  const schedule = (fn: () => void) => {
    handle = w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout: 2000 }) : window.setTimeout(fn, 50)
  }
  const next = () => {
    if (cancelled) return
    const job = [...registry].find((j) => !started.has(j))
    if (!job) return
    started.add(job)
    job().finally(() => schedule(next))
  }
  schedule(next)
  return () => {
    cancelled = true
    if (handle !== null) {
      if (w.cancelIdleCallback) w.cancelIdleCallback(handle)
      else clearTimeout(handle)
    }
  }
}
