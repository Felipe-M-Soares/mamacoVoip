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

// Busca de GIFs no chat. Até aqui usava a API do Tenor — mas o Google
// DESLIGOU o Tenor API de vez pra qualquer desenvolvedor de fora (parou
// de aceitar cliente novo em janeiro de 2026, e desligou todo mundo que
// já usava, inclusive quem já tinha chave, em 30/06/2026 — foi o mesmo
// motivo do GIF picker do Discord/WhatsApp/X/Bluesky terem quebrado na
// mesma época). Não existe mais chave de Tenor que funcione, nem nova
// nem antiga — por isso migrado pra API do GIPHY, que continua aceitando
// cadastro novo normalmente.
//
// Pra usar de verdade, cadastre a SUA chave (gratuito, poucos minutos):
// https://developers.giphy.com → criar conta → "Create an API Key" no
// Developer Dashboard → cole o valor aqui embaixo. A chave abaixo é só
// um placeholder e não funciona.
export const GIPHY_API_KEY = 'EU6ktp2I3dARvfow8NgQm0qEAkuAZaEn'

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
