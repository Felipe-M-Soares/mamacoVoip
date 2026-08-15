import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { generateBotReply } from '../lib/testBot'

export interface BotMessage {
  id: string
  author: 'user' | 'bot'
  content: string
  created_at: string
}

const BOT_TYPING_DELAY_MS = 700

function storageKey(userId: string) {
  return `mamacos-test-bot-chat:${userId}`
}

// Conversa 100% local — nunca toca no Supabase. É só uma ferramenta pra
// você testar a UI de chat (enviar, ver a mensagem chegar, reações
// visuais) sem precisar de um segundo usuário real online.
export function useTestBotChat() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<BotMessage[]>([])
  const [botTyping, setBotTyping] = useState(false)

  const load = useCallback(() => {
    if (!user) {
      setMessages([])
      return
    }
    try {
      const raw = localStorage.getItem(storageKey(user.id))
      setMessages(raw ? JSON.parse(raw) : [])
    } catch {
      setMessages([])
    }
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  function persist(next: BotMessage[]) {
    setMessages(next)
    if (!user) return
    try {
      localStorage.setItem(storageKey(user.id), JSON.stringify(next))
    } catch {
      // best-effort — se não der pra salvar, a conversa some ao recarregar
    }
  }

  function sendMessage(content: string) {
    if (!user || content.trim().length === 0) return

    const userMessage: BotMessage = {
      id: crypto.randomUUID(),
      author: 'user',
      content: content.trim(),
      created_at: new Date().toISOString(),
    }
    const withUserMessage = [...messages, userMessage]
    persist(withUserMessage)

    setBotTyping(true)
    setTimeout(() => {
      const botMessage: BotMessage = {
        id: crypto.randomUUID(),
        author: 'bot',
        content: generateBotReply(userMessage.content),
        created_at: new Date().toISOString(),
      }
      setBotTyping(false)
      persist([...withUserMessage, botMessage])
    }, BOT_TYPING_DELAY_MS)
  }

  function clearChat() {
    persist([])
  }

  return { messages, botTyping, sendMessage, clearChat }
}
