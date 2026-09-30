#!/usr/bin/env node
// LIMPEZA do teste de carga — roda na sua máquina, com a service_role
// (mesmo cuidado do preparar-usuarios.mjs: nunca no app nem em commit).
//
// Apaga o servidor de teste (as mensagens vão junto em cascata). Com
// LIMPAR_USUARIOS=1 apaga também os usuários de teste.
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { ARQUIVO_USUARIOS_PADRAO, carregarEnvDoProjeto, env, exigir } from './lib/comum.mjs'

carregarEnvDoProjeto()
const url = exigir('SUPABASE_URL', env('SUPABASE_URL', env('VITE_SUPABASE_URL')))
const serviceRole = exigir('SUPABASE_SERVICE_ROLE_KEY', env('SUPABASE_SERVICE_ROLE_KEY'))
const arquivo = env('LOADTEST_ARQUIVO', ARQUIVO_USUARIOS_PADRAO)
const dados = JSON.parse(readFileSync(arquivo, 'utf8'))
const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })

const { error } = await admin.from('servers').delete().eq('id', dados.serverId)
if (error) console.error('Falha ao apagar o servidor de teste:', error.message)
else console.log(`Servidor de teste ${dados.serverId} apagado (com as mensagens).`)

if (env('LIMPAR_USUARIOS', '0') === '1') {
  let apagados = 0
  for (const u of dados.usuarios) {
    const { error: e } = await admin.auth.admin.deleteUser(u.id)
    if (e) console.error(`  ${u.email}: ${e.message}`)
    else apagados++
  }
  console.log(`${apagados}/${dados.usuarios.length} usuários de teste apagados.`)
  rmSync(arquivo, { force: true })
}
