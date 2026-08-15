import { useRef, useState } from 'react'
import { Modal } from './Modal'
import { useServers } from '../../hooks/useServers'

export function CreateOrJoinServerModal({ onClose }: { onClose: () => void }) {
  const { createServer, joinServerByInvite } = useServers()
  const [tab, setTab] = useState<'create' | 'join'>('create')

  // criar servidor
  const [name, setName] = useState('')
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // entrar por convite
  const [code, setCode] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
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
    const { error } = await createServer(name.trim(), iconFile)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
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
    <Modal title={tab === 'create' ? 'Personalize seu servidor' : 'Entrar em um servidor'} onClose={onClose}>
      <div className="flex gap-2 mb-4 bg-discord-darker rounded-lg p-1">
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
        <div className="space-y-4">
          <p className="text-sm text-discord-text-muted">
            Seu servidor é onde você e seus amigos se encontram. Crie o seu e comece a conversar.
          </p>

          <div className="flex justify-center">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-20 h-20 rounded-full bg-discord-darker border-2 border-dashed border-discord-text-muted flex items-center justify-center overflow-hidden hover:border-discord-blurple transition-colors"
            >
              {iconPreview ? (
                <img src={iconPreview} alt="Ícone" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-discord-text-muted text-center px-2">Enviar ícone</span>
              )}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleIconChange} />
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
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full py-2.5 rounded bg-discord-blurple text-white font-medium hover:opacity-90 transition-colors disabled:opacity-60"
          >
            {loading ? 'Criando...' : 'Criar'}
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
            className="w-full py-2.5 rounded bg-discord-blurple text-white font-medium hover:opacity-90 transition-colors disabled:opacity-60"
          >
            {loading ? 'Entrando...' : 'Entrar no servidor'}
          </button>
        </div>
      )}
    </Modal>
  )
}
