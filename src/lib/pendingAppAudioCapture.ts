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
// `isWindowChoice` existe só pra diagnóstico: diz pro VoiceContext se a
// gente ESPERAVA conseguir um PID pra essa escolha (onde a gente SEMPRE
// tenta áudio automático por processo) — cobre tanto uma JANELA normal
// quanto o card "Jogo" mesmo quando ele só pôde ser resolvido como TELA
// CHEIA (jogo em modo exclusivo/flip-model, sem janela composta pro
// Windows fotografar — ver pidForChoice em ScreenSharePicker.tsx: nesse
// caso ainda sabemos o PID do jogo, só não dava pra capturar a janela
// dele). Se `isWindowChoice` for true mas `pid` vier nulo mesmo assim, é
// sinal de que a descoberta do processo falhou (ver getGameWindowInfo/
// getWindowPidMap em electron/main.cjs), e isso deve aparecer como aviso
// pra quem está usando, em vez de só ficar em silêncio sem áudio nenhum
// e sem pista nenhuma do motivo (era exatamente esse silêncio, sem erro
// visível em lugar nenhum, que tornava esse tipo de falha impossível de
// diagnosticar à distância).
export interface PendingAppAudioChoice {
  pid: number | null
  isWindowChoice: boolean
}

let pendingAppAudioChoice: PendingAppAudioChoice | null = null

export function setPendingAppAudioPid(choice: PendingAppAudioChoice | null) {
  pendingAppAudioChoice = choice
}

export function takePendingAppAudioPid(): PendingAppAudioChoice | null {
  const value = pendingAppAudioChoice
  pendingAppAudioChoice = null
  return value
}
