import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Listen on all interfaces for ngrok (development)
    port: 5173,
    allowedHosts: [
      'clinic-bot-frontend.ngrok.io',
      'localhost',
    ],
    hmr: {
      clientPort: 443, // Use HTTPS port for ngrok (development)
    },
  },
  // Production build settings
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          line: ['@line/liff'],
        },
      },
    },
  },
})
