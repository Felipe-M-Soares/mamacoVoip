import { ANDROID_DOWNLOAD_URL, DESKTOP_DOWNLOAD_URL } from '../../lib/config'
import { isNativeMobileApp } from '../../lib/platform'

export function MobileDownloadBanner() {
  if (window.electronAPI?.isElectron || isNativeMobileApp()) return null
  const android = /android/i.test(navigator.userAgent)

  return (
    <a
      href={android ? ANDROID_DOWNLOAD_URL : DESKTOP_DOWNLOAD_URL}
      target="_blank"
      rel="noreferrer"
      className="md:hidden relative z-10 mb-4 flex items-center gap-3 rounded-2xl border border-[var(--color-line-strong)] bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.06]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l3.3 3.3V4a1 1 0 0 1 1-1zM4 19a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4z" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{android ? 'Baixe o app pra Android' : 'Baixe o app pra computador'}</p>
        <p className="text-xs text-mv-muted">
          {android
            ? 'Instale o APK (permita "fontes desconhecidas" se o celular pedir)'
            : 'Voz, vídeo e compartilhamento de tela — a experiência completa é no PC'}
        </p>
      </div>
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0 text-mv-muted">
        <path d="M9.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 0 1-1.4-1.4L14.6 12 9.3 6.7a1 1 0 0 1 0-1.4z" />
      </svg>
    </a>
  )
}
