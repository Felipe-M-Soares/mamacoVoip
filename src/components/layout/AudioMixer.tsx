import { Avatar } from '../ui/Avatar'
import { RangeInput } from '../ui/RangeInput'
import { useVoiceCore } from '../../hooks/useVoice'
import { focusStream, hideStream, showStream, useStreamView } from '../../lib/streamView'
import { rememberVolume, toggleVolumeMute } from '../../lib/muteMemory'
import type { Profile } from '../../types/database'

function VolumeRow({
  label,
  sublabel,
  avatar,
  value,
  max,
  onChange,
  muted,
  onToggleMute,
  extra,
}: {
  label: string
  sublabel?: string
  avatar?: React.ReactNode
  value: number
  max: number
  onChange: (v: number) => void
  muted: boolean
  onToggleMute: () => void
  extra?: React.ReactNode
}) {
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-mv-text truncate">{label}</p>
          {sublabel && <p className="text-[11px] text-mv-muted truncate">{sublabel}</p>}
        </div>
        {extra}
        <button
          type="button"
          onClick={onToggleMute}
          aria-pressed={muted}
          title={muted ? 'Reativar som' : 'Silenciar só pra mim'}
          aria-label={muted ? `Reativar som de ${label}` : `Silenciar ${label} só pra mim`}
          className={`mv-close !w-7 !h-7 [--cut:5px] ${muted ? '!bg-rose-500/20 !text-rose-400' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
            {muted ? (
              <path d="M16.5 12A4.5 4.5 0 0 0 14 8v1.2l2.4 2.4c.06-.2.1-.4.1-.6zM3 3l18 18-1.4 1.4-3.4-3.4A4.5 4.5 0 0 1 14 20v-2a2.5 2.5 0 0 0 1-2v-.2L3 3.4 3 3z" />
            ) : (
              <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 15 8.2v7.6a4.5 4.5 0 0 0 1.5-3.8z" />
            )}
          </svg>
        </button>
      </div>
      <div className="flex items-center gap-2 pl-0.5">
        <RangeInput
          min={0}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`Volume de ${label}`}
          className={`flex-1 min-w-0 ${muted ? 'opacity-50' : ''}`}
        />
        <button
          type="button"
          onClick={() => onChange(max)}
          disabled={value === max}
          title={value === max ? 'Volume no máximo' : 'Voltar para 100%'}
          aria-label={`Voltar volume de ${label} para 100%`}
          className={`w-11 h-6 shrink-0 rounded text-right text-[11.5px] font-display font-semibold tabular-nums transition-colors ${
            value === max ? 'text-mv-muted cursor-default' : 'text-mv-accent hover:text-white'
          }`}
        >
          {value}%
        </button>
      </div>
    </div>
  )
}

let lastMaster = 100

export function AudioMixer({ profileById }: { profileById: Record<string, Profile | undefined> }) {
  const voice = useVoiceCore()
  const { hidden } = useStreamView()
  const people = Object.entries(voice.participants)
  const streams = people.filter(([, d]) => d.screenStream)
  const nameOf = (id: string) => profileById[id]?.display_name || profileById[id]?.username || 'Usuário'
  const avatarOf = (id: string) => (
    <Avatar name={profileById[id]?.username ?? nameOf(id)} avatarUrl={profileById[id]?.avatar_url} userId={id} size={24} />
  )

  return (
    <div className="w-[320px] max-w-[calc(100vw-24px)] max-h-[min(72vh,560px)] overflow-y-auto">
      <div className="flex items-center gap-2.5 px-1 pb-3 mb-1 border-b border-[var(--color-line)]">
        <span className="mv-badge-ico !w-8 !h-8 [--cut:6px]" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4">
            <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="18" cy="18" r="2" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="font-display text-[15px] font-bold tracking-wide text-white leading-tight">Volumes</p>
          <p className="text-[11.5px] text-mv-muted leading-snug">Só você ouve essa mistura. Clique na % para voltar a 100%.</p>
        </div>
      </div>
      <p className="field-label px-1 !mb-0 mt-2">Geral</p>
      <div className="px-1 divide-y divide-[var(--color-line)]">
        <VolumeRow
          label="Tudo da chamada"
          sublabel={voice.deafened ? 'Áudio desativado (botão do fone)' : undefined}
          value={voice.masterVolume}
          max={100}
          onChange={(v) => {
            if (v > 0) lastMaster = v
            voice.setMasterVolume(v)
          }}
          muted={voice.masterVolume === 0 || voice.deafened}
          onToggleMute={() => {
            if (voice.deafened) voice.toggleDeafen()
            else if (voice.masterVolume === 0) voice.setMasterVolume(lastMaster || 100)
            else {
              lastMaster = voice.masterVolume
              voice.setMasterVolume(0)
            }
          }}
        />
        <VolumeRow
          label="Efeitos sonoros"
          sublabel="Soundboard"
          value={voice.soundboardVolume}
          max={100}
          onChange={(v) => {
            rememberVolume('soundboard', v)
            voice.setSoundboardVolume(v)
          }}
          muted={voice.soundboardVolume === 0}
          onToggleMute={() => toggleVolumeMute('soundboard', voice.soundboardVolume, voice.setSoundboardVolume, 70)}
        />
      </div>

      <p className="field-label px-1 !mb-0 mt-3">Vozes{people.length > 0 ? ` · ${people.length}` : ''}</p>
      {people.length === 0 ? (
        <p className="text-[12px] text-mv-muted px-1 py-2">Ninguém mais na sala ainda.</p>
      ) : (
        <div className="px-1 divide-y divide-[var(--color-line)]">
          {people.map(([id]) => {
            const v = voice.getParticipantVolume(id)
            return (
              <VolumeRow
                key={id}
                label={nameOf(id)}
                avatar={avatarOf(id)}
                value={v}
                max={100}
                onChange={(nv) => {
                  rememberVolume(`voice:${id}`, nv)
                  voice.setParticipantVolume(id, nv)
                }}
                muted={v === 0}
                onToggleMute={() => toggleVolumeMute(`voice:${id}`, v, (nv) => voice.setParticipantVolume(id, nv), 100)}
              />
            )
          })}
        </div>
      )}

      <p className="field-label px-1 !mb-0 mt-3">Transmissões{streams.length > 0 ? ` · ${streams.length}` : ''}</p>
      {streams.length === 0 ? (
        <p className="text-[12px] text-mv-muted px-1 py-2">Ninguém transmitindo agora.</p>
      ) : (
        <div className="px-1 divide-y divide-[var(--color-line)]">
          {streams.map(([id, d]) => {
            const v = voice.getScreenShareVolume(id)
            const isHidden = hidden.has(id)
            const hasAudio = Boolean(d.screenAudioStream)
            return (
              <VolumeRow
                key={id}
                label={nameOf(id)}
                sublabel={isHidden ? 'Fechada (sem som)' : hasAudio ? 'Som da transmissão' : 'Sem áudio'}
                avatar={avatarOf(id)}
                value={v}
                max={100}
                onChange={(nv) => {
                  rememberVolume(`screen:${id}`, nv)
                  voice.setScreenShareVolume(id, nv)
                }}
                muted={v === 0 || isHidden}
                onToggleMute={() => {
                  if (isHidden) showStream(id)
                  else toggleVolumeMute(`screen:${id}`, v, (nv) => voice.setScreenShareVolume(id, nv), 60)
                }}
                extra={
                  <button
                    type="button"
                    onClick={() => (isHidden ? focusStream(id) : hideStream(id))}
                    className="btn-secondary h-7 px-2.5 text-[11px] font-semibold shrink-0"
                  >
                    {isHidden ? 'Assistir' : 'Fechar'}
                  </button>
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
