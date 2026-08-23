// Pequena "caixa de correio" em memória, só pra passar um recado entre
// ScreenSharePicker.tsx e VoiceContext.tsx, que rodam no mesmo processo
// de renderer (por isso um módulo comum com uma variável simples já
// resolve — não precisa de IPC do Electron nem de contexto do React).
//
// Serve pro caso do "Compartilhar seu jogo" quando o jogo está em tela
// cheia exclusiva: nesse modo não existe uma "janela" separada pra
// capturar (ver o comentário grande em ScreenSharePicker.tsx), então o
// picker cai no atalho de capturar a TELA INTEIRA. O problema é que a
// tela, diferente de uma janela, nunca "fecha" sozinha quando o jogo é
// fechado — então o evento nativo `track.onended` (que já cuida do caso
// de compartilhar uma janela específica) nunca dispara, e a transmissão
// continuaria mostrando o desktop vazio depois do jogo fechar.
//
// O picker marca aqui QUAL jogo essa captura de tela cheia é "sobre"
// antes de confirmar a escolha; o VoiceContext, assim que a captura
// começa, lê esse recado (e já apaga — só vale pra essa vez) e, se
// tiver algo, passa a escutar a detecção de jogo (electron/main.cjs) pra
// encerrar o compartilhamento sozinho quando aquele jogo específico
// deixar de estar rodando.
let pendingGameShareHint: string | null = null

export function setPendingGameShareHint(gameName: string | null) {
  pendingGameShareHint = gameName
}

export function takePendingGameShareHint(): string | null {
  const value = pendingGameShareHint
  pendingGameShareHint = null
  return value
}
