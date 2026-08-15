// Notificações do navegador. Só disparam se o usuário concedeu permissão
// E a aba está em segundo plano — não interrompe quem já está olhando
// a conversa.
//
// Limitação de escopo: como não há um servidor de push dedicado, só
// notificamos eventos de canais/DMs que já estão com uma subscription
// de realtime ativa no navegador (ou seja, a conversa/canal precisa
// estar aberta na aba pra a notificação disparar quando ela perde o
// foco). Push de verdade pra canais fechados exigiria Web Push +
// Service Worker com VAPID keys, fora do escopo deste clone.

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
    // alguns navegadores restringem Notification fora de um gesto do
    // usuário ou contexto seguro — falha silenciosa é aceitável aqui
  }
}
