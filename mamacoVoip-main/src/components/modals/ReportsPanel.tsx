import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useServerReports } from '../../hooks/useReports'
import { supabase } from '../../lib/supabase'
import type { Profile, Message, ReportStatus } from '../../types/database'

const STATUS_LABEL: Record<ReportStatus, string> = {
  pending: 'Pendente',
  reviewed: 'Revisada',
  dismissed: 'Descartada',
}

const STATUS_COLOR: Record<ReportStatus, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  reviewed: 'bg-discord-green/20 text-discord-green',
  dismissed: 'bg-discord-text-muted/20 text-discord-text-muted',
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
      <div className="flex gap-1.5 mb-4">
        {(['pending', 'all', 'reviewed', 'dismissed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-discord-blurple text-white'
                : 'bg-discord-darker text-discord-text-muted hover:text-white'
            }`}
          >
            {f === 'all' ? 'Todas' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-discord-text-muted text-center py-8">Carregando...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-discord-text-muted text-center py-8">Nenhuma denúncia por aqui.</p>
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {visible.map((r) => (
            <div key={r.id} className="bg-discord-darker rounded-lg p-3.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATUS_COLOR[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
                <span className="text-[10px] text-discord-text-muted">{formatDate(r.created_at)}</span>
              </div>

              <p className="text-sm text-discord-text">
                <span className="text-discord-text-muted">{nameFor(r.reporter_id)}</span> denunciou{' '}
                {r.target_type === 'message' ? 'uma mensagem de ' : ''}
                <span className="font-medium">{r.reported_user_id ? nameFor(r.reported_user_id) : 'usuário'}</span>
              </p>
              <p className="text-sm text-discord-text mt-1">
                <span className="text-discord-text-muted">Motivo:</span> {r.reason}
              </p>
              {r.details && <p className="text-sm text-discord-text-muted mt-1 italic">"{r.details}"</p>}
              {r.message_id && (
                <p className="text-xs text-discord-text-muted mt-1.5 bg-black/20 rounded px-2 py-1.5 line-clamp-3">
                  {messagesById[r.message_id]?.content || '(mensagem não encontrada — pode já ter sido excluída)'}
                </p>
              )}

              {r.status === 'pending' && (
                <div className="flex gap-2 mt-2.5">
                  <button
                    onClick={() => setStatus(r.id, 'reviewed')}
                    className="text-xs px-2.5 py-1 rounded bg-discord-green/20 text-discord-green hover:bg-discord-green/30 transition-colors"
                  >
                    Marcar como revisada
                  </button>
                  <button
                    onClick={() => setStatus(r.id, 'dismissed')}
                    className="text-xs px-2.5 py-1 rounded bg-white/5 text-discord-text-muted hover:bg-white/10 transition-colors"
                  >
                    Descartar
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
