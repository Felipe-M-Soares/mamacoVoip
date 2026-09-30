#!/usr/bin/env node
// PREPARO do teste de carga — roda NA SUA MÁQUINA, com a service_role.
//
// Cria N usuários de teste (e-mail já confirmado), um servidor "Teste de
// carga" com o canal de texto "geral" e a sala de voz "Sala Geral" (criados
// pelo próprio gatilho do banco) e coloca todos como membros. Grava tudo
// em loadtest/.carga-usuarios.json (fora do git) pro carga-realtime.mjs.
//
// A service_role passa por cima de toda a RLS: NUNCA coloque ela no app,
// no .env do Vite, num commit ou num CI público. Aqui ela só é lida da
// variável de ambiente, na sua máquina, e não é gravada em lugar nenhum.
//
// Uso (PowerShell):
//   $env:SUPABASE_URL="https://xxxx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."   # Settings → API → service_role
//   $env:LOADTEST_N="100"
//   node loadtest/preparar-usuarios.mjs
//
// Recomendado: rodar num projeto de TESTE (Supabase → Branching, ou um
// segundo projeto grátis com as mesmas migrations), não no de produção.
import { writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ARQUIVO_USUARIOS_PADRAO, carregarEnvDoProjeto, env, envNumero, exigir, dormir } from './lib/comum.mjs'

carregarEnvDoProjeto()
const url = exigir('SUPABASE_URL', env('SUPABASE_URL', env('VITE_SUPABASE_URL')))
const serviceRole = exigir('SUPABASE_SERVICE_ROLE_KEY', env('SUPABASE_SERVICE_ROLE_KEY'))
const N = envNumero('LOADTEST_N', 50)
const prefixo = env('LOADTEST_PREFIXO', 'carga').replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'carga'
const senha = env('LOADTEST_SENHA', `Carga-${randomBytes(9).toString('base64url')}1`)
const dominio = env('LOADTEST_DOMINIO_EMAIL', 'example.com')
const arquivo = env('LOADTEST_ARQUIVO', ARQUIVO_USUARIOS_PADRAO)

if (N < 2 || N > 5000) {
  console.error('LOADTEST_N precisa ficar entre 2 e 5000.')
  process.exit(1)
}

const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })

async function acharPerfil(username) {
  const { data } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
  return data?.id ?? null
}

async function criarOuAcharUsuario(i) {
  const username = `${prefixo}_${String(i).padStart(4, '0')}`
  const email = `${prefixo}+${String(i).padStart(4, '0')}@${dominio}`
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { username, name: `Carga ${i}` },
    })
    if (!error && data.user) return { id: data.user.id, email, username }
    if (error && /already|exists|registered/i.test(error.message)) {
      // Já existe (rodada anterior): acha o id e redefine a senha.
      const id = await acharPerfil(username)
      if (!id) throw new Error(`Usuário ${email} já existe mas o perfil ${username} não foi achado`)
      const { error: updErr } = await admin.auth.admin.updateUserById(id, { password: senha })
      if (updErr) throw updErr
      return { id, email, username }
    }
    if (error && error.status === 429) {
      await dormir(1000 * (tentativa + 1))
      continue
    }
    throw error ?? new Error('createUser sem retorno')
  }
  throw new Error(`Limite de requisições ao criar ${email}`)
}

console.log(`Criando/atualizando ${N} usuários de teste (${prefixo}_0000…)…`)
const usuarios = []
const LOTE = 10
for (let i = 0; i < N; i += LOTE) {
  const lote = await Promise.all(
    Array.from({ length: Math.min(LOTE, N - i) }, (_, k) => criarOuAcharUsuario(i + k))
  )
  usuarios.push(...lote)
  process.stdout.write(`\r  ${usuarios.length}/${N}`)
}
console.log()

// Servidor de teste (dono = usuário 0). Reaproveita se já existir.
const nomeServidor = `Teste de carga (${prefixo})`
let { data: servidor } = await admin
  .from('servers')
  .select('id')
  .eq('owner_id', usuarios[0].id)
  .eq('name', nomeServidor)
  .maybeSingle()
if (!servidor) {
  const { data, error } = await admin.from('servers').insert({ name: nomeServidor, owner_id: usuarios[0].id }).select('id').single()
  if (error) throw error
  servidor = data
}

const { data: canais, error: canaisErr } = await admin
  .from('channels')
  .select('id, type, name')
  .eq('server_id', servidor.id)
  .order('position')
if (canaisErr) throw canaisErr
const texto = canais.find((c) => c.type === 'text')
const voz = canais.find((c) => c.type === 'voice')
if (!texto || !voz) throw new Error('O servidor de teste precisa de um canal de texto e um de voz')

// Todo mundo membro do servidor.
for (let i = 0; i < usuarios.length; i += 500) {
  const { error } = await admin
    .from('server_members')
    .upsert(
      usuarios.slice(i, i + 500).map((u) => ({ server_id: servidor.id, user_id: u.id })),
      { onConflict: 'server_id,user_id', ignoreDuplicates: true }
    )
  if (error) throw error
}

writeFileSync(
  arquivo,
  JSON.stringify(
    {
      criadoEm: new Date().toISOString(),
      supabaseUrl: url,
      prefixo,
      serverId: servidor.id,
      textChannelId: texto.id,
      voiceChannelId: voz.id,
      senha,
      usuarios: usuarios.map((u) => ({ id: u.id, email: u.email })),
    },
    null,
    2
  )
)
console.log(`Pronto. Servidor ${servidor.id}, canal de texto ${texto.id}, sala de voz ${voz.id}.`)
console.log(`Arquivo: ${arquivo} (contém a senha dos usuários de TESTE — não commite).`)
