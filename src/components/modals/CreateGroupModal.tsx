import { useState } from 'react'
import { Modal } from './Modal'
import { Avatar } from '../ui/Avatar'
import { useFriends } from '../../context/FriendsContext'
import { useGroupConversations } from '../../context/GroupConversationsContext'

export function CreateGroupModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (groupId: string) => void
}) {
  const { friends } = useFriends()
  const { createGroup } = useGroupConversations()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  async function handleCreate() {
    setError(null)
    if (selected.size < 2) {
      setError('Escolha pelo menos 2 amigos pro grupo.')
      return
    }
    setLoading(true)
    const { error, groupId } = await createGroup(name, [...selected])
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    if (groupId) onCreated(groupId)
  }

  return (
    <Modal title="Criar grupo" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
            Nome do grupo (opcional)
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Squad de sexta"
            maxLength={60}
            className="w-full px-3 py-2 text-sm rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
            Escolha os amigos ({selected.size} selecionado{selected.size !== 1 ? 's' : ''})
          </label>
          {friends.length === 0 ? (
            <p className="text-sm text-discord-text-muted">
              Você ainda não tem amigos adicionados pra colocar num grupo.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {friends.map((f) => (
                <button
                  key={f.profile.id}
                  onClick={() => toggle(f.profile.id)}
                  className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors ${
                    selected.has(f.profile.id) ? 'bg-discord-blurple/20' : 'hover:bg-white/5'
                  }`}
                >
                  <Avatar name={f.profile.username} avatarUrl={f.profile.avatar_url} size={28} />
                  <span className="flex-1 text-left text-discord-text">
                    {f.profile.display_name || f.profile.username}
                  </span>
                  <input
                    type="checkbox"
                    checked={selected.has(f.profile.id)}
                    readOnly
                    className="w-4 h-4 accent-discord-blurple"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={handleCreate}
          disabled={loading}
          className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
        >
          {loading ? 'Criando...' : 'Criar grupo'}
        </button>
      </div>
    </Modal>
  )
}
