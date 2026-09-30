import { useState } from 'react'
import { Modal } from './Modal'
import { EmptyState, ListSkeleton } from './settingsUI'
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
  member_moved: 'moveu',
}

function formatLog(log: LogWithProfiles): string {
  const actorName = log.actor?.display_name || log.actor?.username || 'Alguém'
  const targetName = log.target?.display_name || log.target?.username
  const verb = ACTION_LABELS[log.action] ?? log.action

  if (log.action === 'role_created' || log.action === 'role_deleted') {
    const name = (log.metadata as { name?: string } | null)?.name
    return `${actorName} ${verb} "${name ?? '?'}"`
  }
  if (log.action === 'member_moved') {
    const channelName = (log.metadata as { to_channel_name?: string } | null)?.to_channel_name
    const who = targetName ?? 'alguém'
    return channelName ? `${actorName} ${verb} ${who} para #${channelName}` : `${actorName} ${verb} ${who} de canal de voz`
  }
  return targetName ? `${actorName} ${verb} ${targetName}` : `${actorName} ${verb}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function ModerationLogModal({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const { logs, bans, permissions, loading, unbanMember } = useModeration(serverId)
  const [tab, setTab] = useState<'log' | 'bans'>('log')

  const tabClass = (active: boolean) =>
    `flex-1 h-8 rounded-lg text-[13px] font-medium transition-colors ${
      active ? 'bg-mv-raised text-white shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-mv-muted hover:text-mv-text'
    }`

  return (
    <Modal title="Moderação" onClose={onClose} maxWidth="max-w-lg">
      <div role="tablist" aria-label="Moderação" className="flex gap-1 p-1 mb-4 rounded-xl bg-mv-canvas border border-[var(--color-line)]">
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')} className={tabClass(tab === 'log')}>
          Registro
        </button>
        {permissions.ban_members && (
          <button role="tab" aria-selected={tab === 'bans'} onClick={() => setTab('bans')} className={tabClass(tab === 'bans')}>
            Banidos ({bans.length})
          </button>
        )}
      </div>

      {loading ? (
        <ListSkeleton rows={5} avatar={tab === 'bans'} />
      ) : tab === 'log' ? (
        logs.length === 0 ? (
          <EmptyState
            icon={
              <>
                <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3z" />
                <path d="M9 12h6" />
              </>
            }
            title="Tudo tranquilo por aqui"
            hint="Nenhuma ação de moderação registrada ainda."
          />
        ) : (
          <div className="space-y-0.5 max-h-96 overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="flex gap-3 px-3 py-2.5 rounded-[10px] hover:bg-white/[0.04] transition-colors">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-mv-accent shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-mv-text">{formatLog(log)}</p>
                  {log.reason && <p className="text-[12.5px] text-mv-muted mt-0.5">Motivo: {log.reason}</p>}
                  <p className="text-[11.5px] text-mv-muted mt-0.5">{formatDate(log.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )
      ) : bans.length === 0 ? (
        <EmptyState
          icon={
            <>
              <circle cx="12" cy="12" r="8.5" />
              <path d="m6 6 12 12" />
            </>
          }
          title="Ninguém banido"
        />
      ) : (
        <div className="space-y-0.5 max-h-96 overflow-y-auto">
          {bans.map((b) => (
            <div key={b.user_id} className="flex items-center gap-3 px-3 py-2 rounded-[10px] hover:bg-white/[0.04] transition-colors">
              <Avatar name={b.profile.username} avatarUrl={b.profile.avatar_url} size={32} />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-white truncate">{b.profile.display_name || b.profile.username}</p>
                {b.reason && <p className="text-[12px] text-mv-muted truncate">Motivo: {b.reason}</p>}
              </div>
              <button onClick={() => unbanMember(b.user_id)} className="btn-secondary h-8 px-3 text-[13px] shrink-0">
                Desbanir
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
