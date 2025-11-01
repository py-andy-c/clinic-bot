import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Listen on all interfaces for ngrok
    port: 5173,
    allowedHosts: [
      'clinic-bot-frontend.ngrok.io',
      'localhost',
    ],
    hmr: {
      clientPort: 443, // Use HTTPS port for ngrok
    },
  },
})
