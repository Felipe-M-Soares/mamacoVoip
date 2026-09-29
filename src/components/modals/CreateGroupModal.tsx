import { useState } from 'react'
import { Modal } from './Modal'
import { CheckMark, EmptyState } from './settingsUI'
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
    <Modal
      title="Criar grupo"
      description="Uma conversa privada com vários amigos de uma vez."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary h-9 px-4 text-sm">
            Cancelar
          </button>
          <button onClick={handleCreate} disabled={loading} className="btn-primary h-9 px-4 text-sm">
            {loading ? 'Criando...' : 'Criar grupo'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="create-group-name" className="field-label">
            Nome do grupo (opcional)
          </label>
          <input
            id="create-group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Squad de sexta"
            maxLength={60}
            className="w-full px-3 py-2.5 text-sm bg-discord-darker text-discord-text outline-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <p className="field-label">Escolha os amigos</p>
            <span className="chip mb-[0.45rem]">
              {selected.size} selecionado{selected.size !== 1 ? 's' : ''}
            </span>
          </div>
          {friends.length === 0 ? (
            <EmptyState
              icon={
                <>
                  <circle cx="9" cy="8" r="3.5" />
                  <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />
                </>
              }
              title="Nenhum amigo ainda"
              hint="Você ainda não tem amigos adicionados pra colocar num grupo."
            />
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-0.5 -mx-1 px-1">
              {friends.map((f) => {
                const isSelected = selected.has(f.profile.id)
                return (
                  <button
                    key={f.profile.id}
                    role="checkbox"
                    aria-checked={isSelected}
                    onClick={() => toggle(f.profile.id)}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-[10px] text-sm transition-colors ${
                      isSelected ? 'bg-discord-blurple/[0.12]' : 'hover:bg-white/[0.05]'
                    }`}
                  >
                    <Avatar name={f.profile.username} avatarUrl={f.profile.avatar_url} size={32} />
                    <span className="flex-1 text-left text-[14px] text-discord-text truncate">
                      {f.profile.display_name || f.profile.username}
                    </span>
                    <CheckMark checked={isSelected} />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  )
}
