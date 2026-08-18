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

// Busca de GIFs no chat (API do Tenor, gratuita). Essa é a chave
// PÚBLICA de teste que o próprio Tenor disponibiliza pra qualquer
// desenvolvedor experimentar — funciona, mas tem limite de uso
// compartilhado com todo mundo que também estiver usando ela. Pra
// produção de verdade, registre a sua (gratuito, alguns minutos):
// https://tenor.com/gifapi → "Get API Key" → cole aqui embaixo.
export const TENOR_API_KEY = 'LIVDSRZULELA'
