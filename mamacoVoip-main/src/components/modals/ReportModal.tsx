import { useState } from 'react'
import { Modal } from './Modal'
import { useSubmitReport } from '../../hooks/useReports'
import type { ReportTargetType } from '../../types/database'

const REASONS = [
  'Spam ou propaganda',
  'Assédio ou bullying',
  'Discurso de ódio',
  'Conteúdo sexual indevido',
  'Ameaça ou incitação à violência',
  'Informação falsa ou enganosa',
  'Outro motivo',
]

export function ReportModal({
  targetType,
  targetLabel,
  messageId,
  reportedUserId,
  serverId,
  onClose,
}: {
  targetType: ReportTargetType
  targetLabel: string
  messageId?: string
  reportedUserId?: string
  serverId?: string
  onClose: () => void
}) {
  const { submitReport } = useSubmitReport()
  const [reason, setReason] = useState(REASONS[0])
  const [details, setDetails] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit() {
    setLoading(true)
    setError(null)
    const { error } = await submitReport({
      targetType,
      reason,
      details,
      messageId,
      reportedUserId,
      serverId,
    })
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    setSent(true)
  }

  return (
    <Modal title="Denunciar" onClose={onClose}>
      {sent ? (
        <div className="text-center py-2">
          <p className="text-sm text-discord-text">
            Denúncia enviada. A moderação do servidor vai analisar.
          </p>
          <button onClick={onClose} className="mt-4 w-full py-2.5 rounded btn-primary text-sm">
            Fechar
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-discord-text-muted">
            Você está denunciando: <span className="text-discord-text">{targetLabel}</span>
          </p>

          <div>
            <label className="block text-[10px] font-bold uppercase text-discord-text-muted mb-1.5">
              Motivo
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-discord-text-muted mb-1.5">
              Detalhes (opcional)
            </label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="Descreva o que aconteceu, se ajudar a moderação a entender melhor"
              className="w-full px-3 py-2 text-sm rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple resize-none"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2.5 rounded border border-discord-text-muted text-discord-text hover:bg-white/5 transition-colors disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 py-2.5 rounded bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
            >
              {loading ? 'Enviando...' : 'Denunciar'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
