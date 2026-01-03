import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load E2E environment variables
dotenv.config({ path: '.env.e2e' });

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined, // Auto-detect locally
  reporter: [
    ['html'],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
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
      // Note: Uses backend/src because main.py is in backend/src/ (matches launch_dev.sh pattern)
      command: 'cd backend/src && source ../venv/bin/activate && python -m uvicorn main:app --port 8001 --host 0.0.0.0',
      url: 'http://localhost:8001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000, // 120s for backend (includes migrations)
      retries: 3, // Retry health check 3 times with exponential backoff
      env: {
        DATABASE_URL: process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@localhost/clinic_bot_e2e',
        E2E_TEST_MODE: 'true',
        JWT_SECRET_KEY: process.env.JWT_SECRET_KEY || 'test-jwt-secret-key-for-e2e-tests-only',
        SYSTEM_ADMIN_EMAILS: process.env.SYSTEM_ADMIN_EMAILS || 'test@example.com',
        FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5174',
        API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:8001',
      },
    },
    {
      command: 'cd frontend && npm run dev -- --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 60000, // 60s for frontend
      retries: 3, // Retry health check 3 times
      env: {
        VITE_API_BASE_URL: 'http://localhost:8001/api',
      },
    },
  ],
});

