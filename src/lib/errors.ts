// Erros do supabase-js (PostgrestError, AuthError, StorageError, etc.) são
// objetos simples — NÃO são `instanceof Error` — então um catch que só
// checa `instanceof Error` cai sempre num texto genérico de fallback,
// mesmo quando o erro real tem uma `.message` útil (ex.: "new row
// violates row-level security policy", "permission denied", etc.). Essa
// função central extrai a mensagem de qualquer formato de erro que o
// supabase-js devolve (ou de uma exceção "normal" do JS), e usa
// `.code`/`.hint` quando existem (comuns em erros de RLS/Postgres) pra
// dar um diagnóstico mais completo.
export function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown; hint?: unknown; details?: unknown }
    if (typeof e.message === 'string' && e.message) {
      const parts = [e.message]
      if (typeof e.code === 'string' && e.code) parts.push(`código: ${e.code}`)
      if (typeof e.hint === 'string' && e.hint) parts.push(`dica: ${e.hint}`)
      if (typeof e.details === 'string' && e.details) parts.push(e.details)
      return parts.join(' — ')
    }
  }
  if (err instanceof Error && err.message) return err.message
  return fallback
}
