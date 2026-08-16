// Troque SEU_USUARIO_GITHUB/SEU_REPOSITORIO quando publicar os releases
// do app desktop no GitHub (depois de rodar `npm run electron:build` e
// subir os artefatos, ou configurar CI pra fazer isso automaticamente).
//
// IMPORTANTE: essa URL usa o formato especial do GitHub
// "releases/latest/download/<nome-do-arquivo>", que faz o navegador
// baixar o arquivo NA HORA em vez de abrir a página de releases — mas
// só funciona se <nome-do-arquivo> bater EXATAMENTE com o nome do
// artefato publicado (veja "nsis.artifactName" no package.json).
export const DESKTOP_DOWNLOAD_URL =
  'https://github.com/SEU_USUARIO_GITHUB/SEU_REPOSITORIO/releases/latest/download/MamacosVoip-Setup.exe'
