import { useRef, useState } from 'react'
import { Modal } from './Modal'
import { useServers } from '../../hooks/useServers'
import { ConfirmDialog } from './ConfirmDialog'
import { EditIcon, ImageAddIcon } from '../ui/icons'

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
  // Aviso pós-criação (ex.: o ícone não salvou) — antes era um
  // window.alert() nativo depois de fechar o modal.
  const [createdWarning, setCreatedWarning] = useState<string | null>(null)

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
    // O servidor em si foi criado com sucesso — só o ícone falhou ao
    // salvar (ver comentário grande em ServersContext.tsx). Não vale a
    // pena travar a criação por isso, mas também não pode desaparecer
    // sem avisar ninguém (era exatamente esse o bug). Mostra o aviso num
    // diálogo do app e só fecha quando a pessoa confirmar.
    if (warning) {
      setCreatedWarning(warning)
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

  if (createdWarning) {
    return (
      <ConfirmDialog
        alertOnly
        title="Servidor criado"
        message={createdWarning}
        confirmLabel="Entendi"
        onConfirm={onClose}
        onCancel={onClose}
      />
    )
  }

  const tabClass = (active: boolean) =>
    `flex-1 h-8 rounded-lg text-[13px] font-medium transition-colors ${
      active ? 'bg-mv-raised text-white shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-mv-muted hover:text-mv-text'
    }`

  return (
    <Modal
      title={tab === 'create' ? 'Personalize seu servidor' : 'Entrar em um servidor'}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary h-9 px-4 text-sm">
            Cancelar
          </button>
          {tab === 'create' ? (
            <button onClick={handleCreate} disabled={loading} className="btn-primary h-9 px-4 text-sm">
              {loading ? 'Criando...' : 'Criar servidor'}
            </button>
          ) : (
            <button onClick={handleJoin} disabled={loading} className="btn-primary h-9 px-4 text-sm">
              {loading ? 'Entrando...' : 'Entrar no servidor'}
            </button>
          )}
        </>
      }
    >
      <div role="tablist" aria-label="Criar ou entrar" className="flex gap-1 p-1 mb-5 rounded-xl bg-mv-canvas border border-[var(--color-line)]">
        <button role="tab" aria-selected={tab === 'create'} onClick={() => setTab('create')} className={tabClass(tab === 'create')}>
          Criar servidor
        </button>
        <button role="tab" aria-selected={tab === 'join'} onClick={() => setTab('join')} className={tabClass(tab === 'join')}>
          Já tenho um convite
        </button>
      </div>

      {tab === 'create' ? (
        <div className="space-y-5">
          <p className="text-sm text-mv-muted leading-relaxed">
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
              className="relative w-24 h-24 rounded-full bg-mv-canvas border-2 border-dashed border-white/[0.18] flex items-center justify-center hover:border-mv-accent transition-colors group"
              aria-label={iconPreview ? 'Trocar ícone do servidor' : 'Adicionar ícone do servidor'}
            >
              {iconPreview ? (
                <>
                  <img src={iconPreview} alt="Ícone" className="w-full h-full object-cover rounded-full" />
                  <span className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                    <EditIcon className="w-5 h-5 text-white" aria-hidden />
                    <span className="text-[10px] font-medium text-white">Trocar</span>
                  </span>
                </>
              ) : (
                <ImageAddIcon className="w-8 h-8 text-mv-muted group-hover:text-mv-accent transition-colors" strokeWidth={1.5} aria-hidden />
              )}
              {/* Selo de "editar" no canto — mesma linguagem visual que a
                  troca de avatar/banner usa em EditProfileModal, deixa
                  claro que dá pra clicar de novo pra trocar. */}
              <span className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-mv-accent flex items-center justify-center border-2 border-[var(--color-elevated)] group-hover:brightness-110 transition-all">
                <EditIcon className="w-3.5 h-3.5 text-white" aria-hidden />
              </span>
            </button>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleIconChange} />
            {!iconPreview && (
              <p className="text-xs font-medium text-mv-muted text-center">Adicionar ícone</p>
            )}
            <p className="text-[11px] text-mv-muted text-center">
              PNG, JPG, WEBP ou GIF animado — até 5MB. Recomendado: imagem quadrada.
            </p>
            {iconError && <p className="text-xs text-rose-400">{iconError}</p>}
          </div>

          <div>
            <label htmlFor="server-create-name" className="field-label">
              Nome do servidor
            </label>
            <input
              id="server-create-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Servidor do João"
              maxLength={60}
              className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none"
            />
          </div>

          <div>
            <label htmlFor="server-create-description" className="field-label">
              Sobre o servidor <span className="normal-case font-normal text-mv-muted/70">(opcional)</span>
            </label>
            <textarea
              id="server-create-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Do que é esse servidor? (aparece pra quem vê o servidor antes de entrar)"
              maxLength={200}
              rows={2}
              className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none resize-none"
            />
          </div>

          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-mv-muted">Cole um convite abaixo para entrar em um servidor existente.</p>

          <div>
            <label htmlFor="server-join-code" className="field-label">
              Link ou código do convite
            </label>
            <input
              id="server-join-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ex: a1b2c3d4"
              className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none"
            />
          </div>

          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
