import { FullConfig } from '@playwright/test';

/**
 * Global setup hook that runs once before all tests.
 * 
 * This hook:
 * 1. Cleans up any stuck database connections from previous test runs
 * 2. Ensures a clean state for the test suite by truncating all business tables
 * 
 * Note: This runs after webServer has started, so the backend is available.
 */
async function globalSetup(config: FullConfig) {
  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8001';

  try {
    // Wait a bit for the server to be fully ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 1. Call cleanup endpoint to terminate stuck connections
    const cleanupResponse = await fetch(`${apiBaseUrl}/api/test/cleanup-connections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (cleanupResponse.ok) {
      const result = await cleanupResponse.json();
      console.log(`[Global Setup] Connection cleanup: ${result.message} (terminated ${result.terminated_connections} connections)`);
    } else {
      console.warn(`[Global Setup] Connection cleanup failed (non-fatal): ${cleanupResponse.status}`);
    }

    // 2. Reset database (truncate business tables)
    // This ensures every test run starts with a completely empty (but migrated) database
    const resetResponse = await fetch(`${apiBaseUrl}/api/test/reset-database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (resetResponse.ok) {
      const result = await resetResponse.json();
      console.log(`[Global Setup] Database reset: ${result.message}`);
    } else {
      const errorText = await resetResponse.text();
      console.error(`[Global Setup] Database reset FAILED: ${resetResponse.status} ${errorText}`);
      // If database reset fails, we might want to fail the whole suite
      // but choosing non-fatal for now to avoid blocking CI if there are minor issues
    }

  } catch (error) {
    console.warn(`[Global Setup] Error during setup (non-fatal): ${error}`);
  }
}

export default globalSetup;

