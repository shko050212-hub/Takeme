import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/routing': {
        target: 'http://3.25.147.47:3000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://3.25.147.47:3000',
        changeOrigin: true,
      },
      '/parent': {
        target: 'http://3.25.147.47:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://3.25.147.47:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
