import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export function LegalPageLayout({ title, updatedAt, children }: { title: string; updatedAt: string; children: ReactNode }) {
  return (
    <div className="min-h-full bg-discord-darker">
      <div className="max-w-3xl mx-auto px-4 py-10 sm:py-16">
        <Link to="/login" className="text-sm text-discord-blurple hover:underline">
          ← Voltar
        </Link>

        <div className="flex items-center gap-3 mt-6 mb-2">
          <img src="/logo-192.png" alt="Mamacos Voip" className="w-10 h-10 rounded-full object-cover" />
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-wide">{title}</h1>
        </div>
        <p className="text-sm text-discord-text-muted mb-8">Última atualização: {updatedAt}</p>

        <div className="prose-legal text-discord-text leading-relaxed space-y-5">{children}</div>
      </div>
    </div>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-white tracking-wide mt-8 mb-2">{title}</h2>
      <div className="text-sm space-y-2 text-discord-text">{children}</div>
    </section>
  )
}
