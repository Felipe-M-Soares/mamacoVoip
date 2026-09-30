// Utilitários compartilhados pelos scripts de teste de carga.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PASTA_LOADTEST = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const RAIZ_PROJETO = resolve(PASTA_LOADTEST, '..')
export const ARQUIVO_USUARIOS_PADRAO = join(PASTA_LOADTEST, '.carga-usuarios.json')

/**
 * Lê o .env da raiz do projeto (só pra pegar VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY se as variáveis próprias não forem passadas).
 * Variáveis de ambiente de verdade sempre têm prioridade.
 */
export function carregarEnvDoProjeto() {
  const arquivo = join(RAIZ_PROJETO, '.env')
  if (!existsSync(arquivo)) return
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}

export function env(nome, padrao) {
  const v = process.env[nome]
  return v === undefined || v === '' ? padrao : v
}

export function envNumero(nome, padrao) {
  const v = Number(env(nome, String(padrao)))
  if (!Number.isFinite(v)) throw new Error(`${nome} precisa ser um número`)
  return v
}

export function exigir(nome, valor) {
  if (!valor) {
    console.error(`Faltou a variável ${nome}. Veja loadtest/README.md.`)
    process.exit(1)
  }
  return valor
}

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/** Percentil (0–100) de uma lista de números (interpolação linear). */
export function percentil(valores, p) {
  if (valores.length === 0) return null
  const ord = [...valores].sort((a, b) => a - b)
  if (ord.length === 1) return ord[0]
  const pos = (p / 100) * (ord.length - 1)
  const base = Math.floor(pos)
  const resto = pos - base
  return ord[base + 1] !== undefined ? ord[base] + resto * (ord[base + 1] - ord[base]) : ord[base]
}

export function resumo(valores) {
  if (valores.length === 0) return { n: 0, p50: null, p95: null, p99: null, max: null, media: null }
  const r = (x) => (x === null ? null : Math.round(x))
  return {
    n: valores.length,
    p50: r(percentil(valores, 50)),
    p95: r(percentil(valores, 95)),
    p99: r(percentil(valores, 99)),
    max: r(Math.max(...valores)),
    media: r(valores.reduce((a, b) => a + b, 0) / valores.length),
  }
}
