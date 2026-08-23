import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useVoice } from '../../hooks/useVoice'
import { useAppUpdater } from '../../hooks/useAppUpdater'
import { useTheme } from '../../hooks/useTheme'
import { THEMES } from '../../context/ThemeContext'
import { getNotificationPermission, requestNotificationPermission } from '../../lib/notifications'
import { isSoundEnabled, setSoundEnabled, playConnectSound } from '../../lib/sounds'
import { SecurityTab } from './SecurityTab'
import { exportUserData } from '../../lib/exportUserData'
import { NetworkDiagnosticsPanel } from './NetworkDiagnosticsPanel'
import {
  createNoiseSuppressor,
  type NoiseSuppressor,
  MIN_MIC_SENSITIVITY,
  MAX_MIC_SENSITIVITY,
} from '../../lib/noiseSuppression'

type Tab = 'account' | 'security' | 'appearance' | 'audio' | 'notifications' | 'privacy'

const TABS: { id: Tab; label: string }[] = [
  { id: 'account', label: 'Minha conta' },
  { id: 'security', label: 'Segurança' },
  { id: 'appearance', label: 'Aparência' },
  { id: 'audio', label: 'Voz e Vídeo' },
  { id: 'notifications', label: 'Notificações' },
  { id: 'privacy', label: 'Privacidade' },
]

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('account')

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return createPortal(
    // Mesmo z-[500] do Modal.tsx — ver comentário lá. Configurações é uma
    // tela cheia que também deve ficar acima de qualquer painel lateral
    // (thread, mensagens fixadas) aberto antes dela.
    <div className="fixed inset-0 z-[500] bg-discord-darker flex">
      {/* Navegação — só do lado esquerdo, igual ao Discord de verdade */}
      <div className="w-56 shrink-0 bg-discord-sidebar flex flex-col py-8 px-3 overflow-y-auto">
        <p className="px-2.5 text-xs font-bold uppercase text-discord-text-muted tracking-wide mb-1.5">
          Configurações do usuário
        </p>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-left px-2.5 py-1.5 rounded text-sm font-medium mb-0.5 transition-colors ${
              tab === t.id ? 'bg-discord-lighter text-white' : 'text-discord-text-muted hover:bg-white/5 hover:text-discord-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-6 py-8">
          {tab === 'account' && <AccountTab email={user?.email} onSignOut={signOut} />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'audio' && <AudioTab />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'privacy' && <PrivacyTab />}
        </div>
      </div>

      <button
        onClick={onClose}
        className="fixed top-6 right-6 w-10 h-10 rounded-full border-2 border-discord-text-muted text-discord-text-muted hover:border-white hover:text-white flex items-center justify-center transition-colors"
        aria-label="Fechar"
        title="Fechar (Esc)"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
        </svg>
      </button>
    </div>,
    document.body
  )
}

function AppVersionInfo() {
  const [version, setVersion] = useState<string | null>(null)
  const { checkNow } = useAppUpdater()
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.electronAPI?.getVersion().then(setVersion)
  }, [])

  // Só existe dentro do app desktop — no site não faz sentido mostrar
  // versão de instalador nenhuma.
  if (!version) return null

  return (
    <div className="text-center pt-2 space-y-1.5">
      <p className="text-xs text-discord-text-muted">Mamacos Voip — versão {version}</p>
      <button
        onClick={() => {
          setChecking(true)
          checkNow()
          setTimeout(() => setChecking(false), 3000)
        }}
        disabled={checking}
        className="text-xs text-discord-blurple hover:underline disabled:opacity-60"
      >
        {checking ? 'Verificando...' : 'Verificar atualização agora'}
      </button>
    </div>
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

      <DeleteAccountSection />

      <AppVersionInfo />
    </div>
  )
}

function DeleteAccountSection() {
  const { signOut } = useAuth()
  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (confirmText.trim().toLowerCase() !== 'excluir') return
    setLoading(true)
    setError(null)
    const { error } = await supabase.rpc('delete_own_account')
    if (error) {
      setLoading(false)
      setError(error.message)
      return
    }
    await signOut()
  }

  return (
    <div className="pt-2">
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="w-full py-2.5 rounded border border-red-900 text-red-500/70 hover:bg-red-600/10 hover:text-red-500 transition-colors text-sm"
        >
          Excluir minha conta
        </button>
      ) : (
        <div className="bg-red-950/20 border border-red-900/50 rounded-lg p-3 space-y-2.5">
          <p className="text-sm text-red-400 font-medium">Isso não pode ser desfeito.</p>
          <p className="text-xs text-discord-text-muted">
            Sua conta, mensagens e servidores que você é dono são apagados de vez. Se você é dono de algum
            servidor, ele é apagado inteiro pra todo mundo — considere transferir a propriedade antes, se quiser
            manter o servidor de pé.
          </p>
          <p className="text-xs text-discord-text-muted">
            Digite <span className="text-white font-mono">excluir</span> pra confirmar.
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="excluir"
            className="w-full px-3 py-2 text-sm rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-red-600"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setConfirming(false)
                setConfirmText('')
                setError(null)
              }}
              className="flex-1 py-2 rounded btn-secondary text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleDelete}
              disabled={confirmText.trim().toLowerCase() !== 'excluir' || loading}
              className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-medium hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Excluindo...' : 'Excluir de vez'}
            </button>
          </div>
        </div>
      )}
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

// Switch em formato de pílula, igual o que o Discord usa em
// Configurações — o checkbox quadrado padrão do navegador não tem nada a
// ver com a cara do resto do app. Usado nos três controles de
// processamento de voz abaixo.
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full shrink-0 transition-colors ${
        checked ? 'bg-discord-green' : 'bg-discord-lighter'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function AudioTab() {
  // Antes esse componente chamava useAudioSettings() direto, criando uma
  // SEGUNDA instância independente do estado — separada da que o
  // VoiceContext usa de verdade pra call em andamento (voice.audioSettings).
  // As duas liam o mesmo localStorage só na hora de montar, então
  // funcionavam bem na primeira vez que a pessoa abria o app, mas
  // qualquer mudança feita aqui dentro (trocar microfone, ligar/desligar
  // redutor de ruído, trocar alto-falante) nunca chegava na call já
  // conectada nem no restante do app (ex.: o ícone de redutor de ruído
  // ao lado do perfil) — só valia depois de fechar e abrir o app de
  // novo. Usando a MESMA instância do VoiceContext, qualquer alteração
  // aqui já é a fonte da verdade em todo lugar.
  const voice = useVoice()
  const audio = voice.audioSettings
  const [testing, setTesting] = useState(false)
  const [echoing, setEchoing] = useState(false)
  const [level, setLevel] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const echoAudioRef = useRef<HTMLAudioElement>(null)
  // Reforço de redução de ruído (RNNoise) pro teste de mic/eco — usa a
  // mesma lógica de VoiceContext.tsx, pra o que a pessoa OUVE/VÊ aqui
  // bater com o que realmente sai na call de verdade.
  const noiseSuppressorTestRef = useRef<NoiseSuppressor | null>(null)
  // Arrastar o slider de sensibilidade dispara um onChange por PIXEL —
  // chamar voice.refreshAudioConstraints (que recaptura o microfone e
  // reconstrói o gráfico do RNNoise) a cada um desses seria pesado
  // demais numa call em andamento. Espera 400ms sem nenhuma mudança nova
  // antes de aplicar de verdade na call — a pessoa só ouve/vê o efeito
  // quando solta o slider (ou para de arrastar por um instante).
  const sensitivityDebounceRef = useRef<number | null>(null)

  function handleSensitivityChange(value: number) {
    audio.setMicSensitivity(value)
    if (sensitivityDebounceRef.current) window.clearTimeout(sensitivityDebounceRef.current)
    sensitivityDebounceRef.current = window.setTimeout(() => {
      voice.refreshAudioConstraints({ micSensitivity: value })
    }, 400)
  }

  function handleSensitivityModeChange(mode: 'auto' | 'manual') {
    audio.setMicSensitivityMode(mode)
    voice.refreshAudioConstraints({ micSensitivityMode: mode })
  }

  // Réplica, só pro teste/eco daqui do modal (que usa seu próprio
  // NoiseSuppressor local em vez do da call de verdade), do mesmo loop
  // de auto-ajuste de sensibilidade que roda em VoiceContext.tsx — ver o
  // comentário grande no useEffect "Sensibilidade automática do
  // microfone" lá pra entender a lógica da média móvel assimétrica.
  // Mantido em sincronia de propósito: assim o que a pessoa vê/ouve
  // testando aqui bate com o que acontece numa call de verdade.
  const testNoiseFloorDbRef = useRef<number | null>(null)
  const testLastAppliedThresholdDbRef = useRef<number | null>(null)
  const testAutoIntervalRef = useRef<number | null>(null)

  function stopTestAutoSensitivity() {
    if (testAutoIntervalRef.current) {
      window.clearInterval(testAutoIntervalRef.current)
      testAutoIntervalRef.current = null
    }
    testNoiseFloorDbRef.current = null
    testLastAppliedThresholdDbRef.current = null
  }

  function startTestAutoSensitivity(suppressor: NoiseSuppressor) {
    stopTestAutoSensitivity()
    testAutoIntervalRef.current = window.setInterval(() => {
      const level = suppressor.sampleLevelDb()
      if (level === null) return
      const floor = testNoiseFloorDbRef.current
      if (floor === null) {
        testNoiseFloorDbRef.current = level
        return
      }
      testNoiseFloorDbRef.current = level < floor ? floor * 0.7 + level * 0.3 : floor * 0.98 + level * 0.02
      const threshold = Math.max(-80, Math.min(-20, testNoiseFloorDbRef.current + 12))
      const last = testLastAppliedThresholdDbRef.current
      if (last === null || Math.abs(threshold - last) >= 1.5) {
        testLastAppliedThresholdDbRef.current = threshold
        suppressor.setSensitivityDb(threshold)
      }
    }, 1000)
  }

  // Aplica o RNNoise na track crua, se a redução de ruído estiver ligada
  // — devolve a stream já tratada (ou a crua sem alteração, se estiver
  // desligada ou o WASM falhar ao carregar).
  async function applyTestNoiseSuppression(rawStream: MediaStream): Promise<MediaStream> {
    if (!audio.noiseSuppression) return rawStream
    try {
      const suppressor = await createNoiseSuppressor()
      noiseSuppressorTestRef.current = suppressor
      const isAuto = audio.micSensitivityMode === 'auto'
      const processedTrack = suppressor.setInputTrack(rawStream.getAudioTracks()[0], isAuto ? null : audio.micSensitivity)
      if (isAuto) startTestAutoSensitivity(suppressor)
      return new MediaStream([processedTrack])
    } catch {
      // segue só com o cancelamento nativo do navegador
      return rawStream
    }
  }

  async function handleRequestPermission() {
    await audio.requestPermission()
  }

  async function startTest() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audio.getAudioConstraints() })
      streamRef.current = stream
      const testStream = await applyTestNoiseSuppression(stream)
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(testStream)
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
    noiseSuppressorTestRef.current?.destroy()
    noiseSuppressorTestRef.current = null
    stopTestAutoSensitivity()
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
      const echoStream = await applyTestNoiseSuppression(stream)
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(echoStream)
      const delay = ctx.createDelay(1)
      delay.delayTime.value = 0.15
      // Duplica explicitamente pros dois canais (ver o mesmo truque em
      // noiseSuppression.ts) — sem isso, o eco às vezes só saía pelo
      // lado esquerdo do fone quando a captura do microfone é mono
      // (praticamente sempre é, ver getAudioConstraints).
      const merger = ctx.createChannelMerger(2)
      const dest = ctx.createMediaStreamDestination()
      source.connect(delay)
      delay.connect(merger, 0, 0)
      delay.connect(merger, 0, 1)
      merger.connect(dest)

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
    noiseSuppressorTestRef.current?.destroy()
    noiseSuppressorTestRef.current = null
    stopTestAutoSensitivity()
    if (echoAudioRef.current) echoAudioRef.current.srcObject = null
    setEchoing(false)
  }

  useEffect(
    () => () => {
      stopTest()
      stopEcho()
      stopTestAutoSensitivity()
      if (sensitivityDebounceRef.current) window.clearTimeout(sensitivityDebounceRef.current)
    },
    []
  )

  // Igual o próprio Discord faz na tela de configurações: se o teste de
  // microfone já está rodando, ligar/desligar redução de ruído (ou eco,
  // ou ganho automático) reinicia o teste na hora com a config nova —
  // assim dá pra OUVIR/VER a diferença na barra de nível imediatamente,
  // em vez de ter que parar e começar o teste nas mãos toda vez. Não
  // depende de `testing` de propósito: só deve disparar quando uma
  // dessas configs muda enquanto o teste já está ativo, não quando o
  // teste começa (senão dispararia duas vezes ao clicar em "Testar
  // microfone").
  useEffect(() => {
    if (!testing) return
    stopTest()
    startTest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    audio.echoCancellation,
    audio.noiseSuppression,
    audio.autoGainControl,
    audio.micId,
    audio.micSensitivity,
    audio.micSensitivityMode,
  ])

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
          onChange={(e) => voice.changeMicrophone(e.target.value)}
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

      <div>
        <p className="text-xs font-bold uppercase text-discord-text-muted tracking-wide mb-2">
          Processamento de voz
        </p>
        <div className="bg-discord-darker rounded-lg divide-y divide-white/5">
          <div className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">Redução de ruído</p>
              <p className="text-xs text-discord-text-muted mt-0.5">
                Reduz ruído de fundo constante (ventoinha, teclado, ar-condicionado) enquanto você fala.
              </p>
            </div>
            <ToggleSwitch
              checked={audio.noiseSuppression}
              onChange={(checked) => {
                audio.setNoiseSuppression(checked)
                voice.refreshAudioConstraints({ noiseSuppression: checked })
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">Cancelamento de eco</p>
              <p className="text-xs text-discord-text-muted mt-0.5">
                Evita que o som que sai do seu alto-falante volte pelo microfone.
              </p>
            </div>
            <ToggleSwitch
              checked={audio.echoCancellation}
              onChange={(checked) => {
                audio.setEchoCancellation(checked)
                voice.refreshAudioConstraints({ echoCancellation: checked })
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">Controle automático de ganho</p>
              <p className="text-xs text-discord-text-muted mt-0.5">
                Ajusta o volume de captura sozinho, pra sua voz não ficar baixa nem estourar.
              </p>
            </div>
            <ToggleSwitch
              checked={audio.autoGainControl}
              onChange={(checked) => {
                audio.setAutoGainControl(checked)
                voice.refreshAudioConstraints({ autoGainControl: checked })
              }}
            />
          </div>
          <div className="p-3">
            <div className="min-w-0 mb-2">
              <p className="text-sm font-medium text-white">Sensibilidade do microfone</p>
              <p className="text-xs text-discord-text-muted mt-0.5">
                Corta o microfone quando o volume está abaixo desse nível — bom pra parar de captar o teclado ou
                sons baixos da mesa entre uma fala e outra.
              </p>
            </div>
            <div className="flex gap-1 mb-3 bg-discord-dark rounded-md p-0.5">
              <button
                onClick={() => handleSensitivityModeChange('auto')}
                className={`flex-1 text-xs font-medium py-1.5 rounded transition-colors ${
                  audio.micSensitivityMode === 'auto'
                    ? 'bg-discord-blurple text-white'
                    : 'text-discord-text-muted hover:text-white'
                }`}
              >
                Automática
              </button>
              <button
                onClick={() => handleSensitivityModeChange('manual')}
                className={`flex-1 text-xs font-medium py-1.5 rounded transition-colors ${
                  audio.micSensitivityMode === 'manual'
                    ? 'bg-discord-blurple text-white'
                    : 'text-discord-text-muted hover:text-white'
                }`}
              >
                Manual
              </button>
            </div>
            {audio.micSensitivityMode === 'auto' ? (
              <p className="text-xs text-discord-text-muted">
                O app mede o ruído do seu ambiente sozinho e ajusta o corte automaticamente enquanto você está numa
                chamada — não precisa mexer em nada.
              </p>
            ) : (
              <>
                <input
                  type="range"
                  min={MIN_MIC_SENSITIVITY}
                  max={MAX_MIC_SENSITIVITY}
                  value={audio.micSensitivity}
                  onChange={(e) => handleSensitivityChange(Number(e.target.value))}
                  className="w-full accent-discord-blurple"
                />
                <div className="flex justify-between text-[10px] text-discord-text-muted mt-1">
                  <span>Menos sensível</span>
                  <span>Mais sensível</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div>
        <button
          onClick={testing ? stopTest : startTest}
          className="text-sm px-4 py-2 rounded btn-primary"
        >
          {testing ? 'Parar teste' : 'Testar microfone'}
        </button>
        {testing && (
          <>
            <p className="text-xs text-discord-text-muted mt-2">
              Fala alguma coisa — a barra reage ao volume captado. Dá pra ligar/desligar os controles acima com o
              teste rodando pra ouvir a diferença na hora.
            </p>
            <div className="mt-2 h-2.5 bg-discord-darker rounded-full overflow-hidden">
              <div
                className="h-full bg-discord-green transition-all duration-75"
                style={{ width: `${level}%` }}
              />
            </div>
          </>
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

      <div className="h-px bg-white/10" />

      <NetworkDiagnosticsPanel />
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
  const { profile, updateProfile } = useAuth()
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  async function handleChange(visibility: 'everyone' | 'friends_only') {
    setSaving(true)
    await updateProfile({ profile_visibility: visibility })
    setSaving(false)
  }

  async function handleExport() {
    if (!profile) return
    setExporting(true)
    try {
      await exportUserData(profile.id)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
          Quem pode ver seu perfil completo
        </label>
        <div className="space-y-2">
          <button
            onClick={() => handleChange('everyone')}
            disabled={saving}
            className={`w-full text-left px-3 py-2.5 rounded border transition-colors ${
              (profile?.profile_visibility ?? 'everyone') === 'everyone'
                ? 'border-discord-blurple bg-discord-blurple/10'
                : 'border-transparent bg-discord-darker hover:bg-discord-lighter'
            }`}
          >
            <p className="text-sm text-white font-medium">Todo mundo</p>
            <p className="text-xs text-discord-text-muted">
              Qualquer pessoa que compartilha um servidor com você vê seu perfil completo.
            </p>
          </button>
          <button
            onClick={() => handleChange('friends_only')}
            disabled={saving}
            className={`w-full text-left px-3 py-2.5 rounded border transition-colors ${
              profile?.profile_visibility === 'friends_only'
                ? 'border-discord-blurple bg-discord-blurple/10'
                : 'border-transparent bg-discord-darker hover:bg-discord-lighter'
            }`}
          >
            <p className="text-sm text-white font-medium">Só amigos</p>
            <p className="text-xs text-discord-text-muted">
              Quem não é seu amigo vê só seu nome e foto — nada de status, "jogando" ou outros detalhes.
            </p>
          </button>
        </div>
      </div>
      <p className="text-sm text-discord-text-muted">
        Para gerenciar quem pode te adicionar como amigo, use a lista de bloqueados na aba{' '}
        <span className="text-white">Amigos</span> na tela inicial.
      </p>
      <p className="text-sm text-discord-text-muted">
        Seus dados (perfil, mensagens, servidores) são protegidos por Row Level Security no banco — só você e quem
        compartilha um servidor com você consegue ver seu conteúdo.
      </p>

      <div>
        <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">Seus dados</label>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="w-full py-2.5 rounded btn-secondary text-sm disabled:opacity-60"
        >
          {exporting ? 'Preparando arquivo...' : 'Baixar meus dados'}
        </button>
        <p className="text-[10px] text-discord-text-muted mt-1.5">
          Gera um arquivo com seu perfil, servidores, amizades e mensagens que você mandou.
        </p>
      </div>
    </div>
  )
}
