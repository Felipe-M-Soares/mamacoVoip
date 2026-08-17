import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useAudioSettings } from '../../hooks/useAudioSettings'
import { useVoice } from '../../hooks/useVoice'
import { useTheme } from '../../hooks/useTheme'
import { THEMES } from '../../context/ThemeContext'
import { getNotificationPermission, requestNotificationPermission } from '../../lib/notifications'
import { isSoundEnabled, setSoundEnabled, playConnectSound } from '../../lib/sounds'

type Tab = 'account' | 'appearance' | 'audio' | 'notifications' | 'privacy'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('account')

  return (
    <Modal title="Configurações" onClose={onClose} maxWidth="max-w-lg">
      <div className="flex gap-1 mb-4 bg-discord-darker rounded-lg p-1 overflow-x-auto">
        {(
          [
            { id: 'account', label: 'Minha conta' },
            { id: 'appearance', label: 'Aparência' },
            { id: 'audio', label: 'Voz e Vídeo' },
            { id: 'notifications', label: 'Notificações' },
            { id: 'privacy', label: 'Privacidade' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-discord-lighter text-white' : 'text-discord-text-muted hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'account' && <AccountTab email={user?.email} onSignOut={signOut} />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'audio' && <AudioTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'privacy' && <PrivacyTab />}
    </Modal>
  )
}

function AppVersionInfo() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI?.getVersion().then(setVersion)
  }, [])

  // Só existe dentro do app desktop — no site não faz sentido mostrar
  // versão de instalador nenhuma.
  if (!version) return null

  return (
    <p className="text-xs text-discord-text-muted text-center pt-2">
      Mamacos Voip — versão {version}
    </p>
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
        className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
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

      <AppVersionInfo />
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
          className="px-4 py-2.5 rounded btn-primary text-sm"
        >
          Ativar notificações
        </button>
      )}
    </div>
  )
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="space-y-4">
      <p className="text-sm text-discord-text-muted">Escolha a paleta de cores do app.</p>
      <div className="grid grid-cols-1 gap-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-colors ${
              theme === t.id ? 'border-discord-blurple bg-discord-darker' : 'border-transparent bg-discord-darker/60 hover:bg-discord-darker'
            }`}
          >
            <span
              className="w-10 h-10 rounded-full shrink-0 border border-white/10"
              style={{
                background: `radial-gradient(circle at 30% 30%, ${t.swatch}, #000000 120%)`,
              }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">{t.label}</p>
              <p className="text-xs text-discord-text-muted">{t.description}</p>
            </div>
            {theme === t.id && (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-blurple shrink-0">
                <path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20 8l-1.4-1.4z" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function AudioTab() {
  const audio = useAudioSettings()
  const [testing, setTesting] = useState(false)
  const [echoing, setEchoing] = useState(false)
  const [level, setLevel] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const echoAudioRef = useRef<HTMLAudioElement>(null)

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

  // Eco de áudio: pega o microfone, atrasa um pouco (150ms) e toca de
  // volta pelo alto-falante escolhido. É o jeito mais direto de
  // confirmar que o fone/headset inteiro funciona (mic + saída), sem
  // precisar de outra pessoa online — o pequeno atraso evita a
  // microfonia (efeito Larsen) que aconteceria com um loopback instantâneo.
  async function startEcho() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audio.getAudioConstraints() })
      streamRef.current = stream
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const delay = ctx.createDelay(1)
      delay.delayTime.value = 0.15
      const dest = ctx.createMediaStreamDestination()
      source.connect(delay)
      delay.connect(dest)

      if (echoAudioRef.current) {
        echoAudioRef.current.srcObject = dest.stream
        const el = echoAudioRef.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
        if (audio.speakerId && el.setSinkId) await el.setSinkId(audio.speakerId).catch(() => {})
        await echoAudioRef.current.play()
      }
      setEchoing(true)
    } catch {
      // sem permissão/dispositivo — o botão simplesmente não faz nada
    }
  }

  function stopEcho() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    audioCtxRef.current?.close()
    streamRef.current = null
    audioCtxRef.current = null
    if (echoAudioRef.current) echoAudioRef.current.srcObject = null
    setEchoing(false)
  }

  useEffect(
    () => () => {
      stopTest()
      stopEcho()
    },
    []
  )

  return (
    <div className="space-y-5">
      <audio ref={echoAudioRef} className="hidden" />
      {!audio.permissionGranted && (
        <div className="bg-discord-darker rounded-lg p-3">
          <p className="text-sm text-discord-text-muted mb-2">
            Autorize o acesso ao microfone pra ver os nomes dos seus dispositivos de áudio.
          </p>
          <button
            onClick={handleRequestPermission}
            className="text-sm px-3 py-1.5 rounded btn-primary"
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
          className="text-sm px-4 py-2 rounded btn-primary"
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

      <div className="bg-discord-darker rounded-lg p-3 space-y-2">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <p className="text-sm font-medium text-white">Sons de interface</p>
            <p className="text-xs text-discord-text-muted">
              Toques originais ao conectar/desconectar da voz, mutar e quando alguém entra ou sai da chamada.
            </p>
          </div>
          <input
            type="checkbox"
            defaultChecked={isSoundEnabled()}
            onChange={(e) => {
              setSoundEnabled(e.target.checked)
              if (e.target.checked) playConnectSound()
            }}
            className="w-4 h-4 accent-discord-blurple shrink-0 ml-3"
          />
        </label>
      </div>

      <div className="bg-discord-darker rounded-lg p-3 space-y-2">
        <p className="text-sm font-medium text-white">Testar mic + fone juntos (eco)</p>
        <p className="text-xs text-discord-text-muted">
          Fala alguma coisa e escuta sua própria voz voltando com um pequeno atraso — se você se ouvir, o microfone
          e o alto-falante/fone escolhidos estão funcionando juntos. Use fone de ouvido pra evitar microfonia.
        </p>
        <button
          onClick={echoing ? stopEcho : startEcho}
          className={`text-sm px-4 py-2 rounded font-medium transition-colors ${
            echoing ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-discord-lighter text-white hover:opacity-90'
          }`}
        >
          {echoing ? 'Parar eco' : 'Ouvir a si mesmo (eco)'}
        </button>
      </div>

      <div className="bg-discord-darker rounded-lg p-3 space-y-3">
        <PushToTalkSection />
      </div>

      {window.electronAPI?.isElectron && (
        <div className="bg-discord-darker rounded-lg p-3">
          <p className="text-sm font-medium text-white">Sobreposição em jogos</p>
          <p className="text-xs text-discord-text-muted mt-1">
            Aperte <kbd className="bg-discord-lighter px-1.5 py-0.5 rounded font-mono text-[10px]">Ctrl+Shift+O</kbd>{' '}
            a qualquer momento (mesmo com o jogo em foco) pra mostrar/esconder quem está falando na call, por cima
            do jogo. Funciona com o jogo em janela sem borda — não aparece por cima de jogos em tela cheia
            exclusiva.
          </p>
        </div>
      )}

      <p className="text-xs text-discord-text-muted">
        As mudanças aqui valem pra próxima vez que você entrar em um canal de voz. Trocar o microfone durante uma
        chamada já em andamento também dá — use o seletor que aparece na barra de controles da chamada.
      </p>
    </div>
  )
}

function PushToTalkSection() {
  const voice = useVoice()
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!capturing || voice.globalPushToTalkAvailable) return
    // Reserva: só usada quando o modo global não está disponível
    // nesse sistema — captura via teclado normal do navegador/app,
    // que só funciona com o app em foco.
    function handleKey(e: KeyboardEvent) {
      e.preventDefault()
      voice.setPushToTalkKey(e.code)
      setCapturing(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [capturing, voice])

  async function handleCaptureClick() {
    if (voice.globalPushToTalkAvailable) {
      setCapturing(true)
      await voice.captureGlobalPushToTalkKey()
      setCapturing(false)
      return
    }
    setCapturing(true)
  }

  const currentKeyLabel = voice.globalPushToTalkAvailable
    ? voice.pushToTalkGlobalKeyName ?? 'Nenhuma definida'
    : formatKeyCode(voice.pushToTalkKey)

  return (
    <>
      <label className="flex items-center justify-between cursor-pointer">
        <div>
          <p className="text-sm font-medium text-white">Push-to-talk</p>
          <p className="text-xs text-discord-text-muted">
            Microfone fica desligado o tempo todo — só transmite enquanto você segura a tecla escolhida.{' '}
            {voice.globalPushToTalkAvailable
              ? 'Funciona mesmo com outro programa (o jogo, por exemplo) em foco.'
              : 'Só funciona com o Mamacos Voip em foco (não funciona por cima de um jogo em tela cheia).'}
          </p>
        </div>
        <input
          type="checkbox"
          checked={voice.pushToTalkEnabled}
          onChange={(e) => voice.setPushToTalkEnabled(e.target.checked)}
          className="w-4 h-4 accent-discord-blurple shrink-0 ml-3"
        />
      </label>

      {voice.pushToTalkEnabled && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-discord-text-muted">Tecla</span>
          <button
            onClick={handleCaptureClick}
            className={`text-xs px-3 py-1.5 rounded font-mono transition-colors ${
              capturing ? 'bg-discord-blurple text-white animate-pulse' : 'bg-discord-lighter text-discord-text hover:opacity-90'
            }`}
          >
            {capturing ? 'Pressione uma tecla...' : currentKeyLabel}
          </button>
        </div>
      )}
    </>
  )
}

function formatKeyCode(code: string): string {
  const map: Record<string, string> = {
    ControlLeft: 'Ctrl (esquerdo)',
    ControlRight: 'Ctrl (direito)',
    ShiftLeft: 'Shift (esquerdo)',
    ShiftRight: 'Shift (direito)',
    AltLeft: 'Alt (esquerdo)',
    AltRight: 'Alt (direito)',
    Space: 'Espaço',
    CapsLock: 'Caps Lock',
  }
  return map[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '')
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
