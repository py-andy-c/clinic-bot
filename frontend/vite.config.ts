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
        manualChunks: (id) => {
          // Vendor chunks
          if (id.includes('node_modules')) {
            // React and React DOM
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-vendor';
            }
            // React Router
            if (id.includes('react-router')) {
              return 'router-vendor';
            }
            // LINE LIFF SDK
            if (id.includes('@line/liff')) {
              return 'line-vendor';
            }
            // Moment.js and timezone (large library)
            if (id.includes('moment')) {
              return 'moment-vendor';
            }
            // React Big Calendar (large calendar library)
            if (id.includes('react-big-calendar')) {
              return 'calendar-vendor';
            }
            // Axios
            if (id.includes('axios')) {
              return 'axios-vendor';
            }
            // Zustand
            if (id.includes('zustand')) {
              return 'zustand-vendor';
            }
            // Other vendor libraries
            return 'vendor';
          }
        },
      },
    },
  },
})
