const PREFIX = 'MAMACOS_INVITE:'

export interface InvitePayload {
  code: string
  serverId: string
  serverName: string
  channelId?: string
  channelName?: string
}

export function buildInviteMessage(payload: InvitePayload): string {
  return PREFIX + JSON.stringify(payload)
}

export function parseInviteMessage(content: string): InvitePayload | null {
  if (!content.startsWith(PREFIX)) return null
  try {
    const parsed = JSON.parse(content.slice(PREFIX.length))
    if (typeof parsed?.code === 'string' && typeof parsed?.serverId === 'string') return parsed as InvitePayload
    return null
  } catch {
    return null
  }
}
