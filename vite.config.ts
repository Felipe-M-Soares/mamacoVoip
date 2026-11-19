import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const APP_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? ''
  } catch {
    return ''
  }
})()

function stripCrossoriginForElectron(): Plugin {
  return {
    name: 'strip-crossorigin-for-electron',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(="[^"]*")?/g, '')
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: mode === 'electron' ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [react(), tailwindcss(), ...(mode === 'electron' ? [stripCrossoriginForElectron()] : [])],
  build: {
    rollupOptions: {
      output: {
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
