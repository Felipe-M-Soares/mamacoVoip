import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { parseMessageContent } from './messageFormatting'
import type { Profile, ServerEmoji, Role } from '../types/database'

function renderContent(text: string, members: Profile[] = [], emojis: ServerEmoji[] = [], roles: Role[] = []) {
  const { container } = render(<>{parseMessageContent(text, members, emojis, roles)}</>)
  return container
}

describe('parseMessageContent', () => {
  it('renderiza texto simples sem formatação como está', () => {
    const el = renderContent('mensagem normal')
    expect(el.textContent).toBe('mensagem normal')
  })

  it('renderiza negrito **texto** como <strong>', () => {
    const el = renderContent('isso é **importante** aqui')
    expect(el.querySelector('strong')?.textContent).toBe('importante')
  })

  it('renderiza itálico *texto* como <em>', () => {
    const el = renderContent('isso é *sutil*')
    expect(el.querySelector('em')?.textContent).toBe('sutil')
  })

  it('renderiza código inline `texto` como <code>', () => {
    const el = renderContent('roda `npm install` primeiro')
    expect(el.querySelector('code')?.textContent).toBe('npm install')
  })

  it('renderiza bloco de código ```texto``` como <pre><code>', () => {
    const el = renderContent('```const x = 1```')
    expect(el.querySelector('pre code')?.textContent).toBe('const x = 1')
  })

  it('renderiza tachado ~~texto~~ como <s>', () => {
    const el = renderContent('~~cancelado~~')
    expect(el.querySelector('s')?.textContent).toBe('cancelado')
  })

  it('spoiler ||texto|| começa escondido (texto transparente) até clicar', () => {
    const el = renderContent('||segredo||')
    const spoilerSpan = el.querySelector('span')
    expect(spoilerSpan?.textContent).toBe('segredo')
    expect(spoilerSpan?.className).toContain('text-transparent')
  })
})
