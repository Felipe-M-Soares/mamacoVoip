// Pequena "caixa de correio" em memória, só pra passar um recado entre
// ScreenSharePicker.tsx e VoiceContext.tsx, que rodam no mesmo processo
// de renderer (por isso um módulo comum com uma variável simples já
// resolve — não precisa de IPC do Electron nem de contexto do React).
//
// Serve pro caso do "Compartilhar seu jogo/janela" quando o alvo está em
// tela cheia exclusiva: nesse modo não existe uma "janela" separada pra
// capturar (ver o comentário grande em ScreenSharePicker.tsx), então o
// picker cai no atalho de capturar a TELA INTEIRA. O problema é que a
// tela, diferente de uma janela, nunca "fecha" sozinha quando o jogo é
// fechado — então o evento nativo `track.onended` (que já cuida do caso
// de compartilhar uma janela específica) nunca dispara, e a transmissão
// continuaria mostrando o desktop vazio depois do jogo fechar.
//
// O picker marca aqui QUAIS processos (não mais só um label do
// KNOWN_GAMES — generalizado pra qualquer jogo/app, cadastrado ou não,
// ver electron/main.cjs) essa captura de tela cheia é "sobre" antes de
// confirmar a escolha; o VoiceContext, assim que a captura começa, lê
// esse recado (e já apaga — só vale pra essa vez) e, se tiver algo, pede
// pro processo principal avisar quando esses processos deixarem de estar
// rodando, pra encerrar o compartilhamento sozinho.
export interface PendingGameShareHint {
  processNames: string[]
  label: string
}

let pendingGameShareHint: PendingGameShareHint | null = null

export function setPendingGameShareHint(hint: PendingGameShareHint | null) {
  pendingGameShareHint = hint
}

export function takePendingGameShareHint(): PendingGameShareHint | null {
  const value = pendingGameShareHint
  pendingGameShareHint = null
  return value
}
