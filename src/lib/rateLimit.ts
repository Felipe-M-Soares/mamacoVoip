// DÉCIMA SÉTIMA RODADA — cooldown simples em memória, por chave (ex.:
// "message:<channelId>", "friend-request", "invite:<serverId>"), pra
// evitar flood ACIDENTAL: duplo clique, uma tecla de atalho presa, um
// bug em loop que fica chamando a mesma função sem parar. NÃO é uma
// barreira de segurança de verdade — roda inteiramente no cliente, e
// qualquer pessoa rodando uma versão modificada do app (ou batendo
// direto na API REST do Supabase, fora deste código) contorna isso sem
// esforço nenhum. Proteção de verdade contra abuso DELIBERADO só pode
// vir do lado do servidor (uma política de RLS, ou lógica dentro da
// própria função do Postgres chamada via `.rpc(...)`) — não mexemos
// nisso aqui porque exigiria revisar as policies/functions já
// publicadas no painel do Supabase deste projeto, fora do alcance
// deste código-fonte sozinho. Trate isso como uma rede de segurança de
// UX, não como proteção contra um usuário malicioso.

const hits = new Map<string, number[]>()

export interface RateLimitResult {
  allowed: boolean
  // Segundos até a próxima tentativa ser permitida — 0 quando `allowed` é true.
  retryAfterSeconds: number
}

// `key` agrupa o que está sendo limitado (ex.: um canal específico, ou
// uma chave fixa/global pra pedidos de amizade); permite até `max`
// chamadas dentro de uma janela deslizante de `windowMs`.
export function checkRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const cutoff = now - windowMs
  const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff)

  if (timestamps.length >= max) {
    hits.set(key, timestamps)
    const retryAfterMs = timestamps[0] + windowMs - now
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
  }

  timestamps.push(now)
  hits.set(key, timestamps)
  return { allowed: true, retryAfterSeconds: 0 }
}

// Atalho pronto pro padrão `{ error: string | null }` já usado em
// sendMessage/sendRequest/createInvite neste projeto — devolve `null`
// quando pode seguir, ou uma mensagem de erro já em português (pronta
// pra `setError`/pro retorno da função) quando estourou o limite.
export function rateLimitError(key: string, max: number, windowMs: number, what: string): string | null {
  const result = checkRateLimit(key, max, windowMs)
  if (result.allowed) return null
  return `Calma aí — ${what} rápido demais. Espera ${result.retryAfterSeconds}s e tenta de novo.`
}
