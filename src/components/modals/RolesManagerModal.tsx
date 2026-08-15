import { useState } from 'react'
import { Modal } from './Modal'
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
    <Modal title="Cargos do servidor" onClose={onClose} maxWidth="max-w-lg">
      <button
        onClick={() => setEditing('new')}
        className="w-full py-2.5 rounded bg-discord-blurple text-white font-medium hover:opacity-90 transition-colors mb-4"
      >
        + Criar cargo
      </button>

      <div className="space-y-1 max-h-96 overflow-y-auto">
        {roles.length === 0 ? (
          <p className="text-sm text-discord-text-muted">Nenhum cargo criado ainda.</p>
        ) : (
          roles.map((role) => (
            <button
              key={role.id}
              onClick={() => setEditing(role)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded hover:bg-white/5 text-left"
            >
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
              <span className="text-sm text-white flex-1 truncate">{role.name}</span>
              <span className="text-xs text-discord-text-muted">{role.permissions.length} permissões</span>
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
      <Modal title={`Excluir cargo '${role?.name}'`} onClose={onCancel}>
        <p className="text-sm text-discord-text-muted">
          Tem certeza que deseja excluir o cargo <span className="text-white font-medium">{role?.name}</span>? Todos
          os membros perderão esse cargo.
        </p>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => setConfirmingDelete(false)} className="px-4 py-2 text-sm text-discord-text-muted hover:underline">
            Cancelar
          </button>
          <button
            onClick={onDelete}
            className="px-4 py-2 text-sm rounded bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
          >
            Excluir cargo
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={role ? 'Editar cargo' : 'Criar cargo'} onClose={onCancel} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">Nome do cargo</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">Cor</label>
          <div className="flex gap-2 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-8 h-8 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">Permissões</label>
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-2.5 text-sm text-discord-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={permissions.has(p)}
                  onChange={() => togglePermission(p)}
                  className="w-4 h-4 accent-discord-blurple"
                />
                {PERMISSION_LABELS[p]}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full py-2.5 rounded bg-discord-blurple text-white font-medium hover:opacity-90 transition-colors disabled:opacity-60"
        >
          {loading ? 'Salvando...' : 'Salvar'}
        </button>

        {onDelete && (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="w-full py-2.5 rounded border border-red-600 text-red-500 hover:bg-red-600/10 transition-colors"
          >
            Excluir cargo
          </button>
        )}

        <button onClick={onCancel} className="w-full text-sm text-discord-text-muted hover:underline">
          Voltar
        </button>
      </div>
    </Modal>
  )
}
