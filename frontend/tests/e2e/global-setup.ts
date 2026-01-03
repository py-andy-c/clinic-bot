/// <reference types="node" />
import { type FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  // Setup code that runs before all tests
  // IMPORTANT: According to Playwright docs, globalSetup runs ONCE before all tests
  // 
  // NOTE: Port cleanup is now handled by npm pre-script (pretest:e2e)
  // The pre-script runs BEFORE Playwright initializes, preventing webServer hangs
  // when stuck processes are bound to ports but not responding to HTTP.
  const setupStartTime = new Date().toISOString();
  console.log(`[${setupStartTime}] [TEST] [GLOBAL-SETUP] ========== Global setup started ==========`);
  console.log(`[${setupStartTime}] [TEST] [GLOBAL-SETUP] NOTE: This runs ONCE before all tests (not between tests)`);
  console.log(`[${setupStartTime}] [TEST] [GLOBAL-SETUP] Port cleanup was handled by npm pre-script (pretest:e2e)`);

  // Get test database URL (default matches CI configuration)
  const dbUrl = process.env.E2E_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/test_db';
  const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':****@'); // Hide password in logs
  console.log(`[${new Date().toISOString()}] [TEST] [GLOBAL-SETUP] Using database: ${maskedUrl}`);

  // Note: Database creation is handled by the backend launch script via migrations
  // If the database doesn't exist, the backend will attempt to create it during migration
  // For manual setup, see docs/TESTING.md

  const setupEndTime = new Date().toISOString();
  console.log(`[${setupEndTime}] [TEST] [GLOBAL-SETUP] Global setup complete`);
}

export default globalSetup;