import { useState } from 'react'
import { Modal } from './Modal'
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

  const now = Date.now()
  const upcoming = events.filter((e) => new Date(e.starts_at).getTime() >= now)
  const past = events.filter((e) => new Date(e.starts_at).getTime() < now)

  return (
    <Modal title="Eventos do servidor" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        {canCreate && !showCreate && (
          <button onClick={() => setShowCreate(true)} className="w-full py-2.5 rounded btn-primary text-sm">
            + Criar evento
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
          <h3 className="text-xs font-bold uppercase text-discord-text-muted mb-2">
            Próximos ({upcoming.length})
          </h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-discord-text-muted">Nenhum evento agendado ainda.</p>
          ) : (
            <div className="space-y-2">
              {upcoming.map((event) => {
                const attendees = rsvpsByEvent[event.id] ?? []
                const going = user ? attendees.includes(user.id) : false
                const channel = channels.find((c) => c.id === event.channel_id)
                return (
                  <div key={event.id} className="bg-discord-darker rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{event.name}</p>
                        <p className="text-xs text-discord-blurple">{formatEventDate(event.starts_at)}</p>
                        {channel && <p className="text-xs text-discord-text-muted mt-0.5">em #{channel.name}</p>}
                        {event.description && (
                          <p className="text-xs text-discord-text-muted mt-1">{event.description}</p>
                        )}
                      </div>
                      {(event.created_by === user?.id || canCreate) && (
                        <button
                          onClick={() => confirm('Excluir esse evento?') && deleteEvent(event.id)}
                          className="text-discord-text-muted hover:text-red-400 shrink-0"
                          title="Excluir evento"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                            <path d="M6 7h12l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7zm3-3h6l1 2H8l1-2z" />
                          </svg>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      <div className="flex -space-x-1.5">
                        {attendees.slice(0, 5).map((uid) => (
                          <Avatar
                            key={uid}
                            name={membersById[uid]?.username ?? '?'}
                            avatarUrl={membersById[uid]?.avatar_url}
                            size={22}
                          />
                        ))}
                        {attendees.length > 0 && (
                          <span className="pl-2.5 text-xs text-discord-text-muted self-center">
                            {attendees.length} confirmado{attendees.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => toggleRsvp(event.id)}
                        className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                          going ? 'bg-discord-green/20 text-discord-green' : 'btn-secondary'
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
            <h3 className="text-xs font-bold uppercase text-discord-text-muted mb-2">Passados</h3>
            <div className="space-y-1">
              {past.map((event) => (
                <div key={event.id} className="flex items-center justify-between px-3 py-2 rounded bg-discord-darker/50">
                  <span className="text-sm text-discord-text-muted truncate">{event.name}</span>
                  <span className="text-xs text-discord-text-muted shrink-0">{formatEventDate(event.starts_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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
    <div className="bg-discord-darker rounded-lg p-3 space-y-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome do evento"
        maxLength={100}
        className="w-full px-3 py-2 text-sm rounded bg-discord-lighter text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Descrição (opcional)"
        rows={2}
        maxLength={300}
        className="w-full px-3 py-2 text-sm rounded bg-discord-lighter text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple resize-none"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 text-sm rounded bg-discord-lighter text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="px-3 py-2 text-sm rounded bg-discord-lighter text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
        />
      </div>
      {voiceChannels.length > 0 && (
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded bg-discord-lighter text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
        >
          <option value="">Sem canal de voz específico</option>
          {voiceChannels.map((c) => (
            <option key={c.id} value={c.id}>
              🔊 {c.name}
            </option>
          ))}
        </select>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2 rounded btn-secondary text-sm">
          Cancelar
        </button>
        <button onClick={handleSubmit} disabled={saving} className="flex-1 py-2 rounded btn-primary text-sm disabled:opacity-60">
          {saving ? 'Criando...' : 'Criar evento'}
        </button>
      </div>
    </div>
  )
}
