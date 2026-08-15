import { useState } from 'react'
import { Modal } from './Modal'
import { useServers } from '../../hooks/useServers'

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
    setLink(`${window.location.origin}/convite/${invite.code}`)
  }

  async function handleCopy() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal title="Convidar amigos" onClose={onClose}>
      <p className="text-sm text-discord-text-muted mb-4">
        Compartilhe este link para convidar pessoas ao servidor. Ele expira em 7 dias.
      </p>

      {!link ? (
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full py-2.5 rounded bg-discord-blurple text-white font-medium hover:opacity-90 transition-colors disabled:opacity-60"
        >
          {loading ? 'Gerando...' : 'Gerar link de convite'}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={link}
            className="flex-1 px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none text-sm"
          />
          <button
            onClick={handleCopy}
            className="px-4 py-2.5 rounded bg-discord-blurple text-white font-medium hover:opacity-90 transition-colors text-sm shrink-0"
          >
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
    </Modal>
  )
}
