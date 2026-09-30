import { useState } from 'react'
import { Modal } from './Modal'
import { Toggle } from '../ui/Toggle'
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
      <Modal
        title={confirming === 'kick' ? 'Expulsar membro' : 'Banir membro'}
        onClose={onClose}
        footer={
          <>
            <button onClick={() => setConfirming(null)} className="btn-secondary h-9 px-4 text-sm">
              Cancelar
            </button>
            <button onClick={confirming === 'kick' ? handleKick : handleBan} disabled={loading} className="btn-danger h-9 px-4 text-sm">
              {loading ? 'Aguarde...' : confirming === 'kick' ? 'Expulsar' : 'Banir'}
            </button>
          </>
        }
      >
        <p className="text-[14px] text-mv-muted leading-relaxed">
          {confirming === 'kick' ? 'Expulsar' : 'Banir'}{' '}
          <span className="text-white font-medium">{targetProfile.display_name || targetProfile.username}</span> do
          servidor?
          {confirming === 'ban' && ' A pessoa não poderá reentrar mesmo com um convite novo.'}
        </p>
        <label htmlFor="manage-member-reason" className="field-label mt-4">
          Motivo (opcional)
        </label>
        <input
          id="manage-member-reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (opcional)"
          className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none text-sm"
        />
        {error && <p className="text-sm text-rose-400 mt-3">{error}</p>}
      </Modal>
    )
  }

  const hasDangerActions = permissions.kick_members || permissions.ban_members

  return (
    <Modal
      title={`Gerenciar ${targetProfile.display_name || targetProfile.username}`}
      description={`@${targetProfile.username}`}
      onClose={onClose}
      footer={
        hasDangerActions ? (
          <>
            {permissions.kick_members && (
              <button
                onClick={() => setConfirming('kick')}
                className="h-9 px-4 rounded-[10px] text-sm font-medium text-rose-300 border border-rose-500/40 hover:bg-rose-500/10 transition-colors"
              >
                Expulsar
              </button>
            )}
            {permissions.ban_members && (
              <button onClick={() => setConfirming('ban')} className="btn-danger h-9 px-4 text-sm">
                Banir
              </button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {roles.length > 0 && permissions.manage_roles && (
          <div>
            <p className="field-label">Cargos</p>
            <div className="rounded-xl border border-[var(--color-line)] divide-y divide-[var(--color-line)] max-h-52 overflow-y-auto">
              {roles.map((role) => (
                <div key={role.id} className="flex items-center gap-2.5 px-3.5 py-2.5 bg-white/[0.015]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                  <span className="flex-1 text-[14px] text-mv-text truncate">{role.name}</span>
                  <Toggle
                    size="sm"
                    label={`Cargo ${role.name}`}
                    checked={memberRoleIds.has(role.id)}
                    onChange={() => handleToggleRole(role.id)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {permissions.timeout_members && (
          <div>
            <p className="field-label">Silenciar (timeout)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TIMEOUT_PRESETS.map((preset) => (
                <button
                  key={preset.minutes}
                  onClick={() => handleTimeout(preset.minutes)}
                  className="h-9 rounded-[10px] bg-white/[0.03] border border-[var(--color-line)] text-mv-text text-[13px] font-medium hover:bg-white/[0.07] hover:border-[var(--color-line-strong)] transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  )
}
