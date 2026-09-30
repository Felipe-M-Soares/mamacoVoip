import type { RealtimeChannel, RealtimeChannelOptions } from '@supabase/supabase-js'
import { supabase } from './supabase'

// Utilitários pra abrir canais do Supabase Realtime sem cair nas duas
// armadilhas que já apareceram várias vezes no app:
//
// 1) `supabase.channel(topic)` DEVOLVE O CANAL JÁ EXISTENTE se houver um
//    com o mesmo nome. Como `removeChannel()` é assíncrono (espera o
//    servidor confirmar a saída), remontar um efeito rápido demais
//    (StrictMode em dev, trocar de canal e voltar em menos de ~1s) pegava
//    o canal ANTIGO, ainda "saindo" — o `.subscribe()` nele não faz nada
//    e a assinatura morre em silêncio (ou `.on()` lança "cannot add
//    postgres_changes callbacks after subscribe()").
//
// 2) Pra postgres_changes o nome do canal é só um identificador local
//    (o filtro vai no `.on()`), então dá pra usar um sufixo aleatório e
//    nunca colidir — `uniqueTopic()`. Já broadcast/presence PRECISAM do
//    mesmo nome em todos os clientes (é a "sala"), então nesses casos
//    `openSharedChannel()` espera o canal antigo terminar de sair antes
//    de criar o novo.

// 3) Canais de broadcast/presence são PRIVADOS (`config.private: true`):
//    o servidor do Realtime só deixa entrar/enviar quem passa nas
//    políticas de RLS em `realtime.messages` (migration 016 — ex.:
//    `voice:<id>` só pra quem pode ver aquele canal de voz). Canal
//    privado exige o JWT do usuário no socket; o supabase-js v2 já faz
//    `realtime.setAuth()` sozinho a cada login/renovação de token, mas
//    `ensureRealtimeAuth()` força isso antes de assinar (evita a corrida
//    de assinar antes do INITIAL_SESSION chegar ao cliente Realtime).
//    Lembrete: pra isso valer de verdade, desligue "Allow public access"
//    em Realtime → Settings no painel do Supabase.

/** Garante que o socket do Realtime está com o JWT atual (best-effort). */
export async function ensureRealtimeAuth(): Promise<void> {
  try {
    await supabase.realtime.setAuth()
  } catch {
    // Sem sessão/rede — a assinatura privada vai falhar e o chamador trata.
  }
}

/** Opções de canal com `private: true` preservando o resto da config. */
export function privateChannelParams(params: RealtimeChannelOptions = { config: {} }): RealtimeChannelOptions {
  return { ...params, config: { ...(params.config ?? {}), private: true } }
}

// 4) TODOS os canais do app são privados — inclusive os de
//    postgres_changes. Com "Allow public access" desligado no painel
//    (recomendado), o servidor do Realtime RECUSA canal não privado.
//    Os tópicos de postgres_changes levam o prefixo `pgc:`, que a
//    política de `realtime.messages` (realtime_topic_allowed, migration
//    007) libera só para LEITURA a qualquer logado com o 2FA em dia — o
//    join do canal privado checa leitura em broadcast/presence; ninguém
//    consegue ENVIAR nada nesses tópicos. As linhas que chegam por
//    postgres_changes continuam filtradas pela RLS de cada tabela.
export const CHANGES_TOPIC_PREFIX = 'pgc:'

export function uniqueTopic(base: string): string {
  return `${CHANGES_TOPIC_PREFIX}${base}:${Math.random().toString(36).slice(2)}`
}

/**
 * Canal PRIVADO pra postgres_changes, com nome único (`pgc:<nome>:<aleatório>`).
 * Uso igual ao `supabase.channel(...)`: registre os `.on(...)` e chame
 * `.subscribe()`. O subscribe espera `ensureRealtimeAuth()` (canal privado
 * sem JWT no socket é recusado) e não faz nada se o canal já tiver sido
 * removido nesse meio-tempo (limpeza do useEffect antes do token chegar).
 */
export function changesChannel(name: string): RealtimeChannel {
  const channel = supabase.channel(uniqueTopic(name), privateChannelParams())
  const originalSubscribe = channel.subscribe.bind(channel)
  channel.subscribe = ((...args: Parameters<RealtimeChannel['subscribe']>) => {
    void ensureRealtimeAuth().finally(() => {
      if (!supabase.getChannels().includes(channel)) return
      originalSubscribe(...args)
    })
    return channel
  }) as RealtimeChannel['subscribe']
  return channel
}

/**
 * Abre um canal PRIVADO de nome compartilhado (broadcast/presence) de
 * forma segura contra remontagens rápidas. `setup` recebe o canal novo (antes do
 * subscribe) pra registrar os `.on(...)` e deve chamar `.subscribe()`.
 * Devolve a função de limpeza pra usar no retorno do useEffect.
 */
export function openSharedChannel(
  topic: string,
  params: RealtimeChannelOptions,
  setup: (channel: RealtimeChannel) => void
): () => void {
  let cancelled = false
  let channel: RealtimeChannel | null = null

  const start = () => {
    if (cancelled) return
    channel = supabase.channel(topic, privateChannelParams(params))
    setup(channel)
  }

  const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
  const removeStale = stale
    ? supabase.removeChannel(stale).catch(() => {
        // best-effort — segue criando o canal novo mesmo assim
      })
    : Promise.resolve()
  void Promise.all([removeStale, ensureRealtimeAuth()]).finally(start)

  return () => {
    cancelled = true
    if (channel) void supabase.removeChannel(channel)
  }
}
