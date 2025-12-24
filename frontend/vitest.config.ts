import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { existsSync } from 'fs';

// Check if .env file exists and is readable before Vite tries to load it
// If not, we'll rely on the define block for env vars
const envFileExists = existsSync('.env');

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
  // Configure environment variables for tests (hardcoded to avoid .env file loading issues)
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(process.env.VITE_API_BASE_URL || '/api'),
    'import.meta.env.VITE_LIFF_ID': JSON.stringify(process.env.VITE_LIFF_ID || 'test-liff-id'),
  },
});

