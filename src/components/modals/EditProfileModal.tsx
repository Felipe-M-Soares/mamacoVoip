import { useRef, useState } from 'react'
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
  validateProfileAsset,
} from '../../lib/profileAssetLimits'

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

  if (!profile) return null

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const validationError = validateProfileAsset(file, AVATAR_MAX_BYTES, AVATAR_ACCEPT)
    if (validationError) {
      setAvatarError(validationError)
      return
    }
    setAvatarError(null)
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const validationError = validateProfileAsset(file, BANNER_MAX_BYTES, BANNER_ACCEPT)
    if (validationError) {
      setBannerError(validationError)
      return
    }
    setBannerError(null)
    setBannerFile(file)
    setRemoveBanner(false)
    setBannerPreview(URL.createObjectURL(file))
  }

  function handleDecorationChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const validationError = validateProfileAsset(file, DECORATION_MAX_BYTES, DECORATION_ACCEPT)
    if (validationError) {
      setDecorationError(validationError)
      return
    }
    setDecorationError(null)
    setDecorationFile(file)
    setRemoveDecoration(false)
    setDecorationPreview(URL.createObjectURL(file))
  }

  function handleRemoveBanner() {
    setBannerFile(null)
    setBannerPreview(null)
    setRemoveBanner(true)
    if (bannerInputRef.current) bannerInputRef.current.value = ''
  }

  function handleRemoveDecoration() {
    setDecorationFile(null)
    setDecorationPreview(null)
    setRemoveDecoration(true)
    if (decorationInputRef.current) decorationInputRef.current.value = ''
  }

  async function handleSave() {
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
    <Modal title="Editar perfil" onClose={onClose} maxWidth="max-w-lg">
      <div className="flex gap-1 mb-4 border-b border-white/10 pb-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'text-white border-discord-blurple'
                : 'text-discord-text-muted border-transparent hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'perfil' && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-1.5">
            <button
              onClick={() => avatarInputRef.current?.click()}
              className="w-20 h-20 rounded-full bg-discord-darker border-2 border-dashed border-discord-text-muted flex items-center justify-center overflow-hidden hover:border-discord-blurple transition-colors"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-discord-text-muted text-center px-2">Enviar foto</span>
              )}
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept={AVATAR_ACCEPT}
              className="hidden"
              onChange={handleAvatarChange}
            />
            <p className="text-[11px] text-discord-text-muted text-center max-w-[280px]">{AVATAR_HELP}</p>
            {avatarError && <p className="text-xs text-red-400">{avatarError}</p>}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              Nome de exibição
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              Status personalizado
            </label>
            <input
              type="text"
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value)}
              placeholder="O que você está pensando?"
              maxLength={100}
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">Jogando agora</label>
            <input
              type="text"
              value={playing}
              onChange={(e) => setPlaying(e.target.value)}
              placeholder="Nome do jogo (opcional)"
              maxLength={60}
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
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
            className="w-full h-28 rounded-lg overflow-hidden border-2 border-dashed border-discord-text-muted hover:border-discord-blurple transition-colors relative group"
            style={!bannerPreview ? { background: gradientFor(profile.username) } : undefined}
          >
            {bannerPreview && (
              <img src={bannerPreview} alt="Banner" className="absolute inset-0 w-full h-full object-cover" />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
              <span className="text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 px-2.5 py-1 rounded">
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
          {bannerError && <p className="text-xs text-red-400">{bannerError}</p>}
          {bannerPreview && (
            <button
              onClick={handleRemoveBanner}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
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
            className="w-full py-2.5 rounded btn-secondary text-sm"
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
          {decorationError && <p className="text-xs text-red-400">{decorationError}</p>}
          {decorationPreview && (
            <button
              onClick={handleRemoveDecoration}
              className="text-xs text-red-400 hover:text-red-300 transition-colors block"
            >
              Remover decoração
            </button>
          )}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
        >
          {loading ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>
    </Modal>
  )
}
