import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// For tests, we don't want Vite to automatically load .env files
// Instead, we'll manually handle env vars via the define block
// This prevents EPERM errors when .env file has permission issues

export default defineConfig({
  plugins: [react()],
  // Prevent Vite from automatically loading .env files during tests
  // This avoids permission issues and ensures consistent test behavior
  // Setting envDir to false prevents Vite from loading any .env files
  envDir: false, // Don't load .env files automatically
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/e2e/**', // Exclude Playwright E2E tests (they're run separately)
    ],
  },
  // Configure environment variables for tests (hardcoded to avoid .env file loading issues)
  // These values are used instead of loading from .env file
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(process.env.VITE_API_BASE_URL || '/api'),
    'import.meta.env.VITE_LIFF_ID': JSON.stringify(process.env.VITE_LIFF_ID || 'test-liff-id'),
  },
});

