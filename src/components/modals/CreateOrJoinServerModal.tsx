import { useRef, useState } from 'react'
import { Modal } from './Modal'
import { useServers } from '../../hooks/useServers'

const ICON_MAX_BYTES = 5 * 1024 * 1024 // precisa bater com o file_size_limit do bucket 'server-icons'

export function CreateOrJoinServerModal({ onClose }: { onClose: () => void }) {
  const { createServer, joinServerByInvite } = useServers()
  const [tab, setTab] = useState<'create' | 'join'>('create')

  // criar servidor
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const [iconError, setIconError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // entrar por convite
  const [code, setCode] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > ICON_MAX_BYTES) {
      setIconError('Imagem muito grande — o máximo é 5MB.')
      return
    }
    setIconError(null)
    setIconFile(file)
    setIconPreview(URL.createObjectURL(file))
  }

  async function handleCreate() {
    setError(null)
    if (name.trim().length < 2) {
      setError('O nome precisa ter no mínimo 2 caracteres.')
      return
    }
    setLoading(true)
    const { error, warning } = await createServer(name.trim(), iconFile, description.trim() || null)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
    // O servidor em si foi criado com sucesso — só o ícone falhou ao
    // salvar (ver comentário grande em ServersContext.tsx). Não vale a
    // pena travar a criação por isso, mas também não pode desaparecer
    // sem avisar ninguém (era exatamente esse o bug).
    if (warning) window.alert(warning)
  }

  async function handleJoin() {
    setError(null)
    if (code.trim().length === 0) {
      setError('Cole um código ou link de convite.')
      return
    }
    // aceita tanto o código puro quanto uma URL tipo .../convite/abcd1234
    const cleanCode = code.trim().split('/').pop() ?? code.trim()

    setLoading(true)
    const { error } = await joinServerByInvite(cleanCode)
    setLoading(false)
    if (error) {
      setError('Convite inválido ou expirado.')
      return
    }
    onClose()
  }

  return (
    <Modal title={tab === 'create' ? 'Personalize seu servidor' : 'Entrar em um servidor'} onClose={onClose} maxWidth="max-w-lg">
      <div className="flex gap-2 mb-5 bg-discord-darker rounded-lg p-1">
        <button
          onClick={() => setTab('create')}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === 'create' ? 'bg-discord-lighter text-white' : 'text-discord-text-muted hover:text-white'
          }`}
        >
          Criar servidor
        </button>
        <button
          onClick={() => setTab('join')}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === 'join' ? 'bg-discord-lighter text-white' : 'text-discord-text-muted hover:text-white'
          }`}
        >
          Já tenho um convite
        </button>
      </div>

      {tab === 'create' ? (
        <div className="space-y-5">
          <p className="text-sm text-discord-text-muted leading-relaxed">
            Seu servidor é onde você e seus amigos se encontram. Dê um nome, escolha um ícone e comece a conversar —
            dá pra ajustar tudo de novo depois, nas configurações do servidor.
          </p>

          <div className="flex flex-col items-center gap-2">
            {/* TRIGÉSIMA OITAVA RODADA — bug relatado: esse botão de ícone
                ficava muito apertado, com "Enviar / ícone" quebrado em
                texto minúsculo dentro do círculo tracejado — visual
                confuso e amador. Troca: quando não tem imagem, mostra um
                ícone de imagem (mais legível que texto picotado) e o
                rótulo "Adicionar ícone" fica FORA do círculo, embaixo,
                com espaço de sobra. Quando já tem imagem, o hover mostra
                uma sobreposição escura com ícone de lápis + "Trocar",
                igual ao padrão usado no avatar do EditProfileModal. */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="relative w-24 h-24 rounded-full bg-discord-darker border-2 border-dashed border-discord-text-muted/60 flex items-center justify-center overflow-hidden hover:border-discord-blurple transition-colors group"
            >
              {iconPreview ? (
                <>
                  <img src={iconPreview} alt="Ícone" className="w-full h-full object-cover" />
                  <span className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-white">
                      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    <span className="text-[10px] font-medium text-white">Trocar</span>
                  </span>
                </>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-discord-text-muted group-hover:text-discord-blurple transition-colors">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="9.5" r="1.5" />
                  <path d="M21 15l-5-5-9 9" />
                </svg>
              )}
              {/* Selo de "editar" no canto — mesma linguagem visual que a
                  troca de avatar/banner usa em EditProfileModal, deixa
                  claro que dá pra clicar de novo pra trocar. */}
              <span className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-discord-blurple flex items-center justify-center border-2 border-discord-dark group-hover:brightness-110 transition-all">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-white">
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleIconChange} />
            {!iconPreview && (
              <p className="text-xs font-medium text-discord-text-muted text-center">Adicionar ícone</p>
            )}
            <p className="text-[11px] text-discord-text-muted text-center">
              PNG, JPG, WEBP ou GIF animado — até 5MB. Recomendado: imagem quadrada.
            </p>
            {iconError && <p className="text-xs text-red-400">{iconError}</p>}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              Nome do servidor
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Servidor do João"
              maxLength={60}
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              Sobre o servidor <span className="normal-case font-normal text-discord-text-muted/70">(opcional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Do que é esse servidor? (aparece pra quem vê o servidor antes de entrar)"
              maxLength={200}
              rows={2}
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple resize-none"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
          >
            {loading ? 'Criando...' : 'Criar servidor'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-discord-text-muted">Cole um convite abaixo para entrar em um servidor existente.</p>

          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              Link ou código do convite
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ex: a1b2c3d4"
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleJoin}
            disabled={loading}
            className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
          >
            {loading ? 'Entrando...' : 'Entrar no servidor'}
          </button>
        </div>
      )}
    </Modal>
  )
}
