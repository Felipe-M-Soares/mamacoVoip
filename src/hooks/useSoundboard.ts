import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { decodeAudioFile, MAX_SOUND_SECONDS } from '../lib/audioTrim'
import type { SoundboardSound } from '../types/database'

const MAX_SOUND_BYTES = 2 * 1024 * 1024 // precisa bater com o file_size_limit do bucket 'soundboard' (ver 006_soundboard.sql)
// Pequena tolerância pra não rejeitar um arquivo de "5.02s" já cortado
// pela própria ferramenta de recorte (SoundboardPanel.tsx) por causa de
// arredondamento de amostras — a intenção do limite é "efeito curto",
// não uma trava cirúrgica no milissegundo.
const MAX_SOUND_SECONDS_TOLERANCE = MAX_SOUND_SECONDS + 0.2

// Sons do soundboard de UM servidor — busca, envio e remoção. A
// reprodução em si (tocar pra todo mundo na call) mora em
// VoiceContext.tsx (playSoundboardSound), porque depende do canal
// Realtime de voz já conectado; este hook só cuida do catálogo de sons
// em si (a lista, quem pode subir/apagar o quê).
export function useSoundboard(serverId: string | null) {
  const { user } = useAuth()
  const [sounds, setSounds] = useState<SoundboardSound[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!serverId) {
      setSounds([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase.from('soundboard_sounds').select('*').eq('server_id', serverId).order('name')
    setSounds(data ?? [])
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    refresh()
  }, [refresh])

  function getUrl(sound: SoundboardSound): string {
    return supabase.storage.from('soundboard').getPublicUrl(sound.storage_path).data.publicUrl
  }

  async function uploadSound(file: File, name: string): Promise<{ error: string | null }> {
    if (!serverId || !user) return { error: 'Não foi possível enviar o som.' }
    const trimmed = name.trim()
    if (!trimmed) return { error: 'Dê um nome pro som.' }
    if (trimmed.length > 32) return { error: 'Nome muito longo (máximo 32 caracteres).' }
    if (file.size > MAX_SOUND_BYTES) return { error: 'Arquivo muito grande (máximo 2MB — um efeito curto de alguns segundos).' }

    // Segunda trava (além da ferramenta de recorte na tela de envio) —
    // confere a duração de verdade antes de subir, pra nenhum caminho
    // (bug na UI, chamada direta ao hook, etc.) acabar deixando passar
    // um som mais longo que o limite pedido.
    try {
      const decoded = await decodeAudioFile(file)
      if (decoded.duration > MAX_SOUND_SECONDS_TOLERANCE) {
        return { error: `Esse áudio tem ${decoded.duration.toFixed(1)}s — o soundboard aceita até ${MAX_SOUND_SECONDS}s. Use a ferramenta de recorte.` }
      }
    } catch {
      // Não foi possível decodificar pra checar duração (formato
      // incomum) — segue sem essa checagem extra em vez de bloquear um
      // arquivo que talvez seja perfeitamente válido.
    }

    const soundId = crypto.randomUUID()
    const ext = file.name.split('.').pop()?.toLowerCase() || 'mp3'
    const path = `${serverId}/${soundId}.${ext}`

    const { error: uploadError } = await supabase.storage.from('soundboard').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })
    if (uploadError) return { error: 'Não foi possível enviar o arquivo (formato aceito: mp3, wav, ogg ou webm).' }

    const { error: insertError } = await supabase
      .from('soundboard_sounds')
      .insert({ id: soundId, server_id: serverId, name: trimmed, storage_path: path, uploaded_by: user.id })

    if (insertError) {
      // O arquivo já subiu mas a linha não pôde ser criada (nome
      // duplicado, por exemplo) — remove o órfão do bucket pra não
      // deixar lixo acumulando lá.
      await supabase.storage.from('soundboard').remove([path])
      return {
        error: insertError.message.toLowerCase().includes('duplicate')
          ? 'Já existe um som com esse nome neste servidor.'
          : 'Não foi possível salvar o som.',
      }
    }

    await refresh()
    return { error: null }
  }

  async function deleteSound(soundId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('delete_soundboard_sound', { p_sound_id: soundId })
    if (error) return { error: error.message }
    await refresh()
    return { error: null }
  }

  // Atualiza local de forma otimista — não vale a pena esperar um
  // refetch completo da lista só pra refletir "+1 uso", e a ordenação
  // de "usados com frequência" (ver SoundboardPanel.tsx) já se beneficia
  // do valor novo na hora.
  function bumpPlayCount(soundId: string) {
    supabase.rpc('bump_soundboard_play_count', { p_sound_id: soundId }).then(
      () => {},
      () => {}
    )
    setSounds((prev) => prev.map((s) => (s.id === soundId ? { ...s, play_count: s.play_count + 1 } : s)))
  }

  return { sounds, loading, refresh, getUrl, uploadSound, deleteSound, bumpPlayCount }
}
