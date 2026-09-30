import { supabase } from './supabase'

// Chamadas a funções do banco que podem ainda não existir no projeto
// (migration nova ainda não aplicada) — sem depender dos tipos gerados.
// Quem chama decide o que fazer com `missing` (em geral: seguir sem o
// recurso, sem travar o app).

type RpcResult<T> = { data: T | null; error: { message: string; code?: string } | null; missing: boolean }

type LooseRpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>

/** O erro indica "função/coluna/tabela não existe" (migration não aplicada)? */
export function isMissingDbObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; message?: unknown }
  const code = typeof e.code === 'string' ? e.code : ''
  // 42883 = undefined_function; PGRST202 = função não achada no cache do
  // PostgREST; 42703 = coluna; 42P01/PGRST205 = tabela; PGRST204 = coluna no cache.
  if (['42883', 'PGRST202', '42703', '42P01', 'PGRST205', 'PGRST204'].includes(code)) return true
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
  return (
    msg.includes('could not find the function') ||
    (msg.includes('function') && msg.includes('does not exist')) ||
    (msg.includes('column') && msg.includes('does not exist')) ||
    msg.includes('schema cache')
  )
}

export async function callRpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<RpcResult<T>> {
  try {
    const rpc = supabase.rpc.bind(supabase) as unknown as LooseRpc
    const { data, error } = await rpc(fn, args)
    if (error) {
      const e = error as { message?: string; code?: string }
      return { data: null, error: { message: e.message ?? 'Erro desconhecido', code: e.code }, missing: isMissingDbObject(error) }
    }
    return { data: data as T, error: null, missing: false }
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) }, missing: false }
  }
}
