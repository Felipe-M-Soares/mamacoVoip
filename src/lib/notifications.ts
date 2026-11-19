export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  return Notification.requestPermission()
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export function notify(title: string, body: string) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (!document.hidden) return
  try {
    new Notification(title, { body, icon: '/logo-192.png' })
  } catch {
  }
}

export type NotificationTarget = { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string }

export function showMessageNotification(title: string, body: string, target: NotificationTarget, icon?: string | null) {
  const api = window.electronAPI
  if (api?.showNotification) {
    void api.showNotification({ title, body, target }).catch(() => {})
    api.flashWindow?.()
    return
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, { body, icon: icon || '/logo-192.png', tag: `mv-${target.kind}-${target.id}` })
    n.onclick = () => {
      window.focus()
      window.dispatchEvent(new CustomEvent('mv:open-target', { detail: target }))
      n.close()
    }
  } catch {
  }
}
