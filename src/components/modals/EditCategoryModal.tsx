import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useChannels } from '../../hooks/useChannels'
import type { Category } from '../../types/database'
import { GameIcon } from '../ui/GameIcon'
import { KNOWN_GAMES, guessGameFromName } from '../../lib/gameIcons'

const AUTO = '__auto__'
const NONE = '__none__'
const OTHER = '__other__'

function initialChoice(game: string | null | undefined): { choice: string; other: string } {
  if (game === '') return { choice: NONE, other: '' }
  if (!game) return { choice: AUTO, other: '' }
  return KNOWN_GAMES.includes(game) ? { choice: game, other: '' } : { choice: OTHER, other: game }
}

// Editar (renomear) ou excluir uma categoria da barra de canais.
export function EditCategoryModal({
  category,
  startDeleting = false,
  onClose,
}: {
  category: Category
  startDeleting?: boolean
  onClose: () => void
}) {
  const { updateCategory, setCategoryGame, setCategoryIcon, deleteCategory, channels } = useChannels()
  // Imagem própria: undefined = sem mudança; null = remover; File = nova.
  const [pendingIcon, setPendingIcon] = useState<File | null | undefined>(undefined)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const previewRef = useRef<string | null>(null)
  function choosePendingIcon(f: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = f ? URL.createObjectURL(f) : null
    setPendingPreview(previewRef.current)
    setPendingIcon(f)
  }
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    },
    []
  )
  const currentIcon = pendingIcon === undefined ? (category.icon_url ?? null) : pendingPreview
  const [name, setName] = useState(category.name)
  const [choice, setChoice] = useState(() => initialChoice(category.game).choice)
  const [otherGame, setOtherGame] = useState(() => initialChoice(category.game).other)
  const [confirmingDelete, setConfirmingDelete] = useState(startDeleting)
  const [alsoChannels, setAlsoChannels] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inside = channels.filter((c) => c.category_id === category.id)

  async function handleSave() {
    setError(null)
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 100)
    if (!clean) {
      setError('Dê um nome à categoria.')
      return
    }
    const game = choice === AUTO ? null : choice === NONE ? '' : choice === OTHER ? otherGame.trim().slice(0, 80) || null : choice
    setLoading(true)
    const { error } = clean !== category.name ? await updateCategory(category.id, clean) : { error: null }
    const gameRes = !error && game !== (category.game ?? null) ? await setCategoryGame(category.id, game) : { error: null }
    const iconRes =
      !error && !gameRes.error && pendingIcon !== undefined ? await setCategoryIcon(category.id, pendingIcon) : { error: null }
    setLoading(false)
    if (error || gameRes.error || iconRes.error) setError(error ?? gameRes.error ?? iconRes.error)
    else onClose()
  }

  const autoGame = guessGameFromName(name)
  const previewGame =
    choice === AUTO ? autoGame : choice === NONE ? null : choice === OTHER ? otherGame.trim() || null : choice

  async function handleDelete() {
    setError(null)
    setLoading(true)
    const { error } = await deleteCategory(category.id, alsoChannels)
    setLoading(false)
    if (error) setError(error)
    else onClose()
  }

  if (confirmingDelete) {
    return (
      <Modal
        title={`Excluir categoria '${category.name}'`}
        onClose={onClose}
        maxWidth="max-w-sm"
        footer={
          <>
            <button onClick={() => setConfirmingDelete(false)} className="btn-secondary h-9 px-4 text-sm">
              Cancelar
            </button>
            <button onClick={handleDelete} disabled={loading} className="btn-danger h-9 px-4 text-sm">
              {loading ? 'Excluindo...' : 'Excluir categoria'}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-[13.5px] text-mv-muted">
          {inside.length === 0 ? (
            <p>A categoria está vazia. Isso não pode ser desfeito.</p>
          ) : (
            <>
              <p>
                {alsoChannels
                  ? `Os ${inside.length} canais dela também serão excluídos, com todas as mensagens. Isso não pode ser desfeito.`
                  : `Os ${inside.length} canais dela continuam no servidor, só que sem categoria.`}
              </p>
              <label className="flex items-start gap-2 cursor-pointer text-mv-text">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-rose-500"
                  checked={alsoChannels}
                  onChange={(e) => setAlsoChannels(e.target.checked)}
                />
                <span>Excluir também os canais dela</span>
              </label>
            </>
          )}
          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Editar categoria"
      onClose={onClose}
      footer={
        <>
          <button onClick={() => setConfirmingDelete(true)} className="btn-danger h-9 px-4 text-sm mr-auto">
            Excluir
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
          <label htmlFor="edit-category-name" className="field-label">
            Nome da categoria
          </label>
          <input
            id="edit-category-name"
            type="text"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave()
            }}
            className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none"
          />
        </div>
        <div>
          <label htmlFor="edit-category-game" className="field-label">
            Ícone de jogo
          </label>
          <div className="flex items-center gap-2">
            <span className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg bg-mv-canvas">
              {currentIcon ? (
                <GameIcon game={previewGame ?? name} imageUrl={currentIcon} size={32} title="Imagem própria" />
              ) : previewGame ? (
                <GameIcon game={previewGame} size={32} title={previewGame} className="rounded-md" />
              ) : (
                <span className="text-mv-muted text-xs">—</span>
              )}
            </span>
            <select
              id="edit-category-game"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2.5 bg-mv-canvas text-mv-text outline-none rounded-lg"
            >
              <option value={AUTO}>Automático pelo nome{autoGame ? ` (${autoGame})` : ' (nenhum reconhecido)'}</option>
              <option value={NONE}>Sem ícone</option>
              {KNOWN_GAMES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value={OTHER}>Outro jogo (digitar)...</option>
            </select>
          </div>
          {choice === OTHER && (
            <input
              type="text"
              value={otherGame}
              maxLength={80}
              placeholder="Nome do jogo"
              onChange={(e) => setOtherGame(e.target.value)}
              className="mt-2 w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none"
            />
          )}
          <p className="mt-1.5 text-[12px] text-mv-muted">
            O ícone automático vem da Steam ou do site oficial do jogo. Pra usar a logo mais nova, envie a sua
            imagem abaixo.
          </p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/webp,image/jpeg,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) choosePendingIcon(f)
                e.target.value = ''
              }}
            />
            <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary h-8 px-3 text-[12.5px]">
              {currentIcon ? 'Trocar imagem' : 'Enviar imagem (PNG sem fundo)'}
            </button>
            {currentIcon && (
              <button type="button" onClick={() => choosePendingIcon(null)} className="h-8 px-3 text-[12.5px] text-rose-300 hover:text-rose-200">
                Remover imagem
              </button>
            )}
          </div>
          <p className="mt-1 text-[11.5px] text-mv-muted">A imagem enviada tem prioridade sobre o ícone automático.</p>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  )
}
