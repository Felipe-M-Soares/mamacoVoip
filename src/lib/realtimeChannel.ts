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

export function uniqueTopic(base: string): string {
  return `${base}:${Math.random().toString(36).slice(2)}`
}

/**
 * Abre um canal de nome compartilhado (broadcast/presence) de forma segura
 * contra remontagens rápidas. `setup` recebe o canal novo (antes do
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
    channel = supabase.channel(topic, params)
    setup(channel)
  }

  const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
  if (stale) {
    supabase
      .removeChannel(stale)
      .catch(() => {
        // best-effort — segue criando o canal novo mesmo assim
      })
      .finally(start)
  } else {
    start()
  }

  return () => {
    cancelled = true
    if (channel) void supabase.removeChannel(channel)
  }
}
