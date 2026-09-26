import { useRef, useState } from 'react'
import { Modal } from './Modal'
import { useServers } from '../../hooks/useServers'
import { useServerEmojis } from '../../hooks/useServerEmojis'
import type { Server, Channel } from '../../types/database'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function ServerSettingsModal({
  server,
  isOwner,
  channels,
  onClose,
  onDeleted,
}: {
  server: Server
  isOwner: boolean
  channels: Channel[]
  onClose: () => void
  onDeleted: () => void
}) {
  const { updateServer, deleteServer } = useServers()
  const [name, setName] = useState(server.name)
  const [description, setDescription] = useState(server.description ?? '')
  const [afkChannelId, setAfkChannelId] = useState(server.afk_channel_id ?? '')
  const [afkTimeoutMinutes, setAfkTimeoutMinutes] = useState(server.afk_timeout_minutes)
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(server.icon_url)
  const [bannerFile, setBannerFile] = useState<File | null>(null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(server.banner_url)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  function handleIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setIconFile(file)
    setIconPreview(URL.createObjectURL(file))
  }

  function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('A capa precisa ter no máximo 5MB.')
      return
    }
    setBannerFile(file)
    setBannerPreview(URL.createObjectURL(file))
  }

  async function handleSave() {
    setError(null)
    if (description.length > 300) {
      setError('A descrição pode ter no máximo 300 caracteres.')
      return
    }
    setLoading(true)
    const { error } = await updateServer(server.id, {
      name,
      description: description.trim() || null,
      iconFile,
      bannerFile,
      afkChannelId: afkChannelId || null,
      afkTimeoutMinutes,
    })
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  async function handleDelete() {
    setLoading(true)
    const { error } = await deleteServer(server.id)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onDeleted()
  }

  if (confirmingDelete) {
    return (
      <Modal title={`Excluir '${server.name}'`} onClose={onClose}>
        <p className="text-sm text-discord-text-muted">
          Tem certeza que deseja excluir <span className="text-white font-medium">{server.name}</span>? Essa ação
          não pode ser desfeita — todos os canais e mensagens serão perdidos.
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
            {loading ? 'Excluindo...' : 'Excluir servidor'}
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Configurações do servidor" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
            Capa do servidor
          </label>
          <button
            onClick={() => isOwner && bannerInputRef.current?.click()}
            className={`w-full aspect-[3/1] rounded-lg bg-discord-darker border-2 border-dashed border-discord-text-muted flex items-center justify-center overflow-hidden ${
              isOwner ? 'hover:border-discord-blurple transition-colors' : 'cursor-not-allowed opacity-70'
            }`}
          >
            {bannerPreview ? (
              <img src={bannerPreview} alt="Capa" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs text-discord-text-muted text-center px-2">
                Sem capa — clique pra adicionar uma imagem ou GIF
              </span>
            )}
          </button>
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={handleBannerChange}
            disabled={!isOwner}
          />
          <p className="text-[10px] text-discord-text-muted mt-1">Até 5MB — aceita GIF animado</p>
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => isOwner && fileInputRef.current?.click()}
            className={`w-20 h-20 rounded-full bg-discord-darker border-2 border-dashed border-discord-text-muted flex items-center justify-center overflow-hidden ${
              isOwner ? 'hover:border-discord-blurple transition-colors' : 'cursor-not-allowed opacity-70'
            }`}
          >
            {iconPreview ? (
              <img src={iconPreview} alt="Ícone" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs text-discord-text-muted text-center px-2">Sem ícone</span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleIconChange}
            disabled={!isOwner}
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
            Nome do servidor
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
            className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple disabled:opacity-60"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <label className="block text-xs font-bold uppercase text-discord-text-muted">
              Descrição
            </label>
            <span className="text-xs text-discord-text-muted">{description.length}/300</span>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!isOwner}
            maxLength={300}
            rows={3}
            placeholder="Do que se trata este servidor?"
            className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple disabled:opacity-60 resize-none"
          />
        </div>

        {isOwner && (
          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              Canal AFK
            </label>
            <p className="text-[10px] text-discord-text-muted mb-2">
              Quem ficar inativo (sem mexer o mouse/teclado) numa chamada por muito tempo é movido pra cá
              automaticamente.
            </p>
            <div className="flex gap-2">
              <select
                value={afkChannelId}
                onChange={(e) => setAfkChannelId(e.target.value)}
                className="flex-1 px-3 py-2 text-sm rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
              >
                <option value="">Desativado</option>
                {channels
                  .filter((c) => c.type === 'voice')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      🔊 {c.name}
                    </option>
                  ))}
              </select>
              {afkChannelId && (
                <select
                  value={afkTimeoutMinutes}
                  onChange={(e) => setAfkTimeoutMinutes(Number(e.target.value))}
                  className="px-3 py-2 text-sm rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
                >
                  {[5, 10, 15, 30, 60].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        <EmojiManagementSection serverId={server.id} isOwner={isOwner} />

        <div className="bg-discord-darker rounded-lg p-3 text-xs text-discord-text-muted">
          Servidor criado em {formatDate(server.created_at)}
        </div>

        {!isOwner && (
          <p className="text-xs text-discord-text-muted">
            Só o dono do servidor pode alterar nome, descrição e ícone.
          </p>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {isOwner && (
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
          >
            {loading ? 'Salvando...' : 'Salvar alterações'}
          </button>
        )}

        {isOwner && (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="w-full py-2.5 rounded border border-red-600 text-red-500 font-medium hover:bg-red-600/10 transition-colors"
          >
            Excluir servidor
          </button>
        )}
      </div>
    </Modal>
  )
}

function EmojiManagementSection({ serverId, isOwner }: { serverId: string; isOwner: boolean }) {
  const { emojis, uploadEmoji, deleteEmoji } = useServerEmojis(serverId)
  const [name, setName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!name.trim()) {
      setError('Digite um nome pro emoji antes de escolher a imagem.')
      return
    }
    setError(null)
    setUploading(true)
    const { error } = await uploadEmoji(name, file)
    setUploading(false)
    if (error) {
      setError(error)
      return
    }
    setName('')
  }

  return (
    <div>
      <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
        Emojis customizados ({emojis.length})
      </label>

      {emojis.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {emojis.map((emoji) => (
            <div key={emoji.id} className="relative group">
              <img
                src={emoji.image_url}
                alt={emoji.name}
                title={`:${emoji.name}:`}
                className="w-9 h-9 rounded bg-discord-darker object-contain p-1"
              />
              {isOwner && (
                <button
                  onClick={() => deleteEmoji(emoji.id)}
                  title="Remover"
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 rounded-full text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {isOwner && (
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="nome_do_emoji"
            maxLength={32}
            className="flex-1 px-3 py-2 text-sm rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-2 text-sm rounded btn-secondary disabled:opacity-60 shrink-0"
          >
            {uploading ? 'Enviando...' : 'Adicionar'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={handleFileSelected}
          />
        </div>
      )}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      <p className="text-[10px] text-discord-text-muted mt-1">
        Até 256KB, aceita GIF animado. Use assim no chat: <code>:nome_do_emoji:</code>
      </p>
    </div>
  )
}
