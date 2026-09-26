import { useState } from 'react'
import { Modal } from './Modal'
import { useRoles } from '../../hooks/useRoles'
import { useModeration } from '../../hooks/useModeration'
import type { Profile } from '../../types/database'

const TIMEOUT_PRESETS = [
  { label: '5 minutos', minutes: 5 },
  { label: '1 hora', minutes: 60 },
  { label: '1 dia', minutes: 60 * 24 },
  { label: '1 semana', minutes: 60 * 24 * 7 },
]

export function ManageMemberModal({
  serverId,
  targetProfile,
  onClose,
  onKicked,
}: {
  serverId: string
  targetProfile: Profile
  onClose: () => void
  onKicked?: () => void
}) {
  const { roles, rolesForUser, assignRole, removeRole } = useRoles(serverId)
  const { permissions, kickMember, banMember, timeoutMember } = useModeration(serverId)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState<'kick' | 'ban' | null>(null)

  const memberRoleIds = new Set(rolesForUser(targetProfile.id).map((r) => r.id))

  async function handleToggleRole(roleId: string) {
    setError(null)
    const action = memberRoleIds.has(roleId) ? removeRole : assignRole
    const { error } = await action(targetProfile.id, roleId)
    if (error) setError(error)
  }

  async function handleKick() {
    setLoading(true)
    const { error } = await kickMember(targetProfile.id, reason || undefined)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onKicked?.()
    onClose()
  }

  async function handleBan() {
    setLoading(true)
    const { error } = await banMember(targetProfile.id, reason || undefined)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onKicked?.()
    onClose()
  }

  async function handleTimeout(minutes: number) {
    setError(null)
    const { error } = await timeoutMember(targetProfile.id, minutes, reason || undefined)
    if (error) setError(error)
  }

  if (confirming) {
    return (
      <Modal title={confirming === 'kick' ? 'Expulsar membro' : 'Banir membro'} onClose={onClose}>
        <p className="text-sm text-discord-text-muted">
          {confirming === 'kick' ? 'Expulsar' : 'Banir'}{' '}
          <span className="text-white font-medium">{targetProfile.display_name || targetProfile.username}</span> do
          servidor?
          {confirming === 'ban' && ' A pessoa não poderá reentrar mesmo com um convite novo.'}
        </p>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (opcional)"
          className="w-full mt-3 px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple text-sm"
        />
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => setConfirming(null)} className="px-4 py-2 text-sm text-discord-text-muted hover:underline">
            Cancelar
          </button>
          <button
            onClick={confirming === 'kick' ? handleKick : handleBan}
            disabled={loading}
            className="px-4 py-2 text-sm rounded btn-danger disabled:opacity-60"
          >
            {loading ? 'Aguarde...' : confirming === 'kick' ? 'Expulsar' : 'Banir'}
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`Gerenciar ${targetProfile.display_name || targetProfile.username}`} onClose={onClose}>
      <div className="space-y-4">
        {roles.length > 0 && permissions.manage_roles && (
          <div>
            <p className="text-xs font-bold uppercase text-discord-text-muted mb-2">Cargos</p>
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2.5 text-sm text-discord-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={memberRoleIds.has(role.id)}
                    onChange={() => handleToggleRole(role.id)}
                    className="w-4 h-4 accent-discord-blurple"
                  />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: role.color }} />
                  {role.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {permissions.timeout_members && (
          <div>
            <p className="text-xs font-bold uppercase text-discord-text-muted mb-2">Silenciar (timeout)</p>
            <div className="flex flex-wrap gap-2">
              {TIMEOUT_PRESETS.map((preset) => (
                <button
                  key={preset.minutes}
                  onClick={() => handleTimeout(preset.minutes)}
                  className="px-3 py-1.5 rounded bg-discord-darker text-discord-text text-xs hover:bg-discord-lighter transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2 pt-2">
          {permissions.kick_members && (
            <button
              onClick={() => setConfirming('kick')}
              className="flex-1 py-2.5 rounded border border-red-600 text-red-500 hover:bg-red-600/10 transition-colors text-sm"
            >
              Expulsar
            </button>
          )}
          {permissions.ban_members && (
            <button
              onClick={() => setConfirming('ban')}
              className="flex-1 py-2.5 rounded bg-red-600 text-white hover:bg-red-700 transition-colors text-sm"
            >
              Banir
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
