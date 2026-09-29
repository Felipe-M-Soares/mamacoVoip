import { useState } from 'react'
import { Modal } from './Modal'
import { Toggle } from '../ui/Toggle'
import { EmptyState } from './settingsUI'
import { useRoles } from '../../hooks/useRoles'
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

const PRESET_COLORS = ['#99aab5', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#e91e63']

export function RolesManagerModal({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const { roles, createRole, updateRole, deleteRole } = useRoles(serverId)
  const [editing, setEditing] = useState<Role | 'new' | null>(null)

  if (editing) {
    return (
      <RoleEditor
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
      description="Cargos agrupam permissões e dão cor ao nome dos membros."
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <button
        onClick={() => setEditing('new')}
        className="w-full h-11 mb-4 rounded-xl border border-dashed border-[var(--color-line-strong)] text-[14px] font-medium text-discord-text-muted hover:text-white hover:border-discord-blurple/60 hover:bg-discord-blurple/[0.06] transition-colors flex items-center justify-center gap-2"
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
          roles.map((role) => (
            <button
              key={role.id}
              onClick={() => setEditing(role)}
              className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] hover:bg-white/[0.05] text-left transition-colors"
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
              <span className="chip">{role.permissions.length} permissões</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-discord-text-muted opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}

function RoleEditor({
  role,
  onSave,
  onDelete,
  onCancel,
}: {
  role: Role | null
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
        <p className="text-[14px] text-discord-text-muted leading-relaxed">
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
              className="w-full pl-8 pr-3 py-2.5 bg-discord-darker text-discord-text outline-none"
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
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <p className="field-label">Permissões</p>
            <span className="chip mb-[0.45rem]">{permissions.size} ativas</span>
          </div>
          <div className="rounded-xl border border-[var(--color-line)] divide-y divide-[var(--color-line)] max-h-64 overflow-y-auto">
            {PERMISSIONS.map((p) => (
              <div key={p} className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white/[0.015]">
                <span className={`text-[13.5px] ${p === 'administrator' ? 'text-amber-300' : 'text-discord-text'}`}>
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
