import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useAuth } from '../../hooks/useAuth'
import {
  AVATAR_ACCEPT,
  AVATAR_HELP,
  AVATAR_MAX_BYTES,
  BANNER_ACCEPT,
  BANNER_HELP,
  BANNER_MAX_BYTES,
  DECORATION_ACCEPT,
  DECORATION_HELP,
  DECORATION_MAX_BYTES,
  validateProfileAssetDeep,
} from '../../lib/profileAssetLimits'

// Libera a URL temporária (blob:) da prévia anterior — sem isso cada
// arquivo escolhido ficava preso na memória até fechar o app.
function revokeIfBlob(url: string | null) {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
}

type Tab = 'perfil' | 'banner' | 'decoracao'
const TABS: { id: Tab; label: string }[] = [
  { id: 'perfil', label: 'Perfil' },
  { id: 'banner', label: 'Banner' },
  { id: 'decoracao', label: 'Decoração' },
]

// Mesmo truque de gradiente-por-nome usado em ProfileSidePanel.tsx e
// ServerBar.tsx — é exatamente o que aparece no lugar do banner quando
// a pessoa não enviou nenhum, então a prévia aqui usa o mesmo cálculo
// pra mostrar de verdade o que vai aparecer.
function gradientFor(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return `linear-gradient(135deg, hsl(${hue} 70% 40%), hsl(${(hue + 45) % 360} 65% 22%))`
}

export function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { profile, updateProfile } = useAuth()
  const [tab, setTab] = useState<Tab>('perfil')

  const [displayName, setDisplayName] = useState(profile?.display_name ?? profile?.username ?? '')
  const [customStatus, setCustomStatus] = useState(profile?.custom_status ?? '')
  const [playing, setPlaying] = useState(profile?.playing ?? '')

  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile?.avatar_url ?? null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [bannerFile, setBannerFile] = useState<File | null>(null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(profile?.banner_url ?? null)
  const [removeBanner, setRemoveBanner] = useState(false)
  const [bannerError, setBannerError] = useState<string | null>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  const [decorationFile, setDecorationFile] = useState<File | null>(null)
  const [decorationPreview, setDecorationPreview] = useState<string | null>(profile?.avatar_decoration_url ?? null)
  const [removeDecoration, setRemoveDecoration] = useState(false)
  const [decorationError, setDecorationError] = useState<string | null>(null)
  const decorationInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Libera as prévias temporárias ao fechar o modal.
  const previewsRef = useRef<(string | null)[]>([])
  previewsRef.current = [avatarPreview, bannerPreview, decorationPreview]
  useEffect(() => () => previewsRef.current.forEach(revokeIfBlob), [])

  if (!profile) return null

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return
    const validationError = await validateProfileAssetDeep(file, AVATAR_MAX_BYTES, AVATAR_ACCEPT)
    if (validationError) {
      setAvatarError(validationError)
      input.value = ''
      return
    }
    setAvatarError(null)
    setAvatarFile(file)
    setAvatarPreview((prev) => {
      revokeIfBlob(prev)
      return URL.createObjectURL(file)
    })
  }

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return
    const validationError = await validateProfileAssetDeep(file, BANNER_MAX_BYTES, BANNER_ACCEPT)
    if (validationError) {
      setBannerError(validationError)
      input.value = ''
      return
    }
    setBannerError(null)
    setBannerFile(file)
    setRemoveBanner(false)
    setBannerPreview((prev) => {
      revokeIfBlob(prev)
      return URL.createObjectURL(file)
    })
  }

  async function handleDecorationChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return
    const validationError = await validateProfileAssetDeep(file, DECORATION_MAX_BYTES, DECORATION_ACCEPT)
    if (validationError) {
      setDecorationError(validationError)
      input.value = ''
      return
    }
    setDecorationError(null)
    setDecorationFile(file)
    setRemoveDecoration(false)
    setDecorationPreview((prev) => {
      revokeIfBlob(prev)
      return URL.createObjectURL(file)
    })
  }

  function handleRemoveBanner() {
    setBannerFile(null)
    setBannerPreview((prev) => {
      revokeIfBlob(prev)
      return null
    })
    setRemoveBanner(true)
    if (bannerInputRef.current) bannerInputRef.current.value = ''
  }

  function handleRemoveDecoration() {
    setDecorationFile(null)
    setDecorationPreview((prev) => {
      revokeIfBlob(prev)
      return null
    })
    setRemoveDecoration(true)
    if (decorationInputRef.current) decorationInputRef.current.value = ''
  }

  async function handleSave() {
    if (loading) return // evita duplo envio
    setError(null)
    setLoading(true)
    const { error } = await updateProfile(
      {
        display_name: displayName.trim() || undefined,
        custom_status: customStatus.trim() || null,
        playing: playing.trim() || null,
        // null só quando a pessoa pediu pra REMOVER e não escolheu um
        // arquivo novo pra substituir — se escolheu um arquivo novo, a
        // própria updateProfile já cuida de setar a URL depois do
        // upload, então aqui não manda nada (undefined = não mexe).
        ...(removeBanner && !bannerFile ? { banner_url: null } : {}),
        ...(removeDecoration && !decorationFile ? { avatar_decoration_url: null } : {}),
      },
      avatarFile,
      bannerFile,
      decorationFile
    )
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  return (
    <Modal
      title="Editar perfil"
      description="Como as outras pessoas veem você no Mamacos."
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <>
          {error && <p className="text-sm text-rose-400 mr-auto">{error}</p>}
          <button onClick={onClose} className="btn-secondary h-9 px-4 text-sm">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={loading} className="btn-primary h-9 px-4 text-sm">
            {loading ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </>
      }
    >
      <div role="tablist" aria-label="Seções do perfil" className="flex gap-1 p-1 mb-5 rounded-xl bg-discord-darker border border-[var(--color-line)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 h-8 rounded-lg text-[13px] font-medium transition-colors ${
              tab === t.id
                ? 'bg-discord-lighter text-white shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
                : 'text-discord-text-muted hover:text-discord-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'perfil' && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-1.5">
            {/* TRIGÉSIMA OITAVA RODADA — mesmo tratamento aplicado ao
                ícone de servidor: sem foto, mostra um ícone de imagem
                (em vez de "Enviar foto" espremido dentro do círculo) e
                o rótulo fica fora, embaixo; com foto, hover mostra
                overlay escuro com lápis + "Trocar". */}
            <button
              onClick={() => avatarInputRef.current?.click()}
              className="relative w-20 h-20 rounded-full bg-discord-darker border-2 border-dashed border-white/[0.18] flex items-center justify-center overflow-hidden hover:border-discord-blurple transition-colors group"
            >
              {avatarPreview ? (
                <>
                  <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  <span className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-white">
                      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    <span className="text-[10px] font-medium text-white">Trocar</span>
                  </span>
                </>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-discord-text-muted group-hover:text-discord-blurple transition-colors">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="9.5" r="1.5" />
                  <path d="M21 15l-5-5-9 9" />
                </svg>
              )}
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept={AVATAR_ACCEPT}
              className="hidden"
              onChange={handleAvatarChange}
            />
            {!avatarPreview && (
              <p className="text-xs font-medium text-discord-text-muted text-center">Enviar foto</p>
            )}
            <p className="text-[11px] text-discord-text-muted text-center max-w-[280px]">{AVATAR_HELP}</p>
            {avatarError && <p className="text-xs text-rose-400">{avatarError}</p>}
          </div>

          <div>
            <label className="field-label">
              Nome de exibição
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={32}
              className="w-full px-3 py-2.5 bg-discord-darker text-discord-text outline-none"
            />
          </div>

          <div>
            <label className="field-label">
              Status personalizado
            </label>
            <input
              type="text"
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value)}
              placeholder="O que você está pensando?"
              maxLength={100}
              className="w-full px-3 py-2.5 bg-discord-darker text-discord-text outline-none"
            />
          </div>

          <div>
            <label className="field-label">Jogando agora</label>
            <input
              type="text"
              value={playing}
              onChange={(e) => setPlaying(e.target.value)}
              placeholder="Nome do jogo (opcional)"
              maxLength={60}
              className="w-full px-3 py-2.5 bg-discord-darker text-discord-text outline-none"
            />
            <p className="text-xs text-discord-text-muted mt-1.5">
              No site, esse campo é manual — detectar automaticamente qual jogo está aberto só é possível no app
              desktop (nenhum navegador consegue ver quais programas estão rodando no seu computador, por segurança).
              Deixe em branco pra não mostrar nada.
            </p>
          </div>
        </div>
      )}

      {tab === 'banner' && (
        <div className="space-y-3">
          <button
            onClick={() => bannerInputRef.current?.click()}
            className="w-full h-40 rounded-xl overflow-hidden border border-[var(--color-line-strong)] hover:border-discord-blurple/70 transition-colors relative group"
            style={!bannerPreview ? { background: gradientFor(profile.username) } : undefined}
          >
            {bannerPreview && (
              <img src={bannerPreview} alt="Banner" className="absolute inset-0 w-full h-full object-cover" />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
              <span className="text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity bg-black/55 px-3 py-1 rounded-full">
                {bannerPreview ? 'Trocar banner' : 'Sem banner — clique pra enviar'}
              </span>
            </span>
          </button>
          <input
            ref={bannerInputRef}
            type="file"
            accept={BANNER_ACCEPT}
            className="hidden"
            onChange={handleBannerChange}
          />
          <p className="text-[11px] text-discord-text-muted">{BANNER_HELP}</p>
          {bannerError && <p className="text-xs text-rose-400">{bannerError}</p>}
          {bannerPreview && (
            <button
              onClick={handleRemoveBanner}
              className="text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors"
            >
              Remover banner (voltar ao gradiente automático)
            </button>
          )}
        </div>
      )}

      {tab === 'decoracao' && (
        <div className="space-y-3">
          <div className="flex justify-center py-2">
            {/* Prévia composta — mesma técnica de "sangria" que Avatar.tsx
                usa de verdade, só que fixa aqui num tamanho grande (96px)
                pra dar pra ver o efeito direito. */}
            <div className="relative" style={{ width: 96 * 1.3, height: 96 * 1.3 }}>
              <div
                className="absolute rounded-full overflow-hidden bg-discord-darker"
                style={{ top: 96 * 0.15, left: 96 * 0.15, width: 96, height: 96 }}
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white text-3xl font-medium bg-discord-blurple">
                    {profile.username.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              {decorationPreview && (
                <img
                  src={decorationPreview}
                  alt=""
                  className="absolute inset-0 w-full h-full pointer-events-none select-none"
                />
              )}
            </div>
          </div>
          <button
            onClick={() => decorationInputRef.current?.click()}
            className="w-full h-10 btn-secondary text-sm"
          >
            {decorationPreview ? 'Trocar decoração' : 'Enviar decoração'}
          </button>
          <input
            ref={decorationInputRef}
            type="file"
            accept={DECORATION_ACCEPT}
            className="hidden"
            onChange={handleDecorationChange}
          />
          <p className="text-[11px] text-discord-text-muted">{DECORATION_HELP}</p>
          {decorationError && <p className="text-xs text-rose-400">{decorationError}</p>}
          {decorationPreview && (
            <button
              onClick={handleRemoveDecoration}
              className="text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors block"
            >
              Remover decoração
            </button>
          )}
        </div>
      )}

    </Modal>
  )
}
