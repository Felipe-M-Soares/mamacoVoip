// Validações puras do sistema de contas (cadastro, login, troca de
// senha, redirecionamento pós-login). Ficam aqui, fora dos componentes,
// pra poderem ser testadas e reaproveitadas em todas as telas — antes,
// cada tela tinha sua própria regra (cadastro pedia 6 caracteres, a
// redefinição também, a troca de senha nas configurações nenhuma).
//
// IMPORTANTE: isso é só a checagem do app (feedback rápido). A regra
// que vale de verdade é a do Supabase Auth — configure a mesma coisa em
// Authentication → Providers → Email → "Minimum password length" (8) e
// "Password requirements" (letras e dígitos), e ligue "Leaked password
// protection" (Authentication → Settings). Ver SECURITY_CHECKLIST.md.

export const PASSWORD_MIN_LENGTH = 8
// bcrypt (usado pelo Supabase Auth) ignora tudo depois do byte 72.
export const PASSWORD_MAX_LENGTH = 72
export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 32

export function validatePassword(password: string, context: { email?: string; username?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `A senha precisa ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres.`
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) {
    return `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`
  }
  if (!/[a-zA-ZÀ-ɏ]/.test(password) || !/\d/.test(password)) {
    return 'A senha precisa ter pelo menos uma letra e um número.'
  }
  if (/^\s|\s$/.test(password)) {
    return 'A senha não pode começar nem terminar com espaço.'
  }
  const lower = password.toLowerCase()
  const emailLocal = context.email?.split('@')[0]?.toLowerCase()
  if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal)) {
    return 'A senha não pode conter o seu e-mail.'
  }
  const username = context.username?.toLowerCase()
  if (username && username.length >= 3 && lower.includes(username)) {
    return 'A senha não pode conter o seu nome de usuário.'
  }
  return null
}

// Força aproximada (0–4) só pra um indicador visual — não bloqueia nada.
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0
  let score = 0
  if (password.length >= PASSWORD_MIN_LENGTH) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password) && /[^a-zA-Z0-9]/.test(password)) score++
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4
}

export function validateUsername(username: string): string | null {
  if (username.length < USERNAME_MIN_LENGTH) {
    return `O nome de usuário precisa ter no mínimo ${USERNAME_MIN_LENGTH} caracteres.`
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return `O nome de usuário pode ter no máximo ${USERNAME_MAX_LENGTH} caracteres.`
  }
  if (!/^[a-zA-Z0-9_.]+$/.test(username)) {
    return 'O nome de usuário só pode ter letras, números, ponto e underline.'
  }
  if (username.startsWith('.') || username.endsWith('.') || username.includes('..')) {
    return 'O nome de usuário não pode começar/terminar com ponto nem ter dois pontos seguidos.'
  }
  if (['everyone', 'here'].includes(username.toLowerCase())) {
    return 'Esse nome de usuário é reservado.'
  }
  return null
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validateEmail(email: string): string | null {
  const e = normalizeEmail(email)
  if (!e) return 'Informe seu e-mail.'
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Formato de e-mail inválido.'
  return null
}

// Só aceita caminhos INTERNOS do app como destino pós-login (ex.:
// "/convite/abc123"). Qualquer coisa que possa virar navegação pra outro
// site — "//evil.com", "/\\evil.com", "https://...", "javascript:..." —
// cai pra "/". Evita open redirect pelo valor salvo em sessionStorage.
export function safeRedirectPath(path: string | null | undefined, fallback = '/'): string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 2048) return fallback
  if (!path.startsWith('/')) return fallback
  if (path.startsWith('//') || path.startsWith('/\\')) return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return fallback
  if (path === '/login' || path === '/cadastro') return fallback
  try {
    const resolved = new URL(path, 'https://app.invalid')
    if (resolved.origin !== 'https://app.invalid') return fallback
    return resolved.pathname + resolved.search + resolved.hash
  } catch {
    return fallback
  }
}

// Códigos de convite: os antigos têm 8 caracteres hexadecimais, os novos
// (migration 013) têm 10 letras/números. Aceita os dois formatos.
export function isValidInviteCode(code: string | null | undefined): code is string {
  return typeof code === 'string' && /^[a-zA-Z0-9]{6,32}$/.test(code)
}

// Código TOTP: exatamente 6 dígitos.
export function normalizeTotpCode(code: string): string {
  return code.replace(/\D/g, '').slice(0, 6)
}
