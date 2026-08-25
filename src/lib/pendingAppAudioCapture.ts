// Mesma ideia de screenShareGameHint.ts (uma "caixa de correio" simples
// em memória entre ScreenSharePicker.tsx e VoiceContext.tsx) — usada
// pra carregar o PID do processo escolhido quando a pessoa marca
// "Capturar áudio só deste app" (EXPERIMENTAL — ver o bloco grande em
// electron/main.cjs e native/process-audio-capture/capture.cpp).
//
// Por que não simplesmente passar o PID direto pra selectScreenShareSource?
// Porque a captura de áudio por processo é COMPLETAMENTE separada da
// escolha de vídeo (getDisplayMedia) — ela usa um processo (.exe) e um
// pipeline de IPC próprios (ver startProcessAudioCapture em
// electron/main.cjs). O picker só sabe qual PID foi escolhido; quem
// efetivamente inicia essa captura é o VoiceContext, depois que o vídeo
// já resolveu (mesmo motivo de timing de screenShareGameHint.ts: ler
// isso ANTES de getDisplayMedia() resolver pegaria sempre vazio).
let pendingAppAudioPid: number | null = null

export function setPendingAppAudioPid(pid: number | null) {
  pendingAppAudioPid = pid
}

export function takePendingAppAudioPid(): number | null {
  const value = pendingAppAudioPid
  pendingAppAudioPid = null
  return value
}
