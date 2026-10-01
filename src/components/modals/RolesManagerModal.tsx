import { useState } from 'react'
import { Modal } from './Modal'
import { Toggle } from '../ui/Toggle'
import { EmptyState } from './settingsUI'
import { useRoles } from '../../hooks/useRoles'
import { useServerMembers } from '../../hooks/useServerMembers'
import { Avatar } from '../ui/Avatar'
import { PERMISSIONS, type Permission, type Role } from '../../types/database'

const PERMISSION_LABELS: Record<Permission, string> = {
  administrator: 'Administrador (ignora todas as outras permissões)',
  manage_server: 'Gerenciar servidor',
  manage_roles: 'Gerenciar cargos',
  manage_channels: 'Gerenciar canais',
  manage_messages: 'Gerenciar mensagens',
  kick_members: 'Expulsar membros',
  ban_members: 'Banir membros',
  timeout_members: 'Silenciar membros (timeout)',
  view_audit_log: 'Ver registro de moderação',
  move_members: 'Mover membros',
}

const PRESET_COLORS = ['#99aab5', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63', '#ff7a45', '#a3e635', '#22d3ee']

export function RolesManagerModal({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const { roles, memberRoles, createRole, updateRole, deleteRole, moveRole, assignRole, removeRole } = useRoles(serverId)
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const sorted = [...roles].sort((a, b) => b.position - a.position)

  if (editing) {
    return (
      <RoleEditor
        serverId={serverId}
        memberIds={editing === 'new' ? [] : memberRoles.filter((mr) => mr.role_id === editing.id).map((mr) => mr.user_id)}
        onToggleMember={async (userId, has) =>
          editing === 'new' ? { error: null } : has ? removeRole(userId, editing.id) : assignRole(userId, editing.id)
        }
        role={editing === 'new' ? null : editing}
        onSave={async (name, color, perms) => {
          const result =
            editing === 'new' ? await createRole(name, color, perms) : await updateRole(editing.id, name, color, perms)
          if (!result.error) setEditing(null)
          return result
        }}
        onDelete={
          editing !== 'new'
            ? async () => {
                await deleteRole(editing.id)
                setEditing(null)
              }
            : undefined
        }
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <Modal
      title="Cargos do servidor"
      description="Cargos agrupam permissões, dão cor ao nome e separam a lista de membros. O de cima manda nos de baixo — use as setas pra ordenar."
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <button
        onClick={() => setEditing('new')}
        className="w-full h-11 mb-4 rounded-xl border border-dashed border-[var(--color-line-strong)] text-[14px] font-medium text-mv-muted hover:text-white hover:border-mv-accent/60 hover:bg-mv-accent/[0.06] transition-colors flex items-center justify-center gap-2"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Criar cargo
      </button>

      <div className="space-y-0.5 max-h-96 overflow-y-auto">
        {roles.length === 0 ? (
          <EmptyState
            icon={
              <>
                <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
                <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
              </>
            }
            title="Nenhum cargo criado ainda"
            hint="Crie cargos como Moderador ou VIP pra organizar o servidor."
          />
        ) : (
          sorted.map((role, i) => (
            <div key={role.id} className="group flex items-center gap-1">
              <button
                onClick={() => setEditing(role)}
                className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 rounded-[10px] hover:bg-white/[0.05] text-left transition-colors"
              >
                <span
                  className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center"
                  style={{ backgroundColor: `${role.color}26`, color: role.color }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
                    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 6.3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z" />
                  </svg>
                </span>
                <span className="text-[14px] font-medium flex-1 truncate" style={{ color: role.color }}>
                  {role.name}
                </span>
                <span className="chip">
                  {(() => {
                    const n = memberRoles.filter((mr) => mr.role_id === role.id).length
                    return `${n} ${n === 1 ? 'membro' : 'membros'}`
                  })()}
                </span>
              </button>
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={async () => setMoveError((await moveRole(role.id, true)).error)}
                  title="Subir (mais importante)"
                  aria-label={`Subir ${role.name}`}
                  className="w-7 h-5 flex items-center justify-center rounded text-mv-muted hover:text-white hover:bg-white/[0.06] disabled:opacity-25"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3" aria-hidden="true"><path d="M12 7l6 8H6z" /></svg>
                </button>
                <button
                  type="button"
                  disabled={i === sorted.length - 1}
                  onClick={async () => setMoveError((await moveRole(role.id, false)).error)}
                  title="Descer"
                  aria-label={`Descer ${role.name}`}
                  className="w-7 h-5 flex items-center justify-center rounded text-mv-muted hover:text-white hover:bg-white/[0.06] disabled:opacity-25"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3" aria-hidden="true"><path d="M12 17l6-8H6z" /></svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      {moveError && (
        <p className="text-[13px] text-rose-300 mt-3">
          {/move_role|function/i.test(moveError) ? 'Rode o arquivo 007 atualizado no Supabase pra poder ordenar cargos.' : moveError}
        </p>
      )}
    </Modal>
  )
}

function RoleEditor({
  serverId,
  role,
  memberIds,
  onToggleMember,
  onSave,
  onDelete,
  onCancel,
}: {
  serverId: string
  role: Role | null
  memberIds: string[]
  onToggleMember: (userId: string, has: boolean) => Promise<{ error: string | null }>
  onSave: (name: string, color: string, permissions: Permission[]) => Promise<{ error: string | null }>
  onDelete?: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(role?.name ?? 'Novo cargo')
  const [color, setColor] = useState(role?.color ?? PRESET_COLORS[0])
  const [permissions, setPermissions] = useState<Set<string>>(new Set(role?.permissions ?? []))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { members } = useServerMembers(serverId)
  const [memberSearch, setMemberSearch] = useState('')
  const [memberError, setMemberError] = useState<string | null>(null)
  const inRole = new Set(memberIds)
  const q = memberSearch.trim().toLowerCase()
  const memberList = members
    .filter((m) => !q || (m.profile.display_name ?? '').toLowerCase().includes(q) || m.profile.username.toLowerCase().includes(q))
    .sort((a, b) => Number(inRole.has(b.user_id)) - Number(inRole.has(a.user_id)))

  function togglePermission(p: Permission) {
    setPermissions((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  async function handleSave() {
    setError(null)
    if (name.trim().length === 0) {
      setError('Dê um nome ao cargo.')
      return
    }
    setLoading(true)
    const { error } = await onSave(name.trim(), color, Array.from(permissions) as Permission[])
    setLoading(false)
    if (error) setError(error)
  }

  if (confirmingDelete && onDelete) {
    return (
      <Modal
        title={`Excluir cargo '${role?.name}'`}
        onClose={onCancel}
        maxWidth="max-w-sm"
        footer={
          <>
            <button onClick={() => setConfirmingDelete(false)} className="btn-secondary h-9 px-4 text-sm">
              Cancelar
            </button>
            <button onClick={onDelete} className="btn-danger h-9 px-4 text-sm">
              Excluir cargo
            </button>
          </>
        }
      >
        <p className="text-[14px] text-mv-muted leading-relaxed">
          Tem certeza que deseja excluir o cargo <span className="text-white font-medium">{role?.name}</span>? Todos
          os membros perderão esse cargo.
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      title={role ? 'Editar cargo' : 'Criar cargo'}
      onClose={onCancel}
      maxWidth="max-w-lg"
      footer={
        <>
          {onDelete && (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="mr-auto h-9 px-3 -ml-2 rounded-[10px] text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              Excluir cargo
            </button>
          )}
          <button onClick={onCancel} className="btn-secondary h-9 px-4 text-sm">
            Voltar
          </button>
          <button onClick={handleSave} disabled={loading} className="btn-primary h-9 px-4 text-sm">
            {loading ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="role-editor-name" className="field-label">
            Nome do cargo
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <input
              id="role-editor-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full pl-8 pr-3 py-2.5 bg-mv-canvas text-mv-text outline-none"
            />
          </div>
        </div>

        <div>
          <p id="role-editor-color" className="field-label">
            Cor
          </p>
          <div role="radiogroup" aria-labelledby="role-editor-color" className="flex gap-2 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={color === c}
                aria-label={`Cor ${c}`}
                title={c}
                onClick={() => setColor(c)}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${
                  color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[var(--color-elevated)]' : ''
                }`}
                style={{ backgroundColor: c }}
              >
                {color === c && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 drop-shadow">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </button>
            ))}
            <label
              title="Outra cor"
              className="w-8 h-8 rounded-full flex items-center justify-center border border-dashed border-[var(--color-line-strong)] cursor-pointer hover:scale-110 transition-transform relative overflow-hidden"
              style={PRESET_COLORS.includes(color) ? undefined : { backgroundColor: color, borderStyle: 'solid' }}
            >
              <span className="text-[14px] text-mv-muted" aria-hidden>
                {PRESET_COLORS.includes(color) ? '+' : ''}
              </span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label="Escolher outra cor"
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </label>
          </div>
        </div>

        {role && (
          <div>
            <div className="flex items-center justify-between">
              <p className="field-label">Membros com esse cargo</p>
              <span className="chip mb-[0.45rem]">{memberIds.length}</span>
            </div>
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Buscar membro…"
              aria-label="Buscar membro"
              className="w-full px-3 py-2 mb-2 bg-mv-canvas text-sm text-mv-text outline-none"
            />
            <div className="rounded-xl border border-[var(--color-line)] divide-y divide-[var(--color-line)] max-h-56 overflow-y-auto">
              {memberList.map((m) => {
                const has = inRole.has(m.user_id)
                return (
                  <div key={m.user_id} className="flex items-center gap-2.5 px-3.5 py-2 bg-white/[0.015]">
                    <Avatar name={m.profile.username} avatarUrl={m.profile.avatar_url} size={24} />
                    <span className="flex-1 min-w-0 truncate text-[13.5px] text-mv-text">
                      {m.profile.display_name || m.profile.username}
                    </span>
                    <Toggle
                      size="sm"
                      label={`${has ? 'Tirar' : 'Dar'} o cargo para ${m.profile.username}`}
                      checked={has}
                      onChange={async () => {
                        setMemberError(null)
                        const { error } = await onToggleMember(m.user_id, has)
                        if (error) setMemberError(error)
                      }}
                    />
                  </div>
                )
              })}
            </div>
            {memberError && <p className="text-[12.5px] text-rose-300 mt-1.5">{memberError}</p>}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between">
            <p className="field-label">Permissões</p>
            <span className="chip mb-[0.45rem]">{permissions.size} ativas</span>
          </div>
          <div className="rounded-xl border border-[var(--color-line)] divide-y divide-[var(--color-line)] max-h-64 overflow-y-auto">
            {PERMISSIONS.map((p) => (
              <div key={p} className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white/[0.015]">
                <span className={`text-[13.5px] ${p === 'administrator' ? 'text-amber-300' : 'text-mv-text'}`}>
                  {PERMISSION_LABELS[p]}
                </span>
                <Toggle size="sm" label={PERMISSION_LABELS[p]} checked={permissions.has(p)} onChange={() => togglePermission(p)} />
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  )
}
