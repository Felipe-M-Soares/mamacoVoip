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
    <Modal
      title="Denunciar"
      onClose={onClose}
      footer={
        sent ? (
          <button onClick={onClose} className="btn-primary h-9 px-4 text-sm">
            Fechar
          </button>
        ) : (
          <>
            <button onClick={onClose} disabled={loading} className="btn-secondary h-9 px-4 text-sm">
              Cancelar
            </button>
            <button onClick={handleSubmit} disabled={loading} className="btn-danger h-9 px-4 text-sm">
              {loading ? 'Enviando...' : 'Denunciar'}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <div className="flex flex-col items-center text-center py-4">
          <span className="w-12 h-12 rounded-2xl bg-discord-green/12 border border-discord-green/25 text-discord-green flex items-center justify-center mb-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <p className="text-[15px] font-medium text-white">Denúncia enviada</p>
          <p className="text-[13px] text-discord-text-muted mt-1">A moderação do servidor vai analisar.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-discord-darker/60 border border-[var(--color-line)] px-3.5 py-2.5 text-[13px] text-discord-text-muted">
            Você está denunciando: <span className="text-discord-text font-medium">{targetLabel}</span>
          </div>

          <div>
            <label htmlFor="report-reason" className="field-label">
              Motivo
            </label>
            <select
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-discord-darker text-discord-text outline-none"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="report-details" className="field-label">
              Detalhes (opcional)
            </label>
            <textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="Descreva o que aconteceu, se ajudar a moderação a entender melhor"
              className="w-full px-3 py-2.5 text-sm bg-discord-darker text-discord-text outline-none resize-none"
            />
          </div>

          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
