import { describe, it, expect } from 'vitest'
import { traduzErro } from './AuthContext'

describe('traduzErro', () => {
  it('traduz mensagens conhecidas do Supabase pro português', () => {
    expect(traduzErro('Invalid login credentials')).toBe('E-mail ou senha incorretos.')
    expect(traduzErro('User already registered')).toBe('Já existe uma conta com este e-mail.')
    expect(traduzErro('Password should be at least 6 characters')).toBe(
      'A senha precisa ter no mínimo 6 caracteres.'
    )
    expect(traduzErro('Email not confirmed')).toBe(
      'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.'
    )
  })

  it('trata "email rate limit exceeded" case-insensitive', () => {
    expect(traduzErro('Email rate limit exceeded')).toContain('Muitas contas foram criadas')
    expect(traduzErro('EMAIL RATE LIMIT EXCEEDED')).toContain('Muitas contas foram criadas')
  })

  it('extrai o número de segundos da mensagem de rate limit por segurança', () => {
    expect(traduzErro('For security purposes, you can only request this after 42 seconds.')).toBe(
      'Por segurança, espere 42 segundos antes de tentar de novo.'
    )
  })

  it('reconhece a variação em minúsculas da mensagem de rate limit por segurança', () => {
    expect(traduzErro('FOR SECURITY PURPOSES, YOU CAN ONLY REQUEST THIS AFTER 7 SECONDS.')).toBe(
      'Por segurança, espere 7 segundos antes de tentar de novo.'
    )
  })

  it('devolve a mensagem original quando não reconhece o erro', () => {
    expect(traduzErro('Something totally unexpected happened')).toBe('Something totally unexpected happened')
  })
})
