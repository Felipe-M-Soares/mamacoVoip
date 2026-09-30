import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

// Versão do app (package.json) pra tela "Sobre → Licenças" — no site não
// existe electronAPI.getVersion().
const APP_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? ''
  } catch {
    return ''
  }
})()

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
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [react(), tailwindcss(), ...(mode === 'electron' ? [stripCrossoriginForElectron()] : [])],
  build: {
    rollupOptions: {
      output: {
        // Bibliotecas grandes e que mudam pouco em chunks próprios: o
        // navegador/Electron reaproveita do cache entre versões do app, e o
        // LiveKit (~1/3 do código total) só é baixado junto com o layout
        // principal — as telas de login/cadastro não precisam dele.
        // O teste antigo `id.includes('react')` pegava qualquer caminho com
        // "react" no nome; agora compara o nome exato do pacote.
        manualChunks(id) {
          const match = id.match(/[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/)
          if (!match) return undefined
          const pkg = match[1].replace(/\\/g, '/')
          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react-vendor'
          if (pkg === 'react-router' || pkg === 'react-router-dom') return 'router-vendor'
          if (pkg.startsWith('@supabase/') || pkg === 'iceberg-js') return 'supabase-vendor'
          if (pkg === 'livekit-client' || pkg.startsWith('@livekit/')) return 'livekit-vendor'
          return undefined
        },
      },
    },
  },
}))
