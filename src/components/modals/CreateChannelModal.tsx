import { useState } from 'react'
import { Modal } from './Modal'
import { Toggle } from '../ui/Toggle'
import { OptionCard, ToggleRow } from './settingsUI'
import { useChannels } from '../../hooks/useChannels'
import type { Category, ChannelType } from '../../types/database'
import { TextChannelIcon, VoiceChannelIcon } from '../ui/icons'
import { channelNameFor } from '../../lib/channelName'

export function CreateChannelModal({
  categories,
  defaultCategoryId,
  defaultType = 'text',
  onClose,
}: {
  categories: Category[]
  defaultCategoryId?: string | null
  defaultType?: ChannelType
  onClose: () => void
}) {
  const { createChannel } = useChannels()
  const [name, setName] = useState('')
  const [type, setType] = useState<ChannelType>(defaultType)
  const [isStage, setIsStage] = useState(false)
  const [userLimit, setUserLimit] = useState(0)
  const [isNsfw, setIsNsfw] = useState(false)
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    setError(null)
    const cleanName = channelNameFor(type, name)
    if (cleanName.length < 1) {
      setError('Dê um nome ao canal.')
      return
    }
    setLoading(true)
    const { error } = await createChannel(cleanName, type, categoryId || null, type === 'voice' && isStage, type === 'voice' ? userLimit : 0, type === 'text' && isNsfw)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  return (
    <Modal
      title="Criar canal"
      description={
        categoryId ? `em ${categories.find((c) => c.id === categoryId)?.name ?? ''}` : undefined
      }
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary h-9 px-4 text-sm">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary h-9 px-4 text-sm">
            {loading ? 'Criando...' : 'Criar canal'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p id="create-channel-type" className="field-label">
            Tipo de canal
          </p>
          <div role="radiogroup" aria-labelledby="create-channel-type" className="space-y-2">
            <OptionCard
              selected={type === 'text'}
              onSelect={() => setType('text')}
              icon={<TextChannelIcon className="w-[18px] h-[18px]" aria-hidden />}
              title="Texto"
              description="Enviar mensagens, imagens e links"
            />
            <OptionCard
              selected={type === 'voice'}
              onSelect={() => setType('voice')}
              icon={<VoiceChannelIcon className="w-[18px] h-[18px]" aria-hidden />}
              title="Voz"
              description="Conversar por voz e vídeo"
            />
          </div>
        </div>

        <div>
          <label htmlFor="create-channel-name" className="field-label">
            Nome do canal
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mv-muted pointer-events-none flex" aria-hidden="true">
              {type === 'text' ? (
                <TextChannelIcon className="w-4 h-4" aria-hidden />
              ) : (
                <VoiceChannelIcon className="w-4 h-4" aria-hidden />
              )}
            </span>
            <input
              id="create-channel-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'text' ? 'novo-canal' : 'Nova sala'}
              className="w-full pl-9 pr-3 py-2.5 bg-mv-canvas text-mv-text outline-none"
            />
          </div>
          {type === 'voice' && !isStage && (
            <p className="text-[12px] text-mv-muted mt-1.5">
              Junto com a sala de voz é criado um chat de texto com o mesmo nome
              {name.trim() ? (
                <>
                  {' '}
                  (<span className="text-mv-text">#{channelNameFor('text', name)}</span>)
                </>
              ) : null}
              . Dá pra editar ou excluir cada um separado depois.
            </p>
          )}
        </div>

        {type === 'text' && (
          <ToggleRow
            title="Canal +18 (restrição de idade)"
            description="Quem abrir o canal precisa confirmar que tem 18 anos ou mais antes de ver o conteúdo, e o seletor de GIF aqui inclui GIFs com classificação R."
          >
            <Toggle label="Canal +18 (restrição de idade)" checked={isNsfw} onChange={setIsNsfw} />
          </ToggleRow>
        )}

        {type === 'voice' && (
          <ToggleRow
            title="Canal Palco"
            description="Só donos/moderadores podem falar, o resto só escuta (bom pra anúncios, palestras, eventos)"
          >
            <Toggle label="Canal Palco" checked={isStage} onChange={setIsStage} />
          </ToggleRow>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {type === 'voice' && (
            <div>
              <label htmlFor="create-channel-limit" className="field-label">
                Limite de pessoas
              </label>
              <select
                id="create-channel-limit"
                value={userLimit}
                onChange={(e) => setUserLimit(Number(e.target.value))}
                className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none"
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

          {categories.length > 0 && (
            <div className={type === 'voice' ? '' : 'sm:col-span-2'}>
              <label htmlFor="create-channel-category" className="field-label">
                Categoria
              </label>
              <select
                id="create-channel-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none"
              >
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  )
}
