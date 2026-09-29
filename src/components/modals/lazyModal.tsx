import { lazy, Suspense, type ComponentType } from 'react'

/**
 * Cria uma versão "sob demanda" de um modal/painel: o código dele só é
 * baixado na primeira vez que for aberto, em vez de ir junto no pacote
 * inicial do app. Já vem com o próprio <Suspense fallback={null}> em volta
 * — sem isso, o carregamento "subiria" até o Suspense mais próximo (o da
 * rota, em App.tsx) e trocaria a tela INTEIRA pela tela de carregamento
 * por um instante.
 *
 * Uso: `const SettingsModal = lazyModal(() => import('./SettingsModal').then((m) => m.SettingsModal))`
 */
export function lazyModal<P extends object>(loader: () => Promise<ComponentType<P>>): ComponentType<P> {
  const Lazy = lazy(async () => ({ default: await loader() }))
  function LazyModal(props: P) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    )
  }
  return LazyModal
}
