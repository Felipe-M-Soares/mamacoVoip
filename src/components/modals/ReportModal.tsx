import { useState } from 'react'
import { Modal } from './Modal'
import { useSubmitReport, type SubmitReportTarget } from '../../hooks/useReports'

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
  dmMessageId,
  groupMessageId,
  reportedUserId,
  serverId,
  onClose,
}: {
  targetType: SubmitReportTarget
  targetLabel: string
  messageId?: string
  dmMessageId?: string
  groupMessageId?: string
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
  // Sem servidor (DM, grupo, usuário fora de servidor) não há moderação
  // local — vai direto pra equipe do Mamacos Voip.
  const platformOnly = targetType === 'dm_message' || targetType === 'group_message' || !serverId
  const [escalate, setEscalate] = useState(false)

  async function handleSubmit() {
    setLoading(true)
    setError(null)
    const { error } = await submitReport({
      targetType,
      reason,
      details,
      messageId,
      dmMessageId,
      groupMessageId,
      reportedUserId,
      serverId,
      escalate: platformOnly || escalate,
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
          <span className="w-12 h-12 rounded-2xl bg-mv-green/12 border border-mv-green/25 text-mv-green flex items-center justify-center mb-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <p className="text-[15px] font-medium text-white">Denúncia enviada</p>
          <p className="text-[13px] text-mv-muted mt-1">
            {platformOnly
              ? 'A equipe do Mamacos Voip vai analisar.'
              : escalate
                ? 'A moderação do servidor e a equipe do Mamacos Voip vão analisar.'
                : 'A moderação do servidor vai analisar.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-mv-canvas/60 border border-[var(--color-line)] px-3.5 py-2.5 text-[13px] text-mv-muted">
            Você está denunciando: <span className="text-mv-text font-medium">{targetLabel}</span>
          </div>

          <div>
            <label htmlFor="report-reason" className="field-label">
              Motivo
            </label>
            <select
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-mv-canvas text-mv-text outline-none"
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
              className="w-full px-3 py-2.5 text-sm bg-mv-canvas text-mv-text outline-none resize-none"
            />
          </div>

          {platformOnly ? (
            <p className="text-[12.5px] text-mv-muted leading-relaxed">
              Esta denúncia vai para a equipe do Mamacos Voip{targetType !== 'user' ? ', junto com o conteúdo da mensagem denunciada' : ''}.
            </p>
          ) : (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--color-line)] bg-white/[0.02] p-3">
              <input
                type="checkbox"
                checked={escalate}
                onChange={(e) => setEscalate(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-mv-accent"
              />
              <span className="text-[13px] leading-snug text-mv-muted">
                <span className="text-mv-text font-medium">Enviar também para a equipe do Mamacos Voip</span>
                <span className="block text-[12px] mt-0.5">
                  Use em casos graves (ameaças, exploração de menores, golpes) ou se a moderação do servidor não resolver.
                </span>
              </span>
            </label>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
