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
      <Modal
        title={`Excluir '${server.name}'`}
        onClose={onClose}
        footer={
          <>
            <button onClick={() => setConfirmingDelete(false)} className="btn-secondary h-9 px-4 text-sm">
              Cancelar
            </button>
            <button onClick={handleDelete} disabled={loading} className="btn-danger h-9 px-4 text-sm">
              {loading ? 'Excluindo...' : 'Excluir servidor'}
            </button>
          </>
        }
      >
        <p className="text-[14px] text-mv-muted leading-relaxed">
          Tem certeza que deseja excluir <span className="text-white font-medium">{server.name}</span>? Essa ação
          não pode ser desfeita — todos os canais e mensagens serão perdidos.
        </p>
        {error && <p className="text-sm text-rose-400 mt-3">{error}</p>}
      </Modal>
    )
  }

  const editHint = (
    <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/45 transition-colors">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity bg-black/55 px-2.5 py-1 rounded-full">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        Trocar
      </span>
    </span>
  )

  return (
    <Modal
      title="Configurações do servidor"
      description={`Criado em ${formatDate(server.created_at)}`}
      onClose={onClose}
      maxWidth="max-w-xl"
      footer={
        isOwner ? (
          <>
            <button onClick={onClose} className="btn-secondary h-9 px-4 text-sm">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={loading} className="btn-primary h-9 px-4 text-sm">
              {loading ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {/* Capa + ícone sobreposto, como aparece no topo do servidor */}
        <div>
          <button
            type="button"
            onClick={() => isOwner && bannerInputRef.current?.click()}
            aria-label={bannerPreview ? 'Trocar capa do servidor' : 'Adicionar capa do servidor'}
            className={`group relative w-full aspect-[3/1] rounded-xl overflow-hidden flex items-center justify-center ${
              bannerPreview ? '' : 'bg-mv-canvas/60 border-2 border-dashed border-white/[0.14]'
            } ${isOwner ? 'hover:border-mv-accent/60 transition-colors' : 'cursor-not-allowed opacity-70'}`}
          >
            {bannerPreview ? (
              <img src={bannerPreview} alt="Capa" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <span className="flex flex-col items-center gap-1.5 text-[12px] text-mv-muted text-center px-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <circle cx="8.5" cy="9.5" r="1.5" />
                  <path d="M21 15l-5-5-9 9" />
                </svg>
                Sem capa — clique pra adicionar uma imagem ou GIF
              </span>
            )}
            {isOwner && bannerPreview && editHint}
          </button>
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={handleBannerChange}
            disabled={!isOwner}
          />
          <div className="flex items-end gap-3 px-3 -mt-9 relative">
            <button
              type="button"
              onClick={() => isOwner && fileInputRef.current?.click()}
              aria-label={iconPreview ? 'Trocar ícone do servidor' : 'Adicionar ícone do servidor'}
              className={`group relative w-[76px] h-[76px] shrink-0 rounded-2xl ring-[5px] ring-[var(--color-elevated)] bg-mv-canvas flex items-center justify-center overflow-hidden ${
                isOwner ? '' : 'cursor-not-allowed opacity-70'
              }`}
            >
              {iconPreview ? (
                <img src={iconPreview} alt="Ícone" className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full bg-brand-gradient flex items-center justify-center font-display text-xl font-semibold text-white">
                  {server.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              {isOwner && editHint}
            </button>
            <p className="text-[11px] text-mv-muted pb-1">Capa até 5MB — aceita GIF animado</p>
          </div>
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
          <label htmlFor="server-settings-name" className="field-label">
            Nome do servidor
          </label>
          <input
            id="server-settings-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
            className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none disabled:opacity-60"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="server-settings-description" className="field-label">
              Descrição
            </label>
            <span className="text-[11px] text-mv-muted tabular-nums">{description.length}/300</span>
          </div>
          <textarea
            id="server-settings-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!isOwner}
            maxLength={300}
            rows={3}
            placeholder="Do que se trata este servidor?"
            className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none disabled:opacity-60 resize-none"
          />
        </div>

        {isOwner && (
          <section className="rounded-2xl bg-white/[0.02] border border-[var(--color-line)] p-4">
            <p className="text-[14px] font-semibold text-white">Canal AFK</p>
            <p className="text-[12.5px] text-mv-muted mt-0.5 mb-3">
              Quem ficar inativo (sem mexer o mouse/teclado) numa chamada por muito tempo é movido pra cá
              automaticamente.
            </p>
            <div className="flex gap-2">
              <select
                value={afkChannelId}
                onChange={(e) => setAfkChannelId(e.target.value)}
                aria-label="Canal AFK"
                className="flex-1 min-w-0 px-3 py-2 text-sm bg-mv-canvas text-mv-text outline-none"
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
                  aria-label="Tempo de inatividade"
                  className="px-3 py-2 text-sm bg-mv-canvas text-mv-text outline-none"
                >
                  {[5, 10, 15, 30, 60].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              )}
            </div>
          </section>
        )}

        <EmojiManagementSection serverId={server.id} isOwner={isOwner} />

        {!isOwner && (
          <p className="text-[12.5px] text-mv-muted rounded-lg bg-white/[0.03] border border-[var(--color-line)] px-3 py-2">
            Só o dono do servidor pode alterar nome, descrição e ícone.
          </p>
        )}

        {error && <p className="text-sm text-rose-400">{error}</p>}

        {isOwner && (
          <section className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.04] p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-rose-300">Excluir servidor</p>
              <p className="text-[12.5px] text-mv-muted mt-0.5">Apaga canais e mensagens pra todo mundo.</p>
            </div>
            <button onClick={() => setConfirmingDelete(true)} className="btn-danger h-9 px-4 text-sm shrink-0">
              Excluir
            </button>
          </section>
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
    <section className="rounded-2xl bg-white/[0.02] border border-[var(--color-line)] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[14px] font-semibold text-white">Emojis customizados</p>
        <span className="chip">{emojis.length}</span>
      </div>

      {emojis.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {emojis.map((emoji) => (
            <div key={emoji.id} className="relative group">
              <img
                src={emoji.image_url}
                alt={emoji.name}
                title={`:${emoji.name}:`}
                className="w-10 h-10 rounded-lg bg-mv-canvas border border-[var(--color-line)] object-contain p-1"
              />
              {isOwner && (
                <button
                  onClick={() => deleteEmoji(emoji.id)}
                  title="Remover"
                  aria-label={`Remover :${emoji.name}:`}
                  className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] bg-rose-500 rounded-full text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shadow"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="w-2.5 h-2.5">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
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
            aria-label="Nome do emoji"
            maxLength={32}
            className="flex-1 min-w-0 px-3 py-2 text-sm bg-mv-canvas text-mv-text outline-none"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="h-9 px-4 text-sm btn-secondary shrink-0"
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
      {error && <p className="text-xs text-rose-400 mt-1.5">{error}</p>}
      <p className="text-[11px] text-mv-muted mt-2">
        Até 256KB, aceita GIF animado. Use assim no chat:{' '}
        <code className="font-mono text-mv-text bg-mv-canvas px-1 py-0.5 rounded">:nome_do_emoji:</code>
      </p>
    </section>
  )
}
