import { useEffect, useMemo, useState } from 'react'
// Texto integral dos avisos de terceiros (o mesmo arquivo vai no
// instalador — ver build.extraResources no package.json). Esta aba é
// carregada sob demanda (lazy em SettingsModal), então o texto só é
// baixado quando alguém abre "Sobre → Licenças".
import notices from '../../../THIRD_PARTY_NOTICES.md?raw'
import { TabHeader, SettingsCard } from './settingsUI'

const BUILD_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''

export function LicensesTab() {
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    window.electronAPI
      ?.getVersion()
      .then(setDesktopVersion)
      .catch(() => {})
  }, [])

  const version = desktopVersion || BUILD_VERSION
  const platform = window.electronAPI ? 'app para computador' : 'versão web'

  // Filtro simples por seção (cabeçalhos "## "/"### ") — o arquivo tem
  // milhares de linhas.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notices
    const sections = notices.split(/\n(?=#{2,3} )/)
    const hits = sections.filter((s) => s.toLowerCase().includes(q))
    return hits.length ? hits.join('\n\n') : ''
  }, [query])

  return (
    <div className="space-y-5">
      <TabHeader title="Sobre e licenças" description="Versão do app e avisos de software de terceiros usados no Mamacos Voip." />

      <SettingsCard>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
          <dt className="text-mv-muted">Aplicativo</dt>
          <dd className="text-white">Mamacos Voip</dd>
          <dt className="text-mv-muted">Versão</dt>
          <dd className="text-white">{version ? `${version} (${platform})` : platform}</dd>
        </dl>
      </SettingsCard>

      <SettingsCard
        title="Avisos de terceiros"
        description="O Mamacos Voip inclui componentes de código aberto. Os direitos continuam com os respectivos autores, sob as licenças abaixo."
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar por componente ou licença"
          aria-label="Filtrar avisos de terceiros"
          className="w-full px-3 py-2 mb-3 text-sm bg-mv-canvas text-mv-text outline-none"
        />
        <pre
          tabIndex={0}
          className="max-h-[55vh] overflow-auto rounded-xl bg-mv-canvas/70 border border-[var(--color-line)] p-3 text-[12px] leading-relaxed text-mv-text/90 whitespace-pre-wrap break-words font-mono"
        >
          {filtered || 'Nada encontrado.'}
        </pre>
      </SettingsCard>
    </div>
  )
}
