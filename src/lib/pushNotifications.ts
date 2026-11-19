import { supabase } from './supabase'
import { isNativeMobileApp } from './platform'

export type PushTarget = { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string }

let currentToken: string | null = null
let started = false
let pending: PushTarget | null = null

export type PushStatus =
  | { kind: 'off' }
  | { kind: 'starting' }
  | { kind: 'denied' }
  | { kind: 'error'; detail: string }
  | { kind: 'ok' }

let status: PushStatus = { kind: 'off' }
const statusListeners = new Set<() => void>()

function setStatus(next: PushStatus) {
  status = next
  for (const l of statusListeners) l()
}

export function getPushStatus(): PushStatus {
  return status
}

export function subscribePushStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function pushAvailable(): boolean {
  return isNativeMobileApp()
}

function pushEnabled(): boolean {
  return isNativeMobileApp() && import.meta.env.VITE_PUSH_ENABLED === '1'
}

async function saveToken(value: string) {
  currentToken = value
  const { error } = await supabase.rpc('register_push_token', { p_token: value, p_platform: 'android' })
  if (error) setStatus({ kind: 'error', detail: `Não foi possível salvar o registro: ${error.message}` })
  else setStatus({ kind: 'ok' })
}

let listenersAdded = false

export function parsePushTarget(data: unknown): PushTarget | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const kind = d.kind
  const id = d.id
  if ((kind !== 'dm' && kind !== 'group' && kind !== 'channel') || typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null
  const serverId = typeof d.serverId === 'string' && /^[0-9a-f-]{36}$/i.test(d.serverId) ? d.serverId : undefined
  if (kind === 'channel' && !serverId) return null
  return { kind, id, serverId }
}

function openTarget(t: PushTarget) {
  pending = t
  window.dispatchEvent(new CustomEvent('mv:open-target', { detail: t }))
}

export function consumePendingPushTarget(): PushTarget | null {
  const t = pending
  pending = null
  return t
}

export async function initPushNotifications(): Promise<void> {
  if (isNativeMobileApp() && import.meta.env.VITE_PUSH_ENABLED !== '1') {
    setStatus({ kind: 'error', detail: 'Esta versão do app foi gerada sem o Firebase. Atualize o app.' })
    return
  }
  if (!pushEnabled() || started) return
  started = true
  setStatus({ kind: 'starting' })
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.createChannel({
      id: 'mensagens',
      name: 'Mensagens',
      description: 'Mensagens diretas, grupos e menções',
      importance: 4,
      visibility: 0,
      vibration: true,
    }).catch(() => {})
    await PushNotifications.createChannel({
      id: 'chamadas',
      name: 'Chamadas',
      description: 'Quando alguém te liga',
      importance: 5,
      visibility: 1,
      vibration: true,
    }).catch(() => {})

    if (!listenersAdded) {
      listenersAdded = true
      await PushNotifications.addListener('registration', ({ value }) => {
        void saveToken(value)
      })
      await PushNotifications.addListener('registrationError', (e) => {
        setStatus({ kind: 'error', detail: `O Firebase recusou o registro: ${e?.error ?? 'erro desconhecido'}` })
      })
      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const t = parsePushTarget(action.notification?.data)
        if (t) openTarget(t)
      })
    }

    let perm = await PushNotifications.checkPermissions()
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') {
      started = false
      setStatus({ kind: 'denied' })
      return
    }
    await PushNotifications.register()
  } catch (err) {
    started = false
    setStatus({ kind: 'error', detail: err instanceof Error ? err.message : String(err) })
  }
}

export async function retryPushNotifications(): Promise<void> {
  started = false
  await initPushNotifications()
}

export async function unregisterPushToken(): Promise<void> {
  if (!pushEnabled() || !currentToken) return
  const token = currentToken
  currentToken = null
  started = false
  try {
    await Promise.race([
      supabase.rpc('unregister_push_token', { p_token: token }),
      new Promise((r) => setTimeout(r, 2500)),
    ])
  } catch {
  }
}
