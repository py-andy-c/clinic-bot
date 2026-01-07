import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load E2E environment variables
dotenv.config({ path: '../.env.e2e' });

export default defineConfig({
  globalSetup: './global-setup.ts',
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined, // Auto-detect locally
  reporter: [
    ['html', { outputFolder: '../playwright-report' }],
    ['list'],
    ['json', { outputFile: '../test-results/results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'cd ../backend && source venv/bin/activate && cd src && uvicorn main:app --host 0.0.0.0 --port 8001',
      url: 'http://localhost:8001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000, // 120s for backend (includes migrations)
      retries: 3, // Retry health check 3 times with exponential backoff
      env: {
        DATABASE_URL: process.env.E2E_DATABASE_URL || 'postgresql://user:password@localhost/clinic_bot_e2e',
        E2E_TEST_MODE: 'true',
      },
    },
    {
      command: 'npm run dev -- --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 60000, // 60s for frontend
      retries: 3, // Retry health check 3 times
      env: {
        VITE_API_BASE_URL: '/api',
      },
    },
  ],
});
