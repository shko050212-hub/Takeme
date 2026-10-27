import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
  },
  server: {
    proxy: {
      '/routing': {
        target: 'http://52.63.245.203:3000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://52.63.245.203:3000',
        changeOrigin: true,
      },
      '/parent': {
        target: 'http://52.63.245.203:3000',
        changeOrigin: true,
      },
      '/teacher': {
        target: 'http://52.63.245.203:3000',
        changeOrigin: true,
      },
      '/chat': {
        target: 'http://52.63.245.203:3000',
        changeOrigin: true,
      },
      '/approval': {
        target: 'http://52.63.245.203:3000',
        changeOrigin: true,
      },
      '/directions': {
        target: 'http://52.63.245.203:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://52.63.245.203:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
