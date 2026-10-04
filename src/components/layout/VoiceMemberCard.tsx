import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useChannels } from '../../hooks/useChannels'
import { useModeration } from '../../hooks/useModeration'
import { useRoles } from '../../hooks/useRoles'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useServers } from '../../hooks/useServers'
import { useVoiceCore } from '../../hooks/useVoice'
import { supabase } from '../../lib/supabase'
import { describeVoiceMoveError } from '../../lib/voiceMove'
import { rememberVolume, toggleVolumeMute } from '../../lib/muteMemory'
import type { Profile } from '../../types/database'

// Cartão que abre ao CLICAR em alguém numa sala de voz (lista lateral ou
// quadro da sala): volume só pra você, mensagem, perfil e — pra quem tem
// permissão — mover de sala, cargos, expulsar e banir.

export type VoiceMemberCardTarget = {
  userId: string
  serverId: string
  /** Sala de voz onde a pessoa está agora */
  channelId: string
  /** Posição do clique (o cartão abre ali, ajustado pra caber na tela) */
  x: number
  y: number
}

/** Abre o DM / o perfil pelo MainLayout (funciona de qualquer lugar). */
export function requestMessageUser(userId: string) {
  window.dispatchEvent(new CustomEvent('mv:message-user', { detail: { userId } }))
}
export function requestViewProfile(profile: Profile) {
  window.dispatchEvent(new CustomEvent('mv:view-profile', { detail: { profile } }))
}

type Section = 'main' | 'move' | 'roles'

export function VoiceMemberCard({ target, onClose }: { target: VoiceMemberCardTarget; onClose: () => void }) {
  const { user, profile: ownProfile } = useAuth()
  const voice = useVoiceCore()
  const { members } = useServerMembers(target.serverId)
  const { channels } = useChannels()
  const { permissions, kickMember, banMember } = useModeration(target.serverId)
  const { roles, rolesForUser, assignRole, removeRole } = useRoles(target.serverId)
  const [section, setSection] = useState<Section>('main')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const isSelf = target.userId === user?.id
  const member = members.find((m) => m.user_id === target.userId)
  const profile: Profile | undefined = isSelf ? (ownProfile ?? member?.profile) : member?.profile
  const name = profile?.display_name || profile?.username || 'Usuário'
  const { servers } = useServers()
  const serverOwnerId = servers.find((sv) => sv.id === target.serverId)?.owner_id ?? null
  const targetIsOwner = serverOwnerId === target.userId
  const iAmOwner = serverOwnerId === user?.id
  const isAdmin = iAmOwner || Boolean(permissions.administrator)
  const canMove = !isSelf && (isAdmin || Boolean(permissions.move_members)) && (!targetIsOwner || iAmOwner)
  const canRoles = !isSelf && (isAdmin || Boolean(permissions.manage_roles)) && roles.length > 0
  const canKick = !isSelf && !targetIsOwner && (isAdmin || Boolean(permissions.kick_members))
  const canBan = !isSelf && !targetIsOwner && (isAdmin || Boolean(permissions.ban_members))
  const volume = voice.getParticipantVolume(target.userId)
  const voiceTargets = channels
    .filter((c) => c.type === 'voice' && c.id !== target.channelId)
    .sort((a, b) => a.position - b.position)
  const myRoleIds = new Set(rolesForUser(target.userId).map((r) => r.id))

  // Fecha com clique fora / Esc.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Posição: perto do clique, sem sair da tela.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    const left = Math.min(Math.max(margin, target.x + 8), window.innerWidth - r.width - margin)
    const top = Math.min(Math.max(margin, target.y - 24), window.innerHeight - r.height - margin)
    setPos({ left, top })
  }, [target.x, target.y, section])

  async function run(action: () => Promise<{ error: string | null }>, ok: string, closeAfter = false) {
    setBusy(true)
    setFeedback(null)
    const { error } = await action()
    setBusy(false)
    if (error) setFeedback(error)
    else if (closeAfter) onClose()
    else setFeedback(ok)
  }

  async function moveTo(channelId: string) {
    await run(
      async () => {
        const { error } = await supabase.rpc('move_voice_member', {
          p_server_id: target.serverId,
          p_user_id: target.userId,
          p_to_channel_id: channelId,
        })
        return { error: error ? describeVoiceMoveError(error.message) : null }
      },
      'Movido.',
      true,
    )
  }

  const item =
    'w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg text-[13px] text-left text-mv-text hover:bg-white/[0.06] disabled:opacity-50 transition-colors'

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Opções de ${name}`}
      className="fixed z-[400] w-72 surface-elevated rounded-2xl p-3 animate-pop-in"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      <div className="flex items-center gap-3 pb-3 mb-2 border-b border-[var(--color-line)]">
        <Avatar name={profile?.username ?? name} avatarUrl={profile?.avatar_url} userId={target.userId} size={44} />
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{isSelf ? `${name} (você)` : name}</p>
          {profile?.username && <p className="text-[12px] text-mv-muted truncate">@{profile.username}</p>}
        </div>
      </div>

      {section === 'main' && (
        <div className="space-y-0.5">
          {!isSelf && (
            <div className="px-2.5 pb-2">
              <div className="flex items-center justify-between text-[12px] mb-1">
                <span className="text-mv-muted">Volume (só pra você)</span>
                <span className="tabular-nums text-mv-text">{volume}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  rememberVolume(`voice:${target.userId}`, v)
                  voice.setParticipantVolume(target.userId, v)
                }}
                aria-label={`Volume de ${name}`}
                className="w-full accent-mv-accent"
              />
              <button
                type="button"
                onClick={() =>
                  toggleVolumeMute(`voice:${target.userId}`, volume, (v) => voice.setParticipantVolume(target.userId, v), 100)
                }
                className="mt-1 text-[12px] text-mv-muted hover:text-white"
              >
                {volume === 0 ? 'Reativar áudio dessa pessoa' : 'Silenciar só pra mim'}
              </button>
            </div>
          )}
          {profile && (
            <button
              type="button"
              className={item}
              onClick={() => {
                requestViewProfile(profile)
                onClose()
              }}
            >
              Ver perfil
            </button>
          )}
          {!isSelf && (
            <button
              type="button"
              className={item}
              onClick={() => {
                requestMessageUser(target.userId)
                onClose()
              }}
            >
              Enviar mensagem privada
            </button>
          )}
          {canMove && (
            <button type="button" className={item} onClick={() => setSection('move')}>
              <span className="flex-1">Mover para outra sala</span>
              <span aria-hidden>›</span>
            </button>
          )}
          {canRoles && (
            <button type="button" className={item} onClick={() => setSection('roles')}>
              <span className="flex-1">Cargos (promover)</span>
              <span aria-hidden>›</span>
            </button>
          )}
          {(canKick || canBan) && <div className="h-px bg-[var(--color-line)] my-1.5" />}
          {canKick && (
            <button
              type="button"
              disabled={busy}
              className={`${item} text-rose-300 hover:bg-rose-500/10`}
              onClick={() => {
                if (confirm(`Expulsar ${name} do servidor? A pessoa pode voltar com um convite.`))
                  void run(() => kickMember(target.userId), 'Expulso.', true)
              }}
            >
              Expulsar do servidor
            </button>
          )}
          {canBan && (
            <button
              type="button"
              disabled={busy}
              className={`${item} text-rose-300 hover:bg-rose-500/10`}
              onClick={() => {
                if (confirm(`Banir ${name}? A pessoa sai do servidor e não consegue voltar.`))
                  void run(() => banMember(target.userId), 'Banido.', true)
              }}
            >
              Banir do servidor
            </button>
          )}
        </div>
      )}

      {section === 'move' && (
        <div>
          <button
            type="button"
            className="text-[12px] text-mv-muted hover:text-white mb-1.5"
            onClick={() => setSection('main')}
          >
            ‹ Voltar
          </button>
          <p className="field-label px-1">Mover {name} para</p>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {voiceTargets.length === 0 ? (
              <p className="text-[13px] text-mv-muted px-2.5 py-2">Não há outra sala de voz.</p>
            ) : (
              voiceTargets.map((c) => (
                <button key={c.id} type="button" disabled={busy} className={item} onClick={() => void moveTo(c.id)}>
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-mv-muted shrink-0" aria-hidden>
                    <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 15 8.2v7.6a4.5 4.5 0 0 0 1.5-3.8z" />
                  </svg>
                  <span className="truncate">{c.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {section === 'roles' && (
        <div>
          <button
            type="button"
            className="text-[12px] text-mv-muted hover:text-white mb-1.5"
            onClick={() => setSection('main')}
          >
            ‹ Voltar
          </button>
          <p className="field-label px-1">Cargos de {name}</p>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {[...roles]
              .sort((a, b) => b.position - a.position)
              .map((r) => {
                const has = myRoleIds.has(r.id)
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={busy}
                    className={item}
                    onClick={() =>
                      void run(
                        () => (has ? removeRole(target.userId, r.id) : assignRole(target.userId, r.id)),
                        has ? `Cargo "${r.name}" removido.` : `Cargo "${r.name}" dado.`,
                      )
                    }
                  >
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color }} aria-hidden />
                    <span className="flex-1 truncate">{r.name}</span>
                    <span
                      className={`w-4 h-4 rounded-[5px] border flex items-center justify-center text-[11px] ${
                        has ? 'bg-mv-accent border-mv-accent text-white' : 'border-[var(--color-line-strong)]'
                      }`}
                      aria-hidden
                    >
                      {has ? '✓' : ''}
                    </span>
                  </button>
                )
              })}
          </div>
        </div>
      )}

      {feedback && <p className="text-[12px] text-mv-muted mt-2 px-1">{feedback}</p>}
    </div>
  )
}
