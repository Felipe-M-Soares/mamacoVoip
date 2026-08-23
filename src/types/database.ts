export type ProfileStatus = 'online' | 'idle' | 'dnd' | 'offline'

export type ProfileVisibility = 'everyone' | 'friends_only'

export type Profile = {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  status: ProfileStatus
  custom_status: string | null
  playing: string | null
  profile_visibility: ProfileVisibility
  created_at: string
  updated_at: string
}

export type ServerEmoji = {
  id: string
  server_id: string
  name: string
  image_url: string
  created_by: string | null
  created_at: string
}

export type SoundboardSound = {
  id: string
  server_id: string
  name: string
  storage_path: string
  uploaded_by: string | null
  play_count: number
  created_at: string
}

export type ServerEvent = {
  id: string
  server_id: string
  channel_id: string | null
  name: string
  description: string | null
  starts_at: string
  ends_at: string | null
  created_by: string | null
  created_at: string
}

export type Server = {
  id: string
  name: string
  icon_url: string | null
  banner_url: string | null
  description: string | null
  owner_id: string
  afk_channel_id: string | null
  afk_timeout_minutes: number
  created_at: string
  updated_at: string
}

export type ServerMember = {
  server_id: string
  user_id: string
  nickname: string | null
  joined_at: string
  timeout_until: string | null
}

export type Role = {
  id: string
  server_id: string
  name: string
  color: string
  position: number
  permissions: string[]
  created_at: string
}

export type ServerMemberRole = {
  server_id: string
  user_id: string
  role_id: string
  assigned_at: string
}

export type Ban = {
  server_id: string
  user_id: string
  banned_by: string
  reason: string | null
  created_at: string
}

export type ModerationAction =
  | 'kick'
  | 'ban'
  | 'unban'
  | 'timeout'
  | 'remove_timeout'
  | 'role_created'
  | 'role_deleted'
  | 'role_assigned'
  | 'role_removed'
  | 'message_deleted'

export type ModerationLog = {
  id: string
  server_id: string
  actor_id: string
  action: ModerationAction
  target_user_id: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export const PERMISSIONS = [
  'administrator',
  'manage_server',
  'manage_roles',
  'manage_channels',
  'manage_messages',
  'kick_members',
  'ban_members',
  'timeout_members',
  'view_audit_log',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export type ChannelReadState = {
  channel_id: string
  user_id: string
  last_read_at: string
}

export type DMReadState = {
  conversation_id: string
  user_id: string
  last_read_at: string
}

export type ServerInvite = {
  id: string
  server_id: string
  code: string
  created_by: string
  max_uses: number | null
  uses: number
  expires_at: string | null
  created_at: string
}

export type ChannelType = 'text' | 'voice'

export type Category = {
  id: string
  server_id: string
  name: string
  position: number
  created_at: string
}

export type Channel = {
  id: string
  server_id: string
  category_id: string | null
  name: string
  type: ChannelType
  topic: string | null
  is_stage: boolean
  is_spoiler: boolean
  slowmode_seconds: number
  user_limit: number
  is_restricted: boolean
  position: number
  created_at: string
}

export type Thread = {
  id: string
  channel_id: string
  server_id: string
  parent_message_id: string
  name: string
  created_by: string | null
  created_at: string
}

export type Message = {
  id: string
  channel_id: string
  server_id: string
  author_id: string
  content: string
  reply_to_id: string | null
  edited_at: string | null
  pinned_at: string | null
  pinned_by: string | null
  thread_id: string | null
  system_event: string | null
  created_at: string
}

export type MessageAttachment = {
  id: string
  message_id: string
  file_url: string
  file_name: string
  file_size: number
  mime_type: string
  created_at: string
}

export type MessageReaction = {
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}

export type FriendshipStatus = 'pending' | 'accepted'

export type Friendship = {
  id: string
  user_id: string
  friend_id: string
  status: FriendshipStatus
  request_note: string | null
  created_at: string
}

export type BlockedUser = {
  blocker_id: string
  blocked_id: string
  created_at: string
}

export type DMConversation = {
  id: string
  user_a: string
  user_b: string
  created_at: string
  hidden_for_a: boolean
  hidden_for_b: boolean
}

export type GroupConversation = {
  id: string
  name: string | null
  icon_url: string | null
  created_by: string | null
  created_at: string
}

export type GroupMessage = {
  id: string
  group_id: string
  author_id: string
  content: string
  reply_to_id: string | null
  edited_at: string | null
  created_at: string
}

export type GroupMessageAttachment = {
  id: string
  message_id: string
  file_url: string
  file_name: string
  file_size: number
  mime_type: string
  created_at: string
}

export type DMMessageAttachment = {
  id: string
  message_id: string
  file_url: string
  file_name: string
  file_size: number
  mime_type: string
  created_at: string
}

export type DMMessage = {
  id: string
  conversation_id: string
  author_id: string
  content: string
  reply_to_id: string | null
  edited_at: string | null
  created_at: string
}

// Estrutura completa do banco (crescerá a cada fase: channels,
// messages, etc. serão adicionados aqui conforme forem criados no Supabase)
//
// Observação: RLS é quem de fato bloqueia inserts/updates indevidos no
// servidor. Os tipos "Insert"/"Update" aqui servem só pra checagem no
// frontend.
//
// IMPORTANTE: use sempre `type` (não `interface`) para Row/Insert/Update.
// O postgrest-js exige que cada tabela seja estruturalmente um
// `Record<string, unknown>` (ver GenericTable), e por uma particularidade
// do TypeScript, `interface` não satisfaz essa checagem em posição de tipo
// condicional (`extends`) mesmo quando a atribuição direta funcionaria.
// `type` alias com o mesmo shape funciona normalmente.
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Pick<Profile, 'id' | 'username'> & Partial<Omit<Profile, 'id' | 'username'>>
        Update: Partial<Pick<Profile, 'username' | 'display_name' | 'avatar_url' | 'status' | 'custom_status' | 'playing' | 'profile_visibility'>>
        Relationships: []
      }
      servers: {
        Row: Server
        Insert: Pick<Server, 'name' | 'owner_id'> & Partial<Pick<Server, 'icon_url' | 'description' | 'banner_url'>>
        Update: Partial<Pick<Server, 'name' | 'icon_url' | 'description' | 'banner_url' | 'afk_channel_id' | 'afk_timeout_minutes'>>
        Relationships: []
      }
      server_members: {
        Row: ServerMember
        Insert: Pick<ServerMember, 'server_id' | 'user_id'> & Partial<Pick<ServerMember, 'nickname'>>
        Update: Partial<Pick<ServerMember, 'nickname'>>
        Relationships: []
      }
      server_invites: {
        Row: ServerInvite
        Insert: Pick<ServerInvite, 'server_id' | 'code' | 'created_by'> &
          Partial<Pick<ServerInvite, 'max_uses' | 'expires_at'>>
        Update: Partial<Pick<ServerInvite, 'uses'>>
        Relationships: []
      }
      categories: {
        Row: Category
        Insert: Pick<Category, 'server_id' | 'name'> & Partial<Pick<Category, 'position'>>
        Update: Partial<Pick<Category, 'name' | 'position'>>
        Relationships: []
      }
      channels: {
        Row: Channel
        Insert: Pick<Channel, 'server_id' | 'name' | 'type'> &
          Partial<Pick<Channel, 'category_id' | 'position' | 'is_stage' | 'slowmode_seconds' | 'is_spoiler' | 'user_limit' | 'is_restricted'>>
        Update: Partial<Pick<Channel, 'name' | 'category_id' | 'position' | 'topic' | 'is_stage' | 'slowmode_seconds' | 'is_spoiler' | 'user_limit' | 'is_restricted'>>
        Relationships: []
      }
      channel_role_access: {
        Row: { channel_id: string; role_id: string }
        Insert: { channel_id: string; role_id: string }
        Update: never
        Relationships: []
      }
      messages: {
        Row: Message
        Insert: Pick<Message, 'channel_id' | 'server_id' | 'author_id' | 'content'> &
          Partial<Pick<Message, 'reply_to_id' | 'thread_id'>>
        Update: Partial<Pick<Message, 'content' | 'pinned_at' | 'pinned_by'>>
        Relationships: []
      }
      threads: {
        Row: Thread
        Insert: Pick<Thread, 'channel_id' | 'server_id' | 'parent_message_id' | 'name' | 'created_by'>
        Update: Record<string, never>
        Relationships: []
      }
      message_attachments: {
        Row: MessageAttachment
        Insert: Pick<MessageAttachment, 'message_id' | 'file_url' | 'file_name' | 'file_size' | 'mime_type'>
        Update: never
        Relationships: []
      }
      message_reactions: {
        Row: MessageReaction
        Insert: Pick<MessageReaction, 'message_id' | 'user_id' | 'emoji'>
        Update: never
        Relationships: []
      }
      friendships: {
        Row: Friendship
        Insert: never // inserts só via send_friend_request()
        Update: never
        Relationships: []
      }
      blocked_users: {
        Row: BlockedUser
        Insert: never // inserts só via block_user()
        Update: never
        Relationships: []
      }
      dm_conversations: {
        Row: DMConversation
        Insert: never // inserts só via get_or_create_dm()
        Update: never
        Relationships: []
      }
      dm_messages: {
        Row: DMMessage
        Insert: Pick<DMMessage, 'conversation_id' | 'author_id' | 'content'> & Partial<Pick<DMMessage, 'reply_to_id'>>
        Update: Partial<Pick<DMMessage, 'content'>>
        Relationships: []
      }
      dm_message_attachments: {
        Row: DMMessageAttachment
        Insert: Pick<DMMessageAttachment, 'message_id' | 'file_url' | 'file_name' | 'file_size' | 'mime_type'>
        Update: Record<string, never>
        Relationships: []
      }
      group_conversations: {
        Row: GroupConversation
        Insert: Partial<Pick<GroupConversation, 'name' | 'icon_url'>> & Pick<GroupConversation, 'created_by'>
        Update: Partial<Pick<GroupConversation, 'name' | 'icon_url'>>
        Relationships: []
      }
      group_conversation_members: {
        Row: { group_id: string; user_id: string; joined_at: string }
        Insert: { group_id: string; user_id: string }
        Update: Record<string, never>
        Relationships: []
      }
      group_messages: {
        Row: GroupMessage
        Insert: Pick<GroupMessage, 'group_id' | 'author_id' | 'content'> & Partial<Pick<GroupMessage, 'reply_to_id'>>
        Update: Partial<Pick<GroupMessage, 'content'>>
        Relationships: []
      }
      group_message_attachments: {
        Row: GroupMessageAttachment
        Insert: Pick<GroupMessageAttachment, 'message_id' | 'file_url' | 'file_name' | 'file_size' | 'mime_type'>
        Update: Record<string, never>
        Relationships: []
      }
      roles: {
        Row: Role
        Insert: never // inserts só via create_role()
        Update: never
        Relationships: []
      }
      server_member_roles: {
        Row: ServerMemberRole
        Insert: never // inserts só via assign_role()
        Update: never
        Relationships: []
      }
      bans: {
        Row: Ban
        Insert: never // inserts só via ban_member()
        Update: never
        Relationships: []
      }
      moderation_logs: {
        Row: ModerationLog
        Insert: never // inserts só pelas funções de moderação (security definer)
        Update: never
        Relationships: []
      }
      channel_read_state: {
        Row: ChannelReadState
        Insert: Pick<ChannelReadState, 'channel_id' | 'user_id'> & Partial<Pick<ChannelReadState, 'last_read_at'>>
        Update: Partial<Pick<ChannelReadState, 'last_read_at'>>
        Relationships: []
      }
      channel_mutes: {
        Row: { user_id: string; channel_id: string; created_at: string; mentions_only: boolean }
        Insert: { user_id: string; channel_id: string; mentions_only?: boolean }
        Update: Partial<{ mentions_only: boolean }>
        Relationships: []
      }
      server_emojis: {
        Row: ServerEmoji
        Insert: Pick<ServerEmoji, 'server_id' | 'name' | 'image_url'> & Partial<Pick<ServerEmoji, 'created_by'>>
        Update: Record<string, never>
        Relationships: []
      }
      server_events: {
        Row: ServerEvent
        Insert: Pick<ServerEvent, 'server_id' | 'name' | 'starts_at' | 'created_by'> &
          Partial<Pick<ServerEvent, 'channel_id' | 'description' | 'ends_at'>>
        Update: Record<string, never>
        Relationships: []
      }
      server_event_rsvps: {
        Row: { event_id: string; user_id: string; created_at: string }
        Insert: { event_id: string; user_id: string }
        Update: Record<string, never>
        Relationships: []
      }
      dm_read_state: {
        Row: DMReadState
        Insert: Pick<DMReadState, 'conversation_id' | 'user_id'> & Partial<Pick<DMReadState, 'last_read_at'>>
        Update: Partial<Pick<DMReadState, 'last_read_at'>>
        Relationships: []
      }
      soundboard_sounds: {
        Row: SoundboardSound
        Insert: Pick<SoundboardSound, 'id' | 'server_id' | 'name' | 'storage_path' | 'uploaded_by'>
        Update: Record<string, never>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      join_server_via_invite: {
        Args: { p_code: string }
        Returns: Server
      }
      create_server_invite: {
        Args: { p_server_id: string; p_max_uses?: number | null; p_expires_hours?: number | null }
        Returns: ServerInvite
      }
      reorder_channels: {
        Args: { p_category_id: string | null; p_channel_ids: string[] }
        Returns: void
      }
      reorder_categories: {
        Args: { p_server_id: string; p_category_ids: string[] }
        Returns: void
      }
      send_friend_request: {
        Args: { p_username: string }
        Returns: Friendship
      }
      respond_friend_request: {
        Args: { p_request_id: string; p_accept: boolean }
        Returns: void
      }
      remove_friend: {
        Args: { p_other_user_id: string }
        Returns: void
      }
      block_user: {
        Args: { p_user_id: string }
        Returns: void
      }
      unblock_user: {
        Args: { p_user_id: string }
        Returns: void
      }
      get_or_create_dm: {
        Args: { p_other_user_id: string }
        Returns: DMConversation
      }
      hide_dm_conversation: {
        Args: { p_conversation_id: string }
        Returns: void
      }
      create_role: {
        Args: { p_server_id: string; p_name: string; p_color: string; p_permissions: string[] }
        Returns: Role
      }
      update_role: {
        Args: { p_role_id: string; p_name: string; p_color: string; p_permissions: string[] }
        Returns: Role
      }
      delete_role: {
        Args: { p_role_id: string }
        Returns: void
      }
      assign_role: {
        Args: { p_server_id: string; p_user_id: string; p_role_id: string }
        Returns: void
      }
      remove_role: {
        Args: { p_server_id: string; p_user_id: string; p_role_id: string }
        Returns: void
      }
      kick_member: {
        Args: { p_server_id: string; p_user_id: string; p_reason?: string | null }
        Returns: void
      }
      ban_member: {
        Args: { p_server_id: string; p_user_id: string; p_reason?: string | null }
        Returns: void
      }
      unban_member: {
        Args: { p_server_id: string; p_user_id: string }
        Returns: void
      }
      timeout_member: {
        Args: { p_server_id: string; p_user_id: string; p_minutes: number; p_reason?: string | null }
        Returns: void
      }
      remove_timeout: {
        Args: { p_server_id: string; p_user_id: string }
        Returns: void
      }
      has_permission: {
        Args: { p_server_id: string; p_user_id: string; p_permission: string }
        Returns: boolean
      }
      debug_whoami: {
        Args: Record<string, never>
        Returns: { jwt_uid: string | null; jwt_role: string | null }[]
      }
      delete_own_account: {
        Args: Record<string, never>
        Returns: void
      }
      delete_soundboard_sound: {
        Args: { p_sound_id: string }
        Returns: void
      }
      bump_soundboard_play_count: {
        Args: { p_sound_id: string }
        Returns: void
      }
    }
  }
}
