import { useState } from 'react'
import { MessageList } from '../chat/MessageList'
import { MessageComposer } from '../chat/MessageComposer'
import { SearchModal } from '../modals/SearchModal'
import { useMessages } from '../../hooks/useMessages'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useChannels } from '../../hooks/useChannels'
import { useAuth } from '../../hooks/useAuth'
import type { Channel, Message, Server, Profile } from '../../types/database'

export function ChatArea({
  channel,
  server,
  onViewProfile,
  onJumpToChannel,
  onToggleMembers,
}: {
  channel: Channel
  server: Server
  onViewProfile: (profile: Profile) => void
  onJumpToChannel: (channel: Channel) => void
  onToggleMembers?: () => void
}) {
  const { user } = useAuth()
  const { messages, attachments, reactions, sendMessage, editMessage, deleteMessage, toggleReaction } =
    useMessages(channel.id, server.id)
  const { members } = useServerMembers(server.id)
  const { channels } = useChannels()
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [showSearch, setShowSearch] = useState(false)

  const profilesById = Object.fromEntries(members.map((m) => [m.user_id, m.profile]))
  const memberProfiles = members.map((m) => m.profile)
  const isServerOwner = server.owner_id === user?.id

  async function handleSend(content: string, files: File[]) {
    if (content.length === 0 && files.length === 0) return
    await sendMessage(content, replyingTo?.id ?? null, files)
    setReplyingTo(null)
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels">
      <header className="h-12 px-4 flex items-center gap-2 border-b border-black/20 shadow-sm shrink-0">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-text-muted">
          <path d="M5.5 4.5c.5-.5 1.2-.8 2-.8h1.4l-.3 15h-1c-.8 0-1.5-.3-2-.8-.6-.5-.9-1.2-.9-2v-9.4c0-.8.3-1.5.8-2zm10 0c.5.5.8 1.2.8 2v9.4c0 .8-.3 1.5-.8 2-.5.5-1.2.8-2 .8h-1l-.3-15h1.4c.8 0 1.5.3 2 .8z" />
        </svg>
        <h2 className="font-display font-semibold tracking-wide text-white flex-1">{channel.name}</h2>
        <button
          onClick={() => setShowSearch(true)}
          title="Pesquisar mensagens"
          className="text-discord-text-muted hover:text-white transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M10 4a6 6 0 1 0 3.76 10.66l5.29 5.29a1 1 0 0 0 1.41-1.41l-5.29-5.29A6 6 0 0 0 10 4zm-4 6a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" />
          </svg>
        </button>
        {onToggleMembers && (
          <button
            onClick={onToggleMembers}
            title="Membros"
            className="lg:hidden text-discord-text-muted hover:text-white transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
            </svg>
          </button>
        )}
      </header>

      <MessageList
        channelName={channel.name}
        messages={messages}
        attachments={attachments}
        reactions={reactions}
        profilesById={profilesById}
        currentUserId={user?.id}
        isServerOwner={isServerOwner}
        members={memberProfiles}
        onEdit={editMessage}
        onDelete={deleteMessage}
        onReply={setReplyingTo}
        onToggleReaction={toggleReaction}
        onViewProfile={onViewProfile}
      />

      <MessageComposer
        channelName={channel.name}
        members={memberProfiles}
        replyingTo={replyingTo}
        replyingToAuthor={replyingTo ? profilesById[replyingTo.author_id] : undefined}
        onCancelReply={() => setReplyingTo(null)}
        onSend={handleSend}
      />

      {showSearch && (
        <SearchModal
          serverId={server.id}
          channels={channels}
          onClose={() => setShowSearch(false)}
          onJumpToChannel={onJumpToChannel}
        />
      )}
    </section>
  )
}
