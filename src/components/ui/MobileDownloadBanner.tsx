import { DESKTOP_DOWNLOAD_URL } from '../../lib/config'

// VIGÉSIMA SEXTA RODADA — pedido explícito: "colocar modo de baixar o
// app no mobile". O app já tinha um link discreto de "Baixar o app pra
// PC" no rodapé da tela de login (ver Login.tsx) — mas ele é fácil de
// nem notar, ainda mais rolando a tela num celular. Este banner é bem
// mais chamativo, e some sozinho em duas situações onde não faz
// sentido nenhum mostrar ele:
//   - `md:hidden` — só aparece em telas pequenas (celular). Em
//     desktop/tablet o link discreto do rodapé já é suficiente.
//   - dentro do próprio app desktop (Electron) — ninguém que já está
//     rodando o app precisa ser convidado a baixar ele de novo.
//
// Hoje o app é só desktop (Windows) — não existe versão nativa pra
// Android/iOS ainda (é um projeto futuro à parte, bem maior). Por isso
// o texto é claro sobre ser "a versão de computador", em vez de deixar
// a pessoa achar que está baixando um app pro celular dela.
export function MobileDownloadBanner() {
  if (window.electronAPI?.isElectron) return null

  return (
    <a
      href={DESKTOP_DOWNLOAD_URL}
      target="_blank"
      rel="noreferrer"
      className="md:hidden relative z-10 mb-4 flex items-center gap-3 rounded-xl border border-discord-blurple/30 bg-discord-blurple/10 px-4 py-3 text-left transition-colors hover:bg-discord-blurple/15"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-discord-blurple/20 text-discord-blurple">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l3.3 3.3V4a1 1 0 0 1 1-1zM4 19a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4z" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">Baixe o app pra computador</p>
        <p className="text-xs text-discord-text-muted">Voz, vídeo e compartilhamento de tela — a experiência completa é no PC</p>
      </div>
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0 text-discord-text-muted">
        <path d="M9.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 0 1-1.4-1.4L14.6 12 9.3 6.7a1 1 0 0 1 0-1.4z" />
      </svg>
    </a>
  )
}
