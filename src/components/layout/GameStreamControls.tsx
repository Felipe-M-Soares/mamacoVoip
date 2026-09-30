import { useEffect, useRef, useState } from 'react'
import { useVoiceCore } from '../../hooks/useVoice'
import {
  computeScreenShareStats,
  describeLimitation,
  formatScreenShareStats,
  pickOutboundVideo,
  type OutboundVideoSample,
  type ScreenShareStats,
} from '../../lib/screenShareStats'
import type { OverlayCorner } from '../../hooks/useGamePresence'

// Controles de "transmissão para jogos" da tela da call:
//  - LocalScreenShareStats: indicador discreto (só pra quem transmite) com
//    o que o encoder está REALMENTE mandando — resolução, fps, bitrate,
//    codec e se é GPU/CPU — lido via getStats() a cada 2s.
//  - GameStreamMenuSection: no menu "..." da call — qualidade automática
//    para jogos e a sobreposição (ligar/desligar, canto da tela).

const STATS_INTERVAL_MS = 2000

export function LocalScreenShareStats() {
  const voice = useVoiceCore()
  const [stats, setStats] = useState<ScreenShareStats | null>(null)
  const prevRef = useRef<OutboundVideoSample | null>(null)
  const getReport = voice.getScreenShareStatsReport

  useEffect(() => {
    let cancelled = false
    prevRef.current = null
    async function tick() {
      const report = await getReport()
      if (cancelled) return
      // RTCStatsReport é um Map (id → estatística): usa só os valores.
      const sample = pickOutboundVideo(report ? (Array.from(report.values()) as Record<string, unknown>[]) : null)
      if (!sample) return
      setStats(computeScreenShareStats(prevRef.current, sample))
      prevRef.current = sample
    }
    void tick()
    const timer = setInterval(() => void tick(), STATS_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [getReport])

  const text = stats ? formatScreenShareStats(stats) : ''
  const limitation = stats ? describeLimitation(stats) : null
  if (!text && !voice.screenSharePresetLabel) return null

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-mv-muted tabular-nums"
      title="O que está saindo de verdade na sua transmissão (atualiza a cada 2s)"
    >
      {voice.screenSharePresetLabel && <span className="chip">{voice.screenSharePresetLabel}</span>}
      {text && <span>{text}</span>}
      {limitation && <span className="text-amber-400">· {limitation}</span>}
    </div>
  )
}

const CORNER_OPTIONS: { value: OverlayCorner; label: string }[] = [
  { value: 'top-left', label: 'Superior esquerdo' },
  { value: 'top-right', label: 'Superior direito' },
  { value: 'bottom-left', label: 'Inferior esquerdo' },
  { value: 'bottom-right', label: 'Inferior direito' },
]

const OVERLAY_HELP =
  'A sobreposição aparece por cima de jogos em "janela sem borda" (borderless). Em tela cheia EXCLUSIVA nenhum app consegue desenhar por cima sem injetar código no jogo — o que anti-cheats bloqueiam —, então o Mamacos Voip não faz isso. Ela também não aparece na sua transmissão.'

export function GameStreamMenuSection() {
  const voice = useVoiceCore()
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  const hasOverlay = Boolean(api?.getOverlaySettings)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [corner, setCorner] = useState<OverlayCorner>('top-left')

  useEffect(() => {
    if (!api?.getOverlaySettings) return
    let cancelled = false
    api
      .getOverlaySettings()
      .then((s) => {
        if (cancelled || !s) return
        setOverlayVisible(Boolean(s.visible))
        setCorner(s.corner)
      })
      .catch(() => {})
    const unsub = api.onOverlayVisibilityChanged?.((visible) => setOverlayVisible(visible))
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [api])

  return (
    <>
      <label
        className="w-full flex items-start gap-2.5 text-left text-[13px] px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-mv-text cursor-pointer transition-colors"
        title="Ao transmitir um jogo detectado: 1080p a 60fps (720p60 se sua conexão estiver fraca), priorizando fluidez."
      >
        <input
          type="checkbox"
          checked={voice.screenShareQuality.gameAuto}
          onChange={(e) => voice.screenShareQuality.setGameAuto(e.target.checked)}
          className="accent-mv-accent mt-0.5"
        />
        <span>
          Qualidade automática para jogos
          <span className="block text-[11px] text-mv-muted">1080p60 ao transmitir um jogo detectado</span>
        </span>
      </label>

      {hasOverlay && (
        <>
          <label
            className="w-full flex items-start gap-2.5 text-left text-[13px] px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-mv-text cursor-pointer transition-colors"
            title={OVERLAY_HELP}
          >
            <input
              type="checkbox"
              checked={overlayVisible}
              onChange={(e) => {
                const next = e.target.checked
                setOverlayVisible(next)
                api?.setOverlayVisible?.(next).then(setOverlayVisible).catch(() => {})
              }}
              className="accent-mv-accent mt-0.5"
            />
            <span>
              Sobreposição no jogo
              <span className="block text-[11px] text-mv-muted">Atalho: Ctrl+Shift+O</span>
            </span>
          </label>
          <div className="px-2.5 pb-1.5">
            <select
              value={corner}
              onChange={(e) => {
                const next = e.target.value as OverlayCorner
                setCorner(next)
                api?.setOverlayCorner?.(next).catch(() => {})
              }}
              aria-label="Posição da sobreposição"
              title="Posição da sobreposição na tela do jogo"
              className="w-full bg-mv-canvas text-mv-text text-xs h-8 px-2 rounded-lg outline-none"
            >
              {CORNER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] leading-snug text-mv-muted pt-1.5">
              Use o jogo em <strong className="text-mv-text font-medium">janela sem borda</strong> — em tela cheia exclusiva a
              sobreposição não aparece (evitamos injetar no jogo por causa dos anti-cheats).
            </p>
          </div>
        </>
      )}
    </>
  )
}
