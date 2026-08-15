import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useAudioSettings } from '../../hooks/useAudioSettings'
import { getNotificationPermission, requestNotificationPermission } from '../../lib/notifications'

type Tab = 'account' | 'audio' | 'notifications' | 'privacy'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('account')

  return (
    <Modal title="Configurações" onClose={onClose} maxWidth="max-w-lg">
      <div className="flex gap-2 mb-4 bg-discord-darker rounded-lg p-1">
        {(
          [
            { id: 'account', label: 'Minha conta' },
            { id: 'audio', label: 'Voz e Vídeo' },
            { id: 'notifications', label: 'Notificações' },
            { id: 'privacy', label: 'Privacidade' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-discord-lighter text-white' : 'text-discord-text-muted hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'account' && <AccountTab email={user?.email} onSignOut={signOut} />}
      {tab === 'audio' && <AudioTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'privacy' && <PrivacyTab />}
    </Modal>
  )
}

function AccountTab({ email, onSignOut }: { email: string | undefined; onSignOut: () => void }) {
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleChangePassword() {
    setError(null)
    setSuccess(false)
    if (newPassword.length < 6) {
      setError('A senha precisa ter no mínimo 6 caracteres.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess(true)
    setNewPassword('')
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">E-mail</label>
        <p className="text-sm text-discord-text">{email}</p>
      </div>

      <div>
        <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">Nova senha</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Mínimo 6 caracteres"
          className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-discord-green">Senha alterada com sucesso.</p>}

      <button
        onClick={handleChangePassword}
        disabled={loading}
        className="w-full py-2.5 rounded bg-discord-blurple text-white font-medium hover:bg-indigo-600 transition-colors disabled:opacity-60"
      >
        {loading ? 'Salvando...' : 'Alterar senha'}
      </button>

      <div className="h-px bg-white/10" />

      <button
        onClick={onSignOut}
        className="w-full py-2.5 rounded border border-red-600 text-red-500 hover:bg-red-600/10 transition-colors"
      >
        Sair da conta
      </button>
    </div>
  )
}

function NotificationsTab() {
  const [permission, setPermission] = useState(getNotificationPermission())

  useEffect(() => {
    setPermission(getNotificationPermission())
  }, [])

  async function handleEnable() {
    const result = await requestNotificationPermission()
    setPermission(result)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-discord-text-muted">
        Receba notificações do navegador quando novas mensagens chegarem em uma conversa aberta e a aba estiver em
        segundo plano.
      </p>

      {permission === 'unsupported' ? (
        <p className="text-sm text-discord-text-muted">Seu navegador não suporta notificações.</p>
      ) : permission === 'granted' ? (
        <p className="text-sm text-discord-green">✓ Notificações ativadas.</p>
      ) : permission === 'denied' ? (
        <p className="text-sm text-red-400">
          Notificações bloqueadas. Habilite manualmente nas configurações do navegador pra este site.
        </p>
      ) : (
        <button
          onClick={handleEnable}
          className="px-4 py-2.5 rounded bg-discord-blurple text-white font-medium hover:bg-indigo-600 transition-colors text-sm"
        >
          Ativar notificações
        </button>
      )}
    </div>
  )
}

function AudioTab() {
  const audio = useAudioSettings()
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)

  async function handleRequestPermission() {
    await audio.requestPermission()
  }

  async function startTest() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audio.getAudioConstraints() })
      streamRef.current = stream
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const buffer = new Uint8Array(analyser.frequencyBinCount)

      function tick() {
        analyser.getByteFrequencyData(buffer)
        const avg = buffer.reduce((a, b) => a + b, 0) / buffer.length
        setLevel(Math.min(100, Math.round((avg / 100) * 100)))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      setTesting(true)
    } catch {
      // sem permissão/dispositivo — o botão simplesmente não faz nada
    }
  }

  function stopTest() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    audioCtxRef.current?.close()
    streamRef.current = null
    audioCtxRef.current = null
    setTesting(false)
    setLevel(0)
  }

  useEffect(() => () => stopTest(), [])

  return (
    <div className="space-y-5">
      {!audio.permissionGranted && (
        <div className="bg-discord-darker rounded-lg p-3">
          <p className="text-sm text-discord-text-muted mb-2">
            Autorize o acesso ao microfone pra ver os nomes dos seus dispositivos de áudio.
          </p>
          <button
            onClick={handleRequestPermission}
            className="text-sm px-3 py-1.5 rounded bg-discord-blurple text-white font-medium hover:bg-indigo-600 transition-colors"
          >
            Permitir acesso ao microfone
          </button>
        </div>
      )}

      <div>
        <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">Microfone de entrada</label>
        <select
          value={audio.micId ?? ''}
          onChange={(e) => audio.setMicId(e.target.value || null)}
          className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple text-sm"
        >
          <option value="">Padrão do sistema</option>
          {audio.microphones.map((m) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
          Alto-falante de saída {!audio.supportsOutputSelection && '(não suportado neste navegador)'}
        </label>
        <select
          value={audio.speakerId ?? ''}
          onChange={(e) => audio.setSpeakerId(e.target.value || null)}
          disabled={!audio.supportsOutputSelection}
          className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple text-sm disabled:opacity-50"
        >
          <option value="">Padrão do sistema</option>
          {audio.speakers.map((s) => (
            <option key={s.deviceId} value={s.deviceId}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="flex items-center justify-between text-sm text-discord-text cursor-pointer">
          Cancelamento de eco
          <input
            type="checkbox"
            checked={audio.echoCancellation}
            onChange={(e) => audio.setEchoCancellation(e.target.checked)}
            className="w-4 h-4 accent-discord-blurple"
          />
        </label>
        <label className="flex items-center justify-between text-sm text-discord-text cursor-pointer">
          Redução de ruído
          <input
            type="checkbox"
            checked={audio.noiseSuppression}
            onChange={(e) => audio.setNoiseSuppression(e.target.checked)}
            className="w-4 h-4 accent-discord-blurple"
          />
        </label>
        <label className="flex items-center justify-between text-sm text-discord-text cursor-pointer">
          Controle automático de ganho
          <input
            type="checkbox"
            checked={audio.autoGainControl}
            onChange={(e) => audio.setAutoGainControl(e.target.checked)}
            className="w-4 h-4 accent-discord-blurple"
          />
        </label>
      </div>

      <div>
        <button
          onClick={testing ? stopTest : startTest}
          className="text-sm px-4 py-2 rounded bg-discord-blurple text-white font-medium hover:bg-indigo-600 transition-colors"
        >
          {testing ? 'Parar teste' : 'Testar microfone'}
        </button>
        {testing && (
          <div className="mt-3 h-2.5 bg-discord-darker rounded-full overflow-hidden">
            <div
              className="h-full bg-discord-green transition-all duration-75"
              style={{ width: `${level}%` }}
            />
          </div>
        )}
      </div>

      <p className="text-xs text-discord-text-muted">
        As mudanças aqui valem pra próxima vez que você entrar em um canal de voz. Trocar o microfone durante uma
        chamada já em andamento também dá — use o seletor que aparece na barra de controles da chamada.
      </p>
    </div>
  )
}

function PrivacyTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-discord-text-muted">
        Para gerenciar quem pode te adicionar como amigo ou ver seu perfil, use a lista de bloqueados na aba{' '}
        <span className="text-white">Amigos</span> na tela inicial.
      </p>
      <p className="text-sm text-discord-text-muted">
        Seus dados (perfil, mensagens, servidores) são protegidos por Row Level Security no banco — só você e quem
        compartilha um servidor com você consegue ver seu conteúdo.
      </p>
    </div>
  )
}
