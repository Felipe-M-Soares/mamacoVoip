import { useEffect, useState } from 'react'
import { channelNameFor } from '../../lib/channelName'
import { Modal } from './Modal'
import { Toggle } from '../ui/Toggle'
import { CheckMark, ToggleRow } from './settingsUI'
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
  const [isNsfw, setIsNsfw] = useState(!!channel.is_nsfw)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    const cleanName = channelNameFor(channel.type, name)
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
      // Só manda is_nsfw quando mudou: editar outros campos continua
      // funcionando num banco que ainda não rodou a migration 015.
      ...(isNsfw !== !!channel.is_nsfw ? { is_nsfw: isNsfw } : {}),
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
      <Modal
        title={`Excluir canal '${channel.name}'`}
        onClose={onClose}
        maxWidth="max-w-sm"
        footer={
          <>
            <button onClick={() => setConfirmingDelete(false)} className="btn-secondary h-9 px-4 text-sm">
              Cancelar
            </button>
            <button onClick={handleDelete} disabled={loading} className="btn-danger h-9 px-4 text-sm">
              {loading ? 'Excluindo...' : 'Excluir canal'}
            </button>
          </>
        }
      >
        <p className="text-[14px] text-mv-muted leading-relaxed">
          Tem certeza que deseja excluir{' '}
          <span className="text-white font-medium">
            {channel.type === 'text' ? '#' : '🔊 '}
            {channel.name}
          </span>
          ? Essa ação não pode ser desfeita.
        </p>
        {error && <p className="text-sm text-rose-400 mt-3">{error}</p>}
      </Modal>
    )
  }

  return (
    <Modal
      title="Editar canal"
      onClose={onClose}
      footer={
        <>
          <button
            onClick={() => setConfirmingDelete(true)}
            className="mr-auto h-9 px-3 -ml-2 rounded-[10px] text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            Excluir canal
          </button>
          <button onClick={onClose} className="btn-secondary h-9 px-4 text-sm">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={loading} className="btn-primary h-9 px-4 text-sm">
            {loading ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="edit-channel-name" className="field-label">
            Nome do canal
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mv-muted pointer-events-none" aria-hidden="true">
              {channel.type === 'text' ? '#' : '🔊'}
            </span>
            <input
              id="edit-channel-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full pl-8 pr-3 py-2.5 bg-mv-canvas text-mv-text outline-none"
            />
          </div>
        </div>

        {channel.type === 'text' && (
          <div>
            <label htmlFor="edit-channel-topic" className="field-label">
              Tópico do canal
            </label>
            <textarea
              id="edit-channel-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Uma frase curta descrevendo o assunto do canal (opcional)"
              className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none resize-none"
            />
          </div>
        )}

        {channel.type === 'text' && (
          <div>
            <label htmlFor="edit-channel-slowmode" className="field-label">
              Modo lento
            </label>
            <select
              id="edit-channel-slowmode"
              value={slowmodeSeconds}
              onChange={(e) => setSlowmodeSeconds(Number(e.target.value))}
              className="w-full px-3 py-2.5 text-sm bg-mv-canvas text-mv-text outline-none"
            >
              <option value={0}>Desativado</option>
              <option value={5}>5 segundos</option>
              <option value={10}>10 segundos</option>
              <option value={30}>30 segundos</option>
              <option value={60}>1 minuto</option>
              <option value={300}>5 minutos</option>
              <option value={900}>15 minutos</option>
            </select>
            <p className="text-[12px] text-mv-muted mt-1.5">
              Tempo mínimo entre mensagens da mesma pessoa neste canal. Donos do servidor não são afetados.
            </p>
          </div>
        )}

        {channel.type === 'text' && (
          <ToggleRow
            title="Canal spoiler"
            description="O conteúdo fica borrado até a pessoa clicar pra revelar (bom pra spoiler de jogo, filme, série)"
          >
            <Toggle label="Canal spoiler" checked={isSpoiler} onChange={setIsSpoiler} />
          </ToggleRow>
        )}

        {channel.type === 'text' && (
          <ToggleRow
            title="Canal +18 (restrição de idade)"
            description="Quem abrir o canal precisa confirmar que tem 18 anos ou mais antes de ver o conteúdo. O seletor de GIF aqui passa a incluir GIFs com classificação R (o máximo da GIPHY). Use só pra conteúdo adulto permitido pelas regras do servidor."
          >
            <Toggle label="Canal +18 (restrição de idade)" checked={isNsfw} onChange={setIsNsfw} />
          </ToggleRow>
        )}

        {channel.type === 'voice' && (
          <ToggleRow
            title="Canal Palco"
            description="Só donos/moderadores podem falar, o resto só escuta (bom pra anúncios, palestras, eventos)"
          >
            <Toggle label="Canal Palco" checked={isStage} onChange={setIsStage} />
          </ToggleRow>
        )}

        {channel.type === 'voice' && (
          <div>
            <label htmlFor="edit-channel-limit" className="field-label">
              Limite de pessoas
            </label>
            <select
              id="edit-channel-limit"
              value={userLimit}
              onChange={(e) => setUserLimit(Number(e.target.value))}
              className="w-full px-3 py-2.5 text-sm bg-mv-canvas text-mv-text outline-none"
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

        <div className="rounded-xl bg-white/[0.02] border border-[var(--color-line)]">
          <div className="flex items-center justify-between gap-4 px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-white flex items-center gap-1.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-mv-muted" aria-hidden="true">
                  <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
                  <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
                </svg>
                Canal restrito
              </p>
              <p className="text-[12.5px] text-mv-muted mt-0.5 leading-snug">
                Só cargos escolhidos abaixo conseguem ver esse canal (donos e quem gerencia canais sempre veem)
              </p>
            </div>
            <Toggle label="Canal restrito" checked={isRestricted} onChange={setIsRestricted} />
          </div>

          {isRestricted && (
            <div className="border-t border-[var(--color-line)] p-2 space-y-0.5 max-h-44 overflow-y-auto animate-fade-slide-in">
              {roles.length === 0 ? (
                <p className="text-[12.5px] text-mv-muted px-2 py-2">
                  Esse servidor ainda não tem cargos — crie um cargo primeiro na aba "Cargos".
                </p>
              ) : (
                roles.map((role) => {
                  const checked = selectedRoleIds.includes(role.id)
                  return (
                    <label
                      key={role.id}
                      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                        checked ? 'bg-white/[0.05]' : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelectedRoleIds((prev) =>
                            e.target.checked ? [...prev, role.id] : prev.filter((id) => id !== role.id)
                          )
                        }
                        className="sr-only peer"
                      />
                      <span className="rounded-md peer-focus-visible:ring-2 peer-focus-visible:ring-mv-accent">
                        <CheckMark checked={checked} />
                      </span>
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                      <span className="text-[13.5px] text-mv-text">{role.name}</span>
                    </label>
                  )
                })
              )}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  )
}
