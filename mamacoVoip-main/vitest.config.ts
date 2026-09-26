import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Config separada do vite.config.ts (que é só pro build de produção)
// pra não arriscar misturar configuração de teste com a configuração
// que de fato vai pro app publicado.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
