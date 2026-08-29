import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// O Vite adiciona crossorigin nas tags <script>/<link> por padrão — bom
// pra um site normal, mas isso faz o Chromium tentar um fetch em modo
// CORS pros arquivos, o que FALHA EM SILÊNCIO quando o app é aberto
// via file:// (como o Electron faz). Resultado: nenhum script carrega,
// tela preta, e nem aparece erro nenhum no console. Isso é o que
// provavelmente estava causando a tela preta no app instalado.
function stripCrossoriginForElectron(): Plugin {
  return {
    name: 'strip-crossorigin-for-electron',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(="[^"]*")?/g, '')
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // O app desktop (Electron) abre o index.html direto do disco
  // (file://), onde caminhos absolutos como "/assets/x.js" tentam
  // carregar da raiz do sistema de arquivos inteiro em vez da pasta
  // certa — isso é o que causava a tela preta ao abrir o app instalado.
  // Caminhos relativos ("./assets/x.js") resolvem certo nos dois casos,
  // MAS quebrariam rotas aninhadas tipo /convite/CODIGO no site (que
  // usa roteamento do lado do cliente), então só usamos "./" quando o
  // build é especificamente pro Electron (`npm run build:electron`).
  base: mode === 'electron' ? './' : '/',
  plugins: [react(), tailwindcss(), ...(mode === 'electron' ? [stripCrossoriginForElectron()] : [])],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('scheduler')) return 'react-vendor'
            if (id.includes('@supabase')) return 'supabase-vendor'
          }
        },
      },
    },
  },
}))
