export const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 72
const USERNAME_MIN_LENGTH = 3
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

export function isValidInviteCode(code: string | null | undefined): code is string {
  return typeof code === 'string' && /^[a-zA-Z0-9]{6,32}$/.test(code)
}

export function normalizeTotpCode(code: string): string {
  return code.replace(/\D/g, '').slice(0, 6)
}
