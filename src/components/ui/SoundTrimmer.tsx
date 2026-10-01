import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_SOUND_SECONDS, computePeaks, trimAudioBufferToWav } from '../../lib/audioTrim'

// Recorte de som pro soundboard: forma de onda + seleção arrastável.
//  - arraste as alças (bordas) pra mudar início/fim;
//  - arraste o meio da seleção pra mover o trecho inteiro;
//  - clique fora da seleção pra levá-la até ali;
//  - setas do teclado movem a seleção (Shift = passo maior).
// O trecho pode ter de 0,3s até MAX_SOUND_SECONDS.

const MIN_SELECTION = 0.3
const BUCKETS = 240

type Drag = { kind: 'start' | 'end' | 'move'; pointerX: number; start: number; end: number } | null

function fmt(sec: number) {
  return `${sec.toFixed(1).replace('.', ',')}s`
}

export function SoundTrimmer({
  buffer,
  fileName,
  onConfirm,
  onCancel,
}: {
  buffer: AudioBuffer
  fileName: string
  onConfirm: (file: File) => void
  onCancel: () => void
}) {
  const duration = buffer.duration
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(Math.min(duration, MAX_SOUND_SECONDS))
  const [playhead, setPlayhead] = useState<number | null>(null)
  // Volume SÓ da prévia (pra ouvir enquanto corta, sem levar susto com
  // som alto). O arquivo salvo mantém o volume original.
  const [gain, setGain] = useState(0.5)
  const gainNodeRef = useRef<GainNode | null>(null)
  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = gain
  }, [gain])
  const peaks = useMemo(() => computePeaks(buffer, BUCKETS), [buffer])
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<Drag>(null)
  const playRef = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode; raf: number } | null>(null)

  // ---------------------------------------------------------- desenho
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    const styles = getComputedStyle(canvas)
    const accent = styles.getPropertyValue('--color-mv-accent').trim() || '#ef4444'
    const barW = w / BUCKETS
    for (let i = 0; i < BUCKETS; i++) {
      const t = ((i + 0.5) / BUCKETS) * duration
      const inside = t >= start && t <= end
      const bh = Math.max(2, peaks[i] * (h - 8))
      ctx.fillStyle = inside ? accent : 'rgba(255,255,255,0.22)'
      ctx.fillRect(i * barW + barW * 0.15, (h - bh) / 2, Math.max(1, barW * 0.7), bh)
    }
  }, [peaks, start, end, duration])

  // ---------------------------------------------------------- prévia
  function stopPreview() {
    const p = playRef.current
    if (!p) return
    cancelAnimationFrame(p.raf)
    try {
      p.src.stop()
    } catch {
      // já parou
    }
    p.ctx.close().catch(() => {})
    playRef.current = null
    setPlayhead(null)
  }

  function playPreview() {
    stopPreview()
    const ctx = new AudioContext()
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gainNode = ctx.createGain()
    gainNode.gain.value = gain
    gainNodeRef.current = gainNode
    src.connect(gainNode)
    gainNode.connect(ctx.destination)
    const len = end - start
    const t0 = ctx.currentTime
    src.start(0, start, len)
    src.onended = () => {
      if (playRef.current?.src === src) stopPreview()
    }
    const tick = () => {
      if (!playRef.current) return
      setPlayhead(start + Math.min(len, ctx.currentTime - t0))
      playRef.current.raf = requestAnimationFrame(tick)
    }
    playRef.current = { ctx, src, raf: requestAnimationFrame(tick) }
  }

  // Para a prévia ao fechar.
  useEffect(() => () => stopPreview(), []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------- arrastar
  function timeAt(clientX: number) {
    const rect = wrapRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }

  function clampSel(s: number, e: number, anchor: 'start' | 'end' | 'move') {
    if (anchor === 'move') {
      const len = e - s
      const ns = Math.max(0, Math.min(duration - len, s))
      return [ns, ns + len]
    }
    if (anchor === 'start') {
      const ns = Math.max(0, Math.max(e - MAX_SOUND_SECONDS, Math.min(s, e - MIN_SELECTION)))
      return [ns, e]
    }
    const ne = Math.min(duration, Math.min(s + MAX_SOUND_SECONDS, Math.max(e, s + MIN_SELECTION)))
    return [s, ne]
  }

  function onPointerDown(e: React.PointerEvent) {
    const rect = wrapRef.current!.getBoundingClientRect()
    const px = (t: number) => rect.left + (t / duration) * rect.width
    const handleZone = 10
    let kind: 'start' | 'end' | 'move'
    if (Math.abs(e.clientX - px(start)) <= handleZone) kind = 'start'
    else if (Math.abs(e.clientX - px(end)) <= handleZone) kind = 'end'
    else if (e.clientX > px(start) && e.clientX < px(end)) kind = 'move'
    else {
      // Clique fora: centraliza a seleção (mesmo tamanho) ali.
      const len = end - start
      const center = timeAt(e.clientX)
      const [ns, ne] = clampSel(center - len / 2, center + len / 2, 'move')
      setStart(ns)
      setEnd(ne)
      kind = 'move'
      dragRef.current = { kind, pointerX: e.clientX, start: ns, end: ne }
      ;(e.target as Element).setPointerCapture(e.pointerId)
      return
    }
    dragRef.current = { kind, pointerX: e.clientX, start, end }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const rect = wrapRef.current!.getBoundingClientRect()
    const dt = ((e.clientX - d.pointerX) / rect.width) * duration
    if (d.kind === 'move') {
      const [ns, ne] = clampSel(d.start + dt, d.end + dt, 'move')
      setStart(ns)
      setEnd(ne)
    } else if (d.kind === 'start') {
      const [ns] = clampSel(d.start + dt, d.end, 'start')
      setStart(ns)
    } else {
      const [, ne] = clampSel(d.start, d.end + dt, 'end')
      setEnd(ne)
    }
  }

  function onPointerUp() {
    dragRef.current = null
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1)
    const [ns, ne] = clampSel(start + step, end + step, 'move')
    setStart(ns)
    setEnd(ne)
  }

  function confirm() {
    stopPreview()
    const blob = trimAudioBufferToWav(buffer, start, end)
    const base = fileName.replace(/\.[^.]+$/, '') || 'som'
    onConfirm(new File([blob], `${base}-recorte.wav`, { type: 'audio/wav' }))
  }

  const pct = (t: number) => `${(t / duration) * 100}%`
  const len = end - start

  return (
    <div className="p-3.5 rounded-xl bg-mv-accent/[0.06] border border-mv-accent/30">
      <p className="text-[13px] text-mv-text mb-1">
        Escolha o trecho do som <span className="text-mv-muted">(até {MAX_SOUND_SECONDS}s)</span>
      </p>
      <p className="text-[11.5px] text-mv-muted mb-2.5">
        Arraste as bordas pra ajustar, ou o meio pra mover. O áudio todo tem {fmt(duration)}.
      </p>
      <div
        ref={wrapRef}
        role="slider"
        tabIndex={0}
        aria-label="Trecho do som"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        aria-valuenow={Math.round(start * 10) / 10}
        aria-valuetext={`De ${fmt(start)} até ${fmt(end)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="relative h-20 rounded-lg bg-black/30 select-none touch-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-mv-accent"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden />
        {/* área fora da seleção escurecida */}
        <div
          className="absolute inset-y-0 left-0 bg-black/45 pointer-events-none rounded-l-lg"
          style={{ width: pct(start) }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-black/45 pointer-events-none rounded-r-lg"
          style={{ left: pct(end) }}
        />
        {/* seleção + alças */}
        <div
          className="absolute inset-y-0 border-y-2 border-mv-accent pointer-events-none"
          style={{ left: pct(start), width: pct(len) }}
        />
        {[start, end].map((t, i) => (
          <div
            key={i}
            className="absolute inset-y-0 w-3 -ml-1.5 flex items-center justify-center pointer-events-none"
            style={{ left: pct(t) }}
          >
            <div className="w-1.5 h-full bg-mv-accent rounded-full shadow-[0_0_8px_var(--color-mv-accent)]" />
            <div className="absolute w-3 h-6 rounded-[4px] bg-mv-accent border-2 border-white/90" />
          </div>
        ))}
        {playhead !== null && (
          <div className="absolute inset-y-0 w-0.5 bg-white pointer-events-none" style={{ left: pct(playhead) }} />
        )}
      </div>
      <div className="flex justify-between text-[12px] tabular-nums text-mv-muted mt-1.5">
        <span>Início {fmt(start)}</span>
        <span className="text-mv-text font-medium">Duração {fmt(len)}</span>
        <span>Fim {fmt(end)}</span>
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <label htmlFor="trim-gain" className="text-[12px] text-mv-muted shrink-0">
          Volume pra ouvir
        </label>
        <input
          id="trim-gain"
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(gain * 100)}
          onChange={(e) => setGain(Number(e.target.value) / 100)}
          className="flex-1 accent-mv-accent"
        />
        <span className="text-[12px] tabular-nums text-mv-text w-9 text-right">{Math.round(gain * 100)}%</span>
      </div>
      <p className="text-[11px] text-mv-muted mt-1">Só muda o volume da prévia — o som é salvo no volume original.</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          onClick={playRef.current ? stopPreview : playPreview}
          className="h-9 px-3 btn-secondary text-[13px] flex items-center gap-1.5"
        >
          {playhead !== null ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {playhead !== null ? 'Parar' : 'Ouvir trecho'}
        </button>
        <button type="button" onClick={confirm} className="h-9 px-3 btn-primary text-[13px]">
          Usar esse trecho
        </button>
        <button type="button" onClick={onCancel} className="h-9 px-3 btn-ghost text-[13px] ml-auto">
          Cancelar
        </button>
      </div>
    </div>
  )
}
