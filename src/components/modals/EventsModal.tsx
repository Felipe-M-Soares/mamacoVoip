import { useState } from 'react'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './settingsUI'
import { Avatar } from '../ui/Avatar'
import { useServerEvents } from '../../hooks/useServerEvents'
import { useAuth } from '../../hooks/useAuth'
import type { Channel, Profile } from '../../types/database'

function formatEventDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function EventsModal({
  serverId,
  channels,
  canCreate,
  membersById,
  onClose,
}: {
  serverId: string
  channels: Channel[]
  canCreate: boolean
  membersById: Record<string, Profile>
  onClose: () => void
}) {
  const { user } = useAuth()
  const { events, rsvpsByEvent, createEvent, deleteEvent, toggleRsvp } = useServerEvents(serverId)
  const [showCreate, setShowCreate] = useState(false)
  // Evento aguardando confirmação de exclusão (no lugar do confirm() nativo).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const now = Date.now()
  const upcoming = events.filter((e) => new Date(e.starts_at).getTime() >= now)
  const past = events.filter((e) => new Date(e.starts_at).getTime() < now)

  return (
    <Modal title="Eventos do servidor" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-5">
        {canCreate && !showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full h-11 rounded-xl border border-dashed border-[var(--color-line-strong)] text-[14px] font-medium text-discord-text-muted hover:text-white hover:border-discord-blurple/60 hover:bg-discord-blurple/[0.06] transition-colors flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Criar evento
          </button>
        )}

        {showCreate && (
          <CreateEventForm
            channels={channels}
            onCancel={() => setShowCreate(false)}
            onCreate={async (input) => {
              const { error } = await createEvent(input)
              if (!error) setShowCreate(false)
              return { error }
            }}
          />
        )}

        <div>
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-discord-text-muted mb-2.5">
            Próximos <span className="chip !py-0">{upcoming.length}</span>
          </h3>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={
                <>
                  <rect x="3.5" y="5" width="17" height="15" rx="3" />
                  <path d="M3.5 10h17M8 3v4M16 3v4" />
                </>
              }
              title="Nenhum evento agendado ainda"
              hint={canCreate ? 'Crie o primeiro pra galera confirmar presença.' : undefined}
            />
          ) : (
            <div className="space-y-2.5">
              {upcoming.map((event) => {
                const attendees = rsvpsByEvent[event.id] ?? []
                const going = user ? attendees.includes(user.id) : false
                const channel = channels.find((c) => c.id === event.channel_id)
                const d = new Date(event.starts_at)
                return (
                  <div key={event.id} className="rounded-2xl bg-white/[0.02] border border-[var(--color-line)] p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-12 shrink-0 rounded-xl overflow-hidden border border-[var(--color-line)] text-center">
                        <div className="bg-brand-gradient text-[10px] font-bold uppercase text-white py-0.5">
                          {d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
                        </div>
                        <div className="font-display text-lg font-semibold text-white py-0.5 bg-discord-darker">{d.getDate()}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold text-white truncate">{event.name}</p>
                        <p className="text-[12.5px] text-discord-blurple font-medium">{formatEventDate(event.starts_at)}</p>
                        {channel && <p className="text-[12px] text-discord-text-muted mt-0.5">🔊 {channel.name}</p>}
                        {event.description && (
                          <p className="text-[13px] text-discord-text-muted mt-1.5 leading-relaxed">{event.description}</p>
                        )}
                      </div>
                      {(event.created_by === user?.id || canCreate) && (
                        <button
                          onClick={() => setPendingDeleteId(event.id)}
                          className="icon-btn w-8 h-8 shrink-0 hover:!text-rose-400 hover:!bg-rose-500/10"
                          title="Excluir evento"
                          aria-label="Excluir evento"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                          </svg>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-3.5 pt-3 border-t border-[var(--color-line)]">
                      <div className="flex items-center">
                        <div className="flex -space-x-1.5">
                          {attendees.slice(0, 5).map((uid) => (
                            <span key={uid} className="rounded-full ring-2 ring-[var(--color-elevated)]">
                              <Avatar name={membersById[uid]?.username ?? '?'} avatarUrl={membersById[uid]?.avatar_url} size={22} />
                            </span>
                          ))}
                        </div>
                        <span className="pl-2.5 text-[12px] text-discord-text-muted">
                          {attendees.length > 0
                            ? `${attendees.length} confirmado${attendees.length !== 1 ? 's' : ''}`
                            : 'Ninguém confirmou ainda'}
                        </span>
                      </div>
                      <button
                        onClick={() => toggleRsvp(event.id)}
                        aria-pressed={going}
                        className={`h-8 px-3.5 text-[13px] rounded-full font-medium transition-colors ${
                          going
                            ? 'bg-discord-green/15 text-discord-green border border-discord-green/30'
                            : 'btn-secondary !rounded-full'
                        }`}
                      >
                        {going ? '✓ Confirmado' : 'Tenho interesse'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {past.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-discord-text-muted mb-2">Passados</h3>
            <div className="rounded-xl border border-[var(--color-line)] divide-y divide-[var(--color-line)] overflow-hidden">
              {past.map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white/[0.015]">
                  <span className="text-[13.5px] text-discord-text-muted truncate">{event.name}</span>
                  <span className="text-[12px] text-discord-text-muted shrink-0">{formatEventDate(event.starts_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {pendingDeleteId && (
        <ConfirmDialog
          title="Excluir evento"
          message="Excluir esse evento?"
          confirmLabel="Excluir"
          danger
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => {
            deleteEvent(pendingDeleteId)
            setPendingDeleteId(null)
          }}
        />
      )}
    </Modal>
  )
}

function CreateEventForm({
  channels,
  onCancel,
  onCreate,
}: {
  channels: Channel[]
  onCancel: () => void
  onCreate: (input: { name: string; description: string | null; startsAt: string; channelId: string | null }) => Promise<{ error: string | null }>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [channelId, setChannelId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const voiceChannels = channels.filter((c) => c.type === 'voice')

  async function handleSubmit() {
    setError(null)
    if (!date || !time) {
      setError('Escolhe uma data e horário.')
      return
    }
    const startsAt = new Date(`${date}T${time}`)
    if (isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() - 60_000) {
      setError('Escolhe uma data/horário no futuro.')
      return
    }
    setSaving(true)
    const { error } = await onCreate({
      name,
      description: description || null,
      startsAt: startsAt.toISOString(),
      channelId: channelId || null,
    })
    setSaving(false)
    if (error) setError(error)
  }

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-discord-blurple/30 p-4 space-y-3 animate-fade-slide-in">
      <p className="text-[14px] font-semibold text-white">Novo evento</p>
      <input
        aria-label="Nome do evento"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome do evento"
        maxLength={100}
        className="w-full px-3 py-2.5 text-sm bg-discord-darker text-discord-text outline-none"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        aria-label="Descrição"
        placeholder="Descrição (opcional)"
        rows={2}
        maxLength={300}
        className="w-full px-3 py-2.5 text-sm bg-discord-darker text-discord-text outline-none resize-none"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          aria-label="Data"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2.5 text-sm bg-discord-darker text-discord-text outline-none"
        />
        <input
          type="time"
          aria-label="Horário"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="px-3 py-2.5 text-sm bg-discord-darker text-discord-text outline-none"
        />
      </div>
      {voiceChannels.length > 0 && (
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          aria-label="Canal de voz"
          className="w-full px-3 py-2.5 text-sm bg-discord-darker text-discord-text outline-none"
        >
          <option value="">Sem canal de voz específico</option>
          {voiceChannels.map((c) => (
            <option key={c.id} value={c.id}>
              🔊 {c.name}
            </option>
          ))}
        </select>
      )}
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary h-9 px-4 text-sm">
          Cancelar
        </button>
        <button onClick={handleSubmit} disabled={saving} className="btn-primary h-9 px-4 text-sm">
          {saving ? 'Criando...' : 'Criar evento'}
        </button>
      </div>
    </div>
  )
}
