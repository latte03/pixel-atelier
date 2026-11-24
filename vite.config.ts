import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const backend = 'http://127.0.0.1:8898'
const proxyPaths = [
  '/jobs', '/references', '/exports', '/projects', '/project', '/production',
  '/config', '/models', '/catalog', '/examples', '/example', '/image',
  '/reference', '/export', '/health',
]

export default defineConfig({
  root: fileURLToPath(new URL('./frontend', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./frontend/src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(proxyPaths.map(path => [path, {
      target: backend,
      changeOrigin: true,
      headers: { Origin: backend },
    }])),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
})
