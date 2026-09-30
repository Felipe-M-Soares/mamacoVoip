#!/usr/bin/env node
// TESTE DE CARGA do chat/Realtime — só com a chave PÚBLICA (anon) e os
// usuários de teste criados por preparar-usuarios.mjs. Nada de service_role.
//
// O que faz:
//   1. Loga N usuários de teste (N clientes independentes, cada um com seu
//      próprio WebSocket — igual N pessoas com o app aberto).
//   2. Cada cliente entra, como o app faz:
//        - presença na sala de voz de teste (voice:<id>, canal PRIVADO);
//        - postgres_changes de INSERT em `messages` do canal de texto de
//          teste (mesma assinatura do useMessages.ts);
//        - broadcast no tópico typing:<canal> (canal PRIVADO, igual ao
//          "digitando…"), pra comparar Broadcast × Postgres Changes.
//   3. Durante DURACAO_S segundos, envia TAXA_MSG mensagens/s no total
//      (revezando entre os clientes; o banco limita 8 msgs/10s por pessoa).
//   4. Mede, em cada cliente que recebe, a latência de ENTREGA (envio →
//      chegada) e conta perdas/erros. Tudo roda no mesmo relógio (mesma
//      máquina), então a latência é exata — mas inclui o atraso do próprio
//      Node se ele estiver sobrecarregado (o relatório mostra esse atraso).
//   5. Gera loadtest/relatorios/carga-<data>.json e .md.
//
// Variáveis (todas opcionais menos a URL/anon, que vêm do .env do projeto):
//   SUPABASE_URL / SUPABASE_ANON_KEY  (ou VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY do .env)
//   LOADTEST_ARQUIVO   arquivo gerado pelo preparo (padrão loadtest/.carga-usuarios.json)
//   CLIENTES           quantos clientes conectar (padrão: todos do arquivo)
//   RAMPA_POR_S        clientes novos por segundo (padrão 10)
//   TAXA_MSG           mensagens por segundo, no total (padrão 2)
//   DURACAO_S          duração do envio (padrão 60)
//   MODO               postgres | broadcast | ambos (padrão ambos)
//   PRESENCA           1 = entra na presença da sala de voz (padrão 1)
//   PG_PRIVADO         1 = assina postgres_changes num canal privado (padrão 0,
//                      igual ao app)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { createClient } from '@supabase/supabase-js'
import { ARQUIVO_USUARIOS_PADRAO, PASTA_LOADTEST, carregarEnvDoProjeto, dormir, env, envNumero, exigir, resumo } from './lib/comum.mjs'

carregarEnvDoProjeto()
const url = exigir('SUPABASE_URL', env('SUPABASE_URL', env('VITE_SUPABASE_URL')))
const anon = exigir('SUPABASE_ANON_KEY', env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_ANON_KEY')))
if (anon.startsWith('sb_secret_') || /service_role/.test(Buffer.from(anon.split('.')[1] ?? '', 'base64').toString())) {
  console.error('SUPABASE_ANON_KEY é uma service_role! Use a chave anon/publishable — este script simula clientes comuns.')
  process.exit(1)
}
const dados = JSON.parse(readFileSync(env('LOADTEST_ARQUIVO', ARQUIVO_USUARIOS_PADRAO), 'utf8'))
const CLIENTES = Math.min(envNumero('CLIENTES', dados.usuarios.length), dados.usuarios.length)
const RAMPA = Math.max(1, envNumero('RAMPA_POR_S', 10))
const TAXA_PEDIDA = envNumero('TAXA_MSG', 2)
const DURACAO_S = envNumero('DURACAO_S', 60)
const MODO = env('MODO', 'ambos')
const PRESENCA = env('PRESENCA', '1') === '1'
const PG_PRIVADO = env('PG_PRIVADO', '0') === '1'
const usarPg = MODO === 'postgres' || MODO === 'ambos'
const usarBc = MODO === 'broadcast' || MODO === 'ambos'

// O banco recusa mais de 8 mensagens a cada 10s por pessoa
// (check_message_rate_limit) — 0,7/s por cliente deixa folga.
const TAXA_MAX = CLIENTES * 0.7
const TAXA = Math.min(TAXA_PEDIDA, TAXA_MAX)
if (TAXA < TAXA_PEDIDA) {
  console.warn(`TAXA_MSG=${TAXA_PEDIDA} passa do limite do banco (8 msgs/10s por usuário). Usando ${TAXA.toFixed(1)}/s — aumente CLIENTES pra ir além.`)
}

const execucao = randomBytes(4).toString('hex')
const loop = monitorEventLoopDelay({ resolution: 20 })
loop.enable()

const est = {
  loginMs: [],
  inscricaoPgMs: [],
  inscricaoBcMs: [],
  inscricaoPresencaMs: [],
  insertMs: [],
  entregaPgMs: [],
  entregaBcMs: [],
  erros: {},
  enviadasPg: 0,
  enviadasBc: 0,
  recebidasPg: 0,
  recebidasBc: 0,
  quedas: 0,
  presencaVista: 0,
}
function erro(tipo, detalhe) {
  const chave = detalhe ? `${tipo}: ${String(detalhe).slice(0, 120)}` : tipo
  est.erros[chave] = (est.erros[chave] ?? 0) + 1
}

function inscrever(canal, lista, rotulo) {
  const t0 = performance.now()
  return new Promise((resolve) => {
    let feito = false
    canal.subscribe((status, err) => {
      if (status === 'SUBSCRIBED' && !feito) {
        feito = true
        lista.push(performance.now() - t0)
        resolve(true)
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (!feito) {
          feito = true
          erro(`inscrição ${rotulo} ${status}`, err?.message)
          resolve(false)
        } else {
          est.quedas++
          erro(`queda ${rotulo} ${status}`, err?.message)
        }
      }
    })
    setTimeout(() => {
      if (!feito) {
        feito = true
        erro(`inscrição ${rotulo} sem resposta em 20s`)
        resolve(false)
      }
    }, 20_000)
  })
}

async function conectar(i) {
  const u = dados.usuarios[i]
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } },
  })
  const t0 = performance.now()
  const { data, error } = await sb.auth.signInWithPassword({ email: u.email, password: dados.senha })
  if (error || !data.session) {
    erro('login', error?.message)
    return null
  }
  est.loginMs.push(performance.now() - t0)
  await sb.realtime.setAuth(data.session.access_token)

  const cliente = { i, sb, userId: u.id, bc: null }
  const promessas = []

  if (usarBc || (usarPg && PG_PRIVADO)) {
    const bc = sb.channel(`typing:${dados.textChannelId}`, { config: { private: true, broadcast: { self: false } } })
    if (usarBc) {
      bc.on('broadcast', { event: 'carga' }, ({ payload }) => {
        if (payload?.r !== execucao) return
        est.recebidasBc++
        est.entregaBcMs.push(Date.now() - payload.t)
      })
    }
    if (usarPg && PG_PRIVADO) registrarPg(bc)
    cliente.bc = bc
    promessas.push(inscrever(bc, est.inscricaoBcMs, 'broadcast'))
  }
  if (usarPg && !PG_PRIVADO) {
    // Igual ao app: canal público de nome único, filtro por canal.
    const pg = sb.channel(`carga-msgs:${dados.textChannelId}:${i}:${execucao}`)
    registrarPg(pg)
    promessas.push(inscrever(pg, est.inscricaoPgMs, 'postgres_changes'))
  }
  if (PRESENCA) {
    const pr = sb.channel(`voice:${dados.voiceChannelId}`, { config: { private: true, presence: { key: u.id } } })
    if (i === 0) {
      pr.on('presence', { event: 'sync' }, () => {
        est.presencaVista = Object.keys(pr.presenceState()).length
      })
    }
    promessas.push(
      inscrever(pr, est.inscricaoPresencaMs, 'presença').then(async (ok) => {
        if (!ok) return false
        const r = await pr.track({ user_id: u.id, joined_at: Date.now() })
        if (r !== 'ok') erro('presença track', r)
        return true
      })
    )
  }
  await Promise.all(promessas)
  return cliente
}

function registrarPg(canal) {
  canal.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${dados.textChannelId}` },
    (payload) => {
      const partes = String(payload.new?.content ?? '').split('|')
      if (partes[0] !== 'carga' || partes[1] !== execucao) return
      est.recebidasPg++
      est.entregaPgMs.push(Date.now() - Number(partes[4]))
    }
  )
}

// ---------------------------------------------------------------------
console.log(`Execução ${execucao}: ${CLIENTES} clientes, rampa ${RAMPA}/s, ${TAXA.toFixed(2)} msg/s por ${DURACAO_S}s, modo=${MODO}, presença=${PRESENCA ? 'sim' : 'não'}`)
const clientes = []
const tRampa = performance.now()
for (let i = 0; i < CLIENTES; i += RAMPA) {
  const inicio = performance.now()
  const lote = await Promise.all(Array.from({ length: Math.min(RAMPA, CLIENTES - i) }, (_, k) => conectar(i + k).catch((e) => (erro('conectar', e?.message), null))))
  clientes.push(...lote.filter(Boolean))
  process.stdout.write(`\r  conectados: ${clientes.length}/${CLIENTES}`)
  const resto = 1000 - (performance.now() - inicio)
  if (resto > 0 && i + RAMPA < CLIENTES) await dormir(resto)
}
console.log(`\n  rampa em ${((performance.now() - tRampa) / 1000).toFixed(1)}s. Esperando 3s pra estabilizar…`)
await dormir(3000)

if (clientes.length < 2) {
  console.error('Menos de 2 clientes conectados — nada pra medir. Veja os erros abaixo.')
  console.error(est.erros)
  process.exit(1)
}

// Envio: um "tique" a cada 1/TAXA segundos, revezando o remetente.
const intervalo = 1000 / TAXA
const fim = Date.now() + DURACAO_S * 1000
let seq = 0
let proximo = Date.now()
const pendentes = []
while (Date.now() < fim) {
  const c = clientes[seq % clientes.length]
  const agora = Date.now()
  const conteudo = `carga|${execucao}|${c.i}|${seq}|${agora}`
  if (usarPg) {
    est.enviadasPg++
    const t0 = performance.now()
    pendentes.push(
      c.sb
        .from('messages')
        .insert({ server_id: dados.serverId, channel_id: dados.textChannelId, author_id: c.userId, content: conteudo })
        .then(({ error }) => {
          if (error) {
            est.enviadasPg--
            erro('insert', error.message)
          } else est.insertMs.push(performance.now() - t0)
        })
    )
  }
  if (usarBc && c.bc) {
    est.enviadasBc++
    pendentes.push(
      c.bc.send({ type: 'broadcast', event: 'carga', payload: { r: execucao, s: c.i, q: seq, t: agora } }).then((r) => {
        if (r !== 'ok') {
          est.enviadasBc--
          erro('broadcast send', r)
        }
      })
    )
  }
  seq++
  proximo += intervalo
  const espera = proximo - Date.now()
  if (espera > 0) await dormir(espera)
  if (seq % Math.max(1, Math.round(TAXA * 5)) === 0) {
    process.stdout.write(`\r  enviadas: ${seq}  recebidas pg=${est.recebidasPg} bc=${est.recebidasBc}  erros=${Object.values(est.erros).reduce((a, b) => a + b, 0)}   `)
  }
}
await Promise.allSettled(pendentes)
console.log('\n  envio encerrado; esperando 8s pelas últimas entregas…')
await dormir(8000)

// Cada INSERT chega pra TODOS os clientes (inclusive quem mandou); o
// broadcast (self: false) chega pra todos menos quem mandou.
const esperadasPg = est.enviadasPg * clientes.length
const esperadasBc = est.enviadasBc * (clientes.length - 1)
const pct = (a, b) => (b === 0 ? null : Math.round((a / b) * 10000) / 100)
const relatorio = {
  execucao,
  data: new Date().toISOString(),
  projeto: url.replace(/^https?:\/\//, '').split('.')[0],
  parametros: { clientes: CLIENTES, conectados: clientes.length, rampaPorS: RAMPA, taxaMsgPorS: TAXA, duracaoS: DURACAO_S, modo: MODO, presenca: PRESENCA, pgPrivado: PG_PRIVADO },
  loginMs: resumo(est.loginMs),
  inscricaoMs: { postgres: resumo(est.inscricaoPgMs), broadcast: resumo(est.inscricaoBcMs), presenca: resumo(est.inscricaoPresencaMs) },
  insertMs: resumo(est.insertMs),
  entregaPostgresChangesMs: resumo(est.entregaPgMs),
  entregaBroadcastMs: resumo(est.entregaBcMs),
  entregas: {
    postgres: { enviadas: est.enviadasPg, esperadas: esperadasPg, recebidas: est.recebidasPg, taxaPct: pct(est.recebidasPg, esperadasPg) },
    broadcast: { enviadas: est.enviadasBc, esperadas: esperadasBc, recebidas: est.recebidasBc, taxaPct: pct(est.recebidasBc, esperadasBc) },
  },
  presenca: PRESENCA ? { vistosPeloCliente0: est.presencaVista, esperados: clientes.length } : null,
  mensagensRealtimeEstimadas: est.recebidasPg + est.recebidasBc,
  quedasDeCanal: est.quedas,
  erros: est.erros,
  atrasoDoNodeMs: { p50: Math.round(loop.percentile(50) / 1e6), p99: Math.round(loop.percentile(99) / 1e6), max: Math.round(loop.max / 1e6) },
}

const linha = (nome, r) => `| ${nome} | ${r.n} | ${r.p50 ?? '—'} | ${r.p95 ?? '—'} | ${r.p99 ?? '—'} | ${r.max ?? '—'} |`
const md = `# Teste de carga Realtime — ${relatorio.data}

Projeto \`${relatorio.projeto}\` · execução \`${execucao}\` · ${clientes.length}/${CLIENTES} clientes · ${TAXA.toFixed(2)} msg/s por ${DURACAO_S}s · modo ${MODO}

| Medida (ms) | n | p50 | p95 | p99 | máx |
|---|---|---|---|---|---|
${linha('Login', relatorio.loginMs)}
${linha('Inscrição postgres_changes', relatorio.inscricaoMs.postgres)}
${linha('Inscrição broadcast', relatorio.inscricaoMs.broadcast)}
${linha('Inscrição presença', relatorio.inscricaoMs.presenca)}
${linha('INSERT (HTTP)', relatorio.insertMs)}
${linha('Entrega postgres_changes', relatorio.entregaPostgresChangesMs)}
${linha('Entrega broadcast', relatorio.entregaBroadcastMs)}

**Entregas:** postgres_changes ${est.recebidasPg}/${esperadasPg} (${relatorio.entregas.postgres.taxaPct ?? '—'}%), broadcast ${est.recebidasBc}/${esperadasBc} (${relatorio.entregas.broadcast.taxaPct ?? '—'}%)
${PRESENCA ? `\n**Presença:** o cliente 0 via ${est.presencaVista} de ${clientes.length} na sala.\n` : ''}
**Mensagens Realtime geradas (entregas contadas no plano):** ~${relatorio.mensagensRealtimeEstimadas}

**Quedas de canal durante o teste:** ${est.quedas}

**Atraso do próprio Node (event loop):** p50 ${relatorio.atrasoDoNodeMs.p50} ms · p99 ${relatorio.atrasoDoNodeMs.p99} ms · máx ${relatorio.atrasoDoNodeMs.max} ms
${relatorio.atrasoDoNodeMs.p99 > 100 ? '\n> ⚠️ O Node ficou sobrecarregado (p99 > 100 ms): parte da latência medida é da máquina do teste, não do Supabase. Divida os clientes entre 2+ máquinas/terminais.\n' : ''}
## Erros
${Object.keys(est.erros).length === 0 ? 'Nenhum.' : Object.entries(est.erros).map(([k, v]) => `- ${v}× ${k}`).join('\n')}
`

const pasta = join(PASTA_LOADTEST, 'relatorios')
mkdirSync(pasta, { recursive: true })
const base = join(pasta, `carga-${relatorio.data.replace(/[:.]/g, '-')}`)
writeFileSync(`${base}.json`, JSON.stringify(relatorio, null, 2))
writeFileSync(`${base}.md`, md)
console.log('\n' + md)
console.log(`Relatório salvo em ${base}.md / .json`)

// Sai: fecha tudo.
await Promise.allSettled(clientes.map((c) => c.sb.removeAllChannels().then(() => c.sb.auth.signOut({ scope: 'local' }))))
process.exit(0)
