import { useState } from 'react'
import { Modal } from './Modal'
import { Avatar } from '../ui/Avatar'
import { useModeration, type LogWithProfiles } from '../../hooks/useModeration'

const ACTION_LABELS: Record<string, string> = {
  kick: 'expulsou',
  ban: 'baniu',
  unban: 'desbaniu',
  timeout: 'silenciou',
  remove_timeout: 'removeu o silenciamento de',
  role_created: 'criou o cargo',
  role_deleted: 'excluiu o cargo',
  role_assigned: 'atribuiu um cargo a',
  role_removed: 'removeu um cargo de',
  message_deleted: 'excluiu uma mensagem de',
}

function formatLog(log: LogWithProfiles): string {
  const actorName = log.actor?.display_name || log.actor?.username || 'Alguém'
  const targetName = log.target?.display_name || log.target?.username
  const verb = ACTION_LABELS[log.action] ?? log.action

  if (log.action === 'role_created' || log.action === 'role_deleted') {
    const name = (log.metadata as { name?: string } | null)?.name
    return `${actorName} ${verb} "${name ?? '?'}"`
  }
  return targetName ? `${actorName} ${verb} ${targetName}` : `${actorName} ${verb}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function ModerationLogModal({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const { logs, bans, permissions, loading, unbanMember } = useModeration(serverId)
  const [tab, setTab] = useState<'log' | 'bans'>('log')

  return (
    <Modal title="Moderação" onClose={onClose} maxWidth="max-w-lg">
      <div className="flex gap-2 mb-4 bg-discord-darker rounded-lg p-1">
        <button
          onClick={() => setTab('log')}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === 'log' ? 'bg-discord-lighter text-white' : 'text-discord-text-muted hover:text-white'
          }`}
        >
          Registro
        </button>
        {permissions.ban_members && (
          <button
            onClick={() => setTab('bans')}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'bans' ? 'bg-discord-lighter text-white' : 'text-discord-text-muted hover:text-white'
            }`}
          >
            Banidos ({bans.length})
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tab === 'log' ? (
        logs.length === 0 ? (
          <p className="text-sm text-discord-text-muted">Nenhuma ação de moderação registrada ainda.</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="px-3 py-2 rounded hover:bg-white/5">
                <p className="text-sm text-discord-text">{formatLog(log)}</p>
                {log.reason && <p className="text-xs text-discord-text-muted mt-0.5">Motivo: {log.reason}</p>}
                <p className="text-xs text-discord-text-muted mt-0.5">{formatDate(log.created_at)}</p>
              </div>
            ))}
          </div>
        )
      ) : bans.length === 0 ? (
        <p className="text-sm text-discord-text-muted">Ninguém banido.</p>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {bans.map((b) => (
            <div key={b.user_id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-white/5">
              <Avatar name={b.profile.username} avatarUrl={b.profile.avatar_url} size={32} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{b.profile.display_name || b.profile.username}</p>
                {b.reason && <p className="text-xs text-discord-text-muted truncate">Motivo: {b.reason}</p>}
              </div>
              <button
                onClick={() => unbanMember(b.user_id)}
                className="text-xs px-3 py-1 rounded bg-discord-darker text-discord-text hover:bg-discord-lighter transition-colors shrink-0"
              >
                Desbanir
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
