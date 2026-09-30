import { useState } from 'react'
import { Modal } from './Modal'
import { useServers } from '../../hooks/useServers'
import { isElectron } from '../../hooks/useGamePresence'
import { PUBLIC_WEB_URL } from '../../lib/config'

// Dentro do app desktop, window.location.origin não é uma URL de
// verdade (é o protocolo interno do Electron) — ver o comentário em
// lib/config.ts. Fora dele (no navegador), window.location.origin já
// reflete o domínio certo sozinho, inclusive em previews/domínios
// customizados.
function inviteBaseUrl(): string {
  return isElectron() ? PUBLIC_WEB_URL : window.location.origin
}

export function InviteModal({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const { createInvite } = useServers()
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    // convite expira em 7 dias por padrão, sem limite de usos
    const { error, invite } = await createInvite(serverId, undefined, 24 * 7)
    setLoading(false)
    if (error || !invite) {
      setError('Não foi possível gerar o convite.')
      return
    }
    setLink(`${inviteBaseUrl()}/convite/${invite.code}`)
  }

  async function handleCopy() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal
      title="Convidar amigos"
      description="Compartilhe este link para convidar pessoas ao servidor. Ele expira em 7 dias."
      onClose={onClose}
    >

      {!link ? (
        <button onClick={handleGenerate} disabled={loading} className="w-full h-10 btn-primary text-sm">
          {loading ? 'Gerando...' : 'Gerar link de convite'}
        </button>
      ) : (
        <div>
          <label htmlFor="invite-link" className="field-label">
            Link de convite
          </label>
          <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-mv-canvas border border-[var(--color-line-strong)]">
            <input
              id="invite-link"
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
              style={{ boxShadow: 'none' }}
              className="flex-1 min-w-0 px-2 bg-transparent text-mv-text outline-none text-sm font-mono"
            />
            <button
              onClick={handleCopy}
              className={`h-8 px-4 text-sm shrink-0 ${copied ? 'rounded-[10px] font-semibold bg-mv-green text-white' : 'btn-primary'}`}
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-rose-400 mt-3">{error}</p>}
    </Modal>
  )
}
