import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useChannels } from '../../hooks/useChannels'
import { useRoles } from '../../hooks/useRoles'
import { useChannelRoleAccess } from '../../hooks/useChannelRoleAccess'
import type { Channel } from '../../types/database'

export function EditChannelModal({
  channel,
  serverId,
  onClose,
}: {
  channel: Channel
  serverId: string
  onClose: () => void
}) {
  const { updateChannel, deleteChannel } = useChannels()
  const { roles } = useRoles(serverId)
  const { roleIds: allowedRoleIds, setAllowedRoles } = useChannelRoleAccess(channel.id)
  const [isRestricted, setIsRestricted] = useState(channel.is_restricted)
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([])
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic ?? '')

  useEffect(() => {
    setSelectedRoleIds(allowedRoleIds)
  }, [allowedRoleIds])
  const [isStage, setIsStage] = useState(channel.is_stage)
  const [userLimit, setUserLimit] = useState(channel.user_limit)
  const [slowmodeSeconds, setSlowmodeSeconds] = useState(channel.slowmode_seconds)
  const [isSpoiler, setIsSpoiler] = useState(channel.is_spoiler)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-')
    if (cleanName.length < 1) {
      setError('O nome não pode ficar vazio.')
      return
    }
    setLoading(true)
    const { error } = await updateChannel(channel.id, {
      name: cleanName,
      topic: topic.trim() || null,
      is_stage: channel.type === 'voice' ? isStage : channel.is_stage,
      user_limit: channel.type === 'voice' ? userLimit : channel.user_limit,
      slowmode_seconds: channel.type === 'text' ? slowmodeSeconds : channel.slowmode_seconds,
      is_spoiler: channel.type === 'text' ? isSpoiler : channel.is_spoiler,
      is_restricted: isRestricted,
    })
    if (!error && isRestricted) {
      const { error: rolesError } = await setAllowedRoles(selectedRoleIds)
      if (rolesError) {
        setLoading(false)
        setError(rolesError)
        return
      }
    }
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  async function handleDelete() {
    setLoading(true)
    const { error } = await deleteChannel(channel.id)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  if (confirmingDelete) {
    return (
      <Modal title={`Excluir canal '${channel.name}'`} onClose={onClose}>
        <p className="text-sm text-discord-text-muted">
          Tem certeza que deseja excluir{' '}
          <span className="text-white font-medium">
            {channel.type === 'text' ? '#' : '🔊 '}
            {channel.name}
          </span>
          ? Essa ação não pode ser desfeita.
        </p>
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        <div className="flex justify-end gap-3 mt-5">
          <button
            onClick={() => setConfirmingDelete(false)}
            className="px-4 py-2 text-sm text-discord-text-muted hover:underline"
          >
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="px-4 py-2 text-sm rounded btn-danger disabled:opacity-60"
          >
            {loading ? 'Excluindo...' : 'Excluir canal'}
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Editar canal" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
            Nome do canal
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-discord-text-muted">
              {channel.type === 'text' ? '#' : '🔊'}
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full pl-8 pr-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            />
          </div>
        </div>

        {channel.type === 'text' && (
          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              Tópico do canal
            </label>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Uma frase curta descrevendo o assunto do canal (opcional)"
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple resize-none"
            />
          </div>
        )}

        {channel.type === 'text' && (
          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              Modo lento
            </label>
            <p className="text-[10px] text-discord-text-muted mb-2">
              Tempo mínimo entre mensagens da mesma pessoa neste canal. Donos do servidor não são afetados.
            </p>
            <select
              value={slowmodeSeconds}
              onChange={(e) => setSlowmodeSeconds(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            >
              <option value={0}>Desativado</option>
              <option value={5}>5 segundos</option>
              <option value={10}>10 segundos</option>
              <option value={30}>30 segundos</option>
              <option value={60}>1 minuto</option>
              <option value={300}>5 minutos</option>
              <option value={900}>15 minutos</option>
            </select>
          </div>
        )}

        {channel.type === 'text' && (
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isSpoiler}
              onChange={(e) => setIsSpoiler(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-discord-blurple shrink-0"
            />
            <span className="text-xs text-discord-text-muted">
              <span className="text-discord-text font-medium">Canal spoiler</span> — o conteúdo fica borrado até a
              pessoa clicar pra revelar (bom pra spoiler de jogo, filme, série)
            </span>
          </label>
        )}

        {channel.type === 'voice' && (
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isStage}
              onChange={(e) => setIsStage(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-discord-blurple shrink-0"
            />
            <span className="text-xs text-discord-text-muted">
              <span className="text-discord-text font-medium">Canal Palco</span> — só donos/moderadores podem
              falar, o resto só escuta (bom pra anúncios, palestras, eventos)
            </span>
          </label>
        )}

        {channel.type === 'voice' && (
          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-1.5">
              Limite de pessoas
            </label>
            <select
              value={userLimit}
              onChange={(e) => setUserLimit(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            >
              <option value={0}>Sem limite</option>
              {[2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n} pessoas
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isRestricted}
              onChange={(e) => setIsRestricted(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-discord-blurple shrink-0"
            />
            <span className="text-xs text-discord-text-muted">
              <span className="text-discord-text font-medium">Canal restrito</span> — só cargos escolhidos abaixo
              conseguem ver esse canal (donos e quem gerencia canais sempre veem)
            </span>
          </label>

          {isRestricted && (
            <div className="mt-2.5 pl-6 space-y-1.5 max-h-40 overflow-y-auto">
              {roles.length === 0 ? (
                <p className="text-xs text-discord-text-muted">
                  Esse servidor ainda não tem cargos — crie um cargo primeiro na aba "Cargos".
                </p>
              ) : (
                roles.map((role) => (
                  <label key={role.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedRoleIds.includes(role.id)}
                      onChange={(e) =>
                        setSelectedRoleIds((prev) =>
                          e.target.checked ? [...prev, role.id] : prev.filter((id) => id !== role.id)
                        )
                      }
                      className="w-3.5 h-3.5 accent-discord-blurple shrink-0"
                    />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                    <span className="text-xs text-discord-text">{role.name}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
        >
          {loading ? 'Salvando...' : 'Salvar alterações'}
        </button>

        <button
          onClick={() => setConfirmingDelete(true)}
          className="w-full py-2.5 rounded border border-red-600 text-red-500 font-medium hover:bg-red-600/10 transition-colors"
        >
          Excluir canal
        </button>
      </div>
    </Modal>
  )
}
