import { supabase } from './supabase'
import { isNativeMobileApp } from './platform'

// Notificações no celular (Firebase Cloud Messaging). O app registra o
// "endereço" do aparelho na conta (register_push_token) e o servidor
// manda a notificação quando chega mensagem (ver supabase/functions/
// push-notify e docs/NOTIFICACOES.md). Só liga quando o APK foi gerado
// com o Firebase configurado (VITE_PUSH_ENABLED) — sem isso, nem tenta
// (chamar o Firebase sem configuração fecha o app no Android).

export type PushTarget = { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string }

let currentToken: string | null = null
let started = false
let pending: PushTarget | null = null

function pushEnabled(): boolean {
  return isNativeMobileApp() && import.meta.env.VITE_PUSH_ENABLED === '1'
}

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

/** Notificação tocada com o app fechado: o layout pega quando montar. */
export function consumePendingPushTarget(): PushTarget | null {
  const t = pending
  pending = null
  return t
}

export async function initPushNotifications(): Promise<void> {
  if (!pushEnabled() || started) return
  started = true
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

    await PushNotifications.addListener('registration', ({ value }) => {
      currentToken = value
      void supabase.rpc('register_push_token', { p_token: value, p_platform: 'android' })
    })
    await PushNotifications.addListener('registrationError', (e) => {
      console.warn('[push] registro falhou', e?.error)
    })
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const t = parsePushTarget(action.notification?.data)
      if (t) openTarget(t)
    })

    let perm = await PushNotifications.checkPermissions()
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return
    await PushNotifications.register()
  } catch (err) {
    started = false
    console.warn('[push] não iniciou', err)
  }
}

/** Ao sair da conta: este aparelho para de receber as notificações dela. */
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
    // best-effort
  }
}
