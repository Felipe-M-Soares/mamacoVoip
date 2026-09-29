import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { parseMessageContent, safeHttpUrl, safeHexColor } from './messageFormatting'
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

  it('não interpreta :emoji: nem @menção dentro de bloco de código', () => {
    const emojis = [{ id: '1', server_id: 's', name: 'gato', image_url: 'https://x.supabase.co/e.png', created_by: null, created_at: '' }] as ServerEmoji[]
    const members = [{ username: 'joao' }] as Profile[]
    const el = renderContent('```:gato: @joao```', members, emojis)
    expect(el.querySelector('pre code')?.textContent).toBe(':gato: @joao')
    expect(el.querySelector('img')).toBeNull()
  })

  it('renderiza emoji mesmo quando há um ":algo:" desconhecido antes', () => {
    const emojis = [{ id: '1', server_id: 's', name: 'gato', image_url: 'https://x.supabase.co/e.png', created_by: null, created_at: '' }] as ServerEmoji[]
    const el = renderContent('a:b: oi :gato:', [], emojis)
    expect(el.querySelector('img')?.getAttribute('src')).toBe('https://x.supabase.co/e.png')
  })

  it('não renderiza emoji com URL javascript:', () => {
    const emojis = [{ id: '1', server_id: 's', name: 'mal', image_url: 'javascript:alert(1)', created_by: null, created_at: '' }] as ServerEmoji[]
    const el = renderContent(':mal:', [], emojis)
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toBe(':mal:')
  })

  it('destaca a menção válida mesmo depois de um e-mail', () => {
    const members = [{ username: 'joao' }] as Profile[]
    const el = renderContent('manda pra a@b.com ou @joao', members)
    const span = el.querySelector('span')
    expect(span?.textContent).toBe('@joao')
  })

  it('cor de cargo inválida cai pra cor padrão', () => {
    const roles = [{ id: 'r', server_id: 's', name: 'Mod', color: 'red;background:url(x)', position: 1, permissions: [], created_at: '' }] as Role[]
    const el = renderContent('oi @Mod', [], [], roles)
    const span = el.querySelector('span') as HTMLSpanElement
    expect(span.textContent).toBe('@Mod')
    expect(span.style.color).toBe('rgb(153, 170, 181)')
  })
})

describe('safeHttpUrl / safeHexColor', () => {
  it('aceita só http(s)', () => {
    expect(safeHttpUrl('https://exemplo.com/a.png')).toBe('https://exemplo.com/a.png')
    expect(safeHttpUrl('http://exemplo.com/')).toBe('http://exemplo.com/')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl(' JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeHttpUrl('/relativo')).toBeNull()
    expect(safeHttpUrl(null)).toBeNull()
  })

  it('aceita só cor hexadecimal', () => {
    expect(safeHexColor('#fff')).toBe('#fff')
    expect(safeHexColor('#AABBCC')).toBe('#AABBCC')
    expect(safeHexColor('red')).toBe('#99aab5')
    expect(safeHexColor('#fff;x:y')).toBe('#99aab5')
  })
})
