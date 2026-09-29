import { lazy, Suspense, useState, type ComponentType } from 'react'

/**
 * Componente carregado sob demanda (fora do pacote inicial), mas que pode
 * ser PRÉ-CARREGADO antes de alguém precisar dele.
 *
 * Por que isso existe: com `React.lazy` puro, o PRIMEIRO clique num botão
 * que abre um modal tinha que esperar baixar + interpretar o arquivo do
 * modal (medido: ~340 ms a mais no 1º clique em "Configurações" com CPU
 * mais lenta) — e como o fallback era `null`, nada acontecia na tela
 * nesse meio-tempo, dando a impressão de que o botão "não respondeu".
 *
 * Agora:
 * - todo componente criado aqui entra num registro, e `preloadLazyChunks()`
 *   (chamado em idle logo depois do MainLayout montar) baixa todos em
 *   segundo plano;
 * - `Componente.preload()` pode ser chamado no hover/pointerdown de um
 *   botão pra adiantar ainda mais;
 * - depois que o código já chegou, o componente é renderizado DIRETO, sem
 *   passar pelo `lazy` — nem um frame de "suspenso" no clique.
 */
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
          // deixa tentar de novo depois (ex.: rede caiu no meio)
          promise = null
          throw err
        }
      )
    }
    return promise
  }
  const Lazy = lazy(async () => ({ default: await load() }))
  function LazyComponent(props: P) {
    // Decide UMA vez por instância: se o código já chegou, usa o
    // componente real; senão, o lazy. Trocar de um pro outro depois de
    // montado desmontaria o modal e perderia o estado dele.
    const [Direct] = useState(() => resolved)
    return Direct ? <Direct {...props} /> : <Lazy {...props} />
  }
  const preload = () => load().catch(() => {})
  registry.add(preload)
  return Object.assign(LazyComponent, { preload })
}

/**
 * Igual a `lazyComponent`, mas já vem com o próprio <Suspense fallback={null}>
 * em volta — sem isso, o carregamento "subiria" até o Suspense mais
 * próximo (o da rota, em App.tsx) e trocaria a tela INTEIRA pela tela de
 * carregamento por um instante.
 *
 * Uso: `const SettingsModal = lazyModal(() => import('./SettingsModal').then((m) => m.SettingsModal))`
 */
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

/**
 * Baixa em segundo plano, um por vez e só quando o navegador estiver
 * ocioso, o código de todos os modais/painéis registrados — pra que o
 * primeiro clique já abra na hora. Chamado uma vez pelo MainLayout.
 */
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
    // Olha o registro de novo a cada passo: um chunk recém-carregado pode
    // registrar outros (ex.: sub-abas lazy dentro das Configurações).
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
