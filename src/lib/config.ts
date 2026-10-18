// Aponta pro repositório real (Felipe-M-Soares/mamacoVoip). Se um dia
// mudar de usuário/repositório no GitHub, troque aqui também.
//
// IMPORTANTE: essa URL usa o formato especial do GitHub
// "releases/latest/download/<nome-do-arquivo>", que faz o navegador
// baixar o arquivo NA HORA em vez de abrir a página de releases — mas
// só funciona se <nome-do-arquivo> bater EXATAMENTE com o nome do
// artefato publicado (veja "nsis.artifactName" no package.json).
export const DESKTOP_DOWNLOAD_URL =
  'https://github.com/Felipe-M-Soares/mamacoVoip/releases/latest/download/MamacosVoip-Setup.exe'

// App Android (APK) — publicado no mesmo release (ver o job "android" em
// .github/workflows/release-desktop.yml e docs/ANDROID.md).
export const ANDROID_DOWNLOAD_URL =
  'https://github.com/Felipe-M-Soares/mamacoVoip/releases/latest/download/MamacosVoip.apk'

// Busca de GIFs no chat: KLIPY (o Tenor foi desligado em 30/06/2026 e
// o cadastro de chave nova do GIPHY parou de funcionar). A chave NÃO fica
// mais no app: a busca passa pela Edge Function gif-search, que lê o
// secret KLIPY_API_KEY no Supabase — ver supabase/functions/gif-search e
// docs/GIFS.md.

// URL pública do app na web (o deploy na Vercel). Usada só como base
// pra montar links de convite/compartilhamento QUANDO quem está gerando
// o link é o app desktop.
//
// Por quê: dentro do Electron, window.location.origin não é uma URL de
// verdade — é o protocolo interno da própria janela (algo como
// "app://bundle"), porque o app desktop não carrega o site, ele carrega
// os arquivos empacotados localmente. Um link de convite montado com
// esse "origin" errado fica com uma URL que não abre em lugar nenhum
// (nem em navegador, nem reaberto pelo próprio app) — é por isso que
// convites gerados pelo app desktop não funcionavam. No navegador (site
// de verdade), window.location.origin já reflete o domínio certo
// sozinho, então só o Electron precisa desse valor fixo aqui.
//
export const PUBLIC_WEB_URL = 'https://mamaco-voip.vercel.app'

// Versão dos Termos de Uso / Política de Privacidade em vigor (data da
// última alteração relevante). Quem não aceitou ESTA versão vê a tela de
// aceite (TermsGate) ao entrar — inclusive contas criadas pelo Google,
// que não passam pelo formulário de cadastro. Ao mudar os textos legais
// de forma relevante, atualize aqui para pedir o aceite de novo.
export const TERMS_VERSION = '2026-09-30'
