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
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  // Production build settings
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Vendor chunks
          if (id.includes('node_modules')) {
            // Don't manually chunk React - let Vite handle it automatically
            // This prevents module resolution issues where other chunks try to use React
            // before it's loaded
            
            // Only manually chunk large libraries that don't have React dependencies
            // Moment.js and timezone (large library, ~800KB)
            if (id.includes('moment')) {
              return 'moment-vendor';
            }
            // LINE LIFF SDK
            if (id.includes('@line/liff')) {
              return 'line-vendor';
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
            // Let Vite automatically chunk React and other dependencies
            // This ensures proper dependency resolution
          }
        },
      },
    },
  },
})
