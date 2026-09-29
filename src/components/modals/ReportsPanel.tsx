import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { EmptyState } from './settingsUI'
import { useServerReports } from '../../hooks/useReports'
import { supabase } from '../../lib/supabase'
import type { Profile, Message, ReportStatus } from '../../types/database'

const STATUS_LABEL: Record<ReportStatus, string> = {
  pending: 'Pendente',
  reviewed: 'Revisada',
  dismissed: 'Descartada',
}

const STATUS_COLOR: Record<ReportStatus, string> = {
  pending: '!bg-amber-400/12 !text-amber-300 !border-amber-400/25',
  reviewed: '!bg-discord-green/12 !text-discord-green !border-discord-green/25',
  dismissed: '',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function ReportsPanel({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const { reports, loading, setStatus } = useServerReports(serverId)
  const [filter, setFilter] = useState<'all' | ReportStatus>('pending')
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({})
  const [messagesById, setMessagesById] = useState<Record<string, Message>>({})

  useEffect(() => {
    const userIds = new Set<string>()
    const messageIds = new Set<string>()
    for (const r of reports) {
      userIds.add(r.reporter_id)
      if (r.reported_user_id) userIds.add(r.reported_user_id)
      if (r.message_id) messageIds.add(r.message_id)
    }
    if (userIds.size > 0) {
      supabase
        .from('profiles')
        .select('*')
        .in('id', [...userIds])
        .then(({ data }) => {
          if (data) setProfilesById((prev) => ({ ...prev, ...Object.fromEntries(data.map((p) => [p.id, p])) }))
        })
    }
    if (messageIds.size > 0) {
      supabase
        .from('messages')
        .select('*')
        .in('id', [...messageIds])
        .then(({ data }) => {
          if (data) setMessagesById((prev) => ({ ...prev, ...Object.fromEntries(data.map((m) => [m.id, m])) }))
        })
    }
  }, [reports])

  const visible = reports.filter((r) => filter === 'all' || r.status === filter)

  function nameFor(userId: string) {
    const p = profilesById[userId]
    return p ? p.display_name || p.username : '...'
  }

  return (
    <Modal title="Denúncias do servidor" onClose={onClose} maxWidth="max-w-2xl">
      <div role="tablist" aria-label="Filtrar denúncias" className="flex flex-wrap gap-1.5 mb-4">
        {(['pending', 'all', 'reviewed', 'dismissed'] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`h-8 px-3.5 rounded-full text-[13px] font-medium border transition-colors ${
              filter === f
                ? 'bg-discord-blurple/15 border-discord-blurple/50 text-white'
                : 'bg-white/[0.02] border-[var(--color-line)] text-discord-text-muted hover:text-discord-text hover:bg-white/[0.05]'
            }`}
          >
            {f === 'all' ? 'Todas' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando">
          {[0, 1, 2].map((k) => (
            <div key={k} className="rounded-2xl border border-[var(--color-line)] p-4 space-y-2.5">
              <div className="h-4 w-20 rounded-full animate-pulse bg-white/[0.05]" />
              <div className="h-2.5 w-3/4 rounded animate-pulse bg-white/[0.05]" />
              <div className="h-2.5 w-1/2 rounded animate-pulse bg-white/[0.04]" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={
            <>
              <path d="M5 21V4h11l-1.5 4L16 12H5" />
            </>
          }
          title="Nenhuma denúncia por aqui"
          hint="Quando alguém denunciar uma mensagem ou usuário, aparece aqui."
        />
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {visible.map((r) => (
            <div key={r.id} className="rounded-2xl bg-white/[0.02] border border-[var(--color-line)] p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className={`chip ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                <span className="text-[11.5px] text-discord-text-muted">{formatDate(r.created_at)}</span>
              </div>

              <p className="text-[14px] text-discord-text">
                <span className="text-discord-text-muted">{nameFor(r.reporter_id)}</span> denunciou{' '}
                {r.target_type === 'message' ? 'uma mensagem de ' : ''}
                <span className="font-medium text-white">{r.reported_user_id ? nameFor(r.reported_user_id) : 'usuário'}</span>
              </p>
              <p className="text-[13.5px] text-discord-text mt-1">
                <span className="text-discord-text-muted">Motivo:</span> {r.reason}
              </p>
              {r.details && <p className="text-[13px] text-discord-text-muted mt-1 italic">"{r.details}"</p>}
              {r.message_id && (
                <p className="text-[12.5px] text-discord-text-muted mt-2 rounded-lg bg-discord-darker/70 border-l-2 border-[var(--color-line-strong)] px-3 py-2 line-clamp-3">
                  {messagesById[r.message_id]?.content || '(mensagem não encontrada — pode já ter sido excluída)'}
                </p>
              )}

              {r.status === 'pending' && (
                <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-[var(--color-line)]">
                  <button onClick={() => setStatus(r.id, 'dismissed')} className="btn-ghost h-8 px-3 text-[13px]">
                    Descartar
                  </button>
                  <button
                    onClick={() => setStatus(r.id, 'reviewed')}
                    className="h-8 px-3 rounded-[10px] text-[13px] font-medium bg-discord-green/15 text-discord-green border border-discord-green/30 hover:bg-discord-green/25 transition-colors"
                  >
                    Marcar como revisada
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
