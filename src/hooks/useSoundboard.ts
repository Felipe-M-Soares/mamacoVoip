import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { decodeAudioFile, MAX_SOUND_SECONDS } from '../lib/audioTrim'
import type { SoundboardSound } from '../types/database'

const MAX_SOUND_BYTES = 2 * 1024 * 1024
const MAX_SOUND_SECONDS_TOLERANCE = MAX_SOUND_SECONDS + 0.2

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

    try {
      const decoded = await decodeAudioFile(file)
      if (decoded.duration > MAX_SOUND_SECONDS_TOLERANCE) {
        return { error: `Esse áudio tem ${decoded.duration.toFixed(1)}s — o soundboard aceita até ${MAX_SOUND_SECONDS}s. Use a ferramenta de recorte.` }
      }
    } catch {
    }

    const soundId = crypto.randomUUID()
    const ext = file.name.split('.').pop()?.toLowerCase() || 'mp3'
    const path = `${serverId}/${soundId}.${ext}`

    const { error: insertError } = await supabase
      .from('soundboard_sounds')
      .insert({ id: soundId, server_id: serverId, name: trimmed, storage_path: path, uploaded_by: user.id })

    if (insertError) {
      const msg = insertError.message ?? ''
      return {
        error: msg.toLowerCase().includes('duplicate')
          ? 'Já existe um som com esse nome neste servidor.'
          : /^Limite de \d+ sons/.test(msg)
            ? `${msg}.`
            : 'Não foi possível salvar o som.',
      }
    }

    const { error: uploadError } = await supabase.storage.from('soundboard').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })
    if (uploadError) {
      await supabase.rpc('delete_soundboard_sound', { p_sound_id: soundId })
      const detail = (uploadError.message ?? '').toLowerCase()
      return {
        error: detail.includes('mime')
          ? 'Formato não aceito pelo servidor (use mp3, wav, ogg ou webm — ou recorte o som, que vira wav).'
          : detail.includes('size') || detail.includes('exceed') || detail.includes('large')
            ? 'Arquivo muito grande (máximo 2MB).'
            : `Não foi possível enviar o arquivo${uploadError.message ? ` (${uploadError.message})` : ''}.`,
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

  function bumpPlayCount(soundId: string, opts?: { localOnly?: boolean }) {
    if (!opts?.localOnly) {
      supabase.rpc('bump_soundboard_play_count', { p_sound_id: soundId }).then(
        () => {},
        () => {}
      )
    }
    setSounds((prev) => prev.map((s) => (s.id === soundId ? { ...s, play_count: s.play_count + 1 } : s)))
  }

  return { sounds, loading, refresh, getUrl, uploadSound, deleteSound, bumpPlayCount }
}
