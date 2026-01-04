import { FullConfig } from '@playwright/test';

/**
 * Global setup hook that runs once before all tests.
 * 
 * This hook:
 * 1. Cleans up any stuck database connections from previous test runs
 * 2. Ensures a clean state for the test suite
 * 
 * Note: This runs after webServer has started, so the backend is available.
 */
async function globalSetup(config: FullConfig) {
  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8001';
  
  try {
    // Wait a bit for the server to be fully ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Call cleanup endpoint to terminate stuck connections
    const response = await fetch(`${apiBaseUrl}/api/test/cleanup-connections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`[Global Setup] Connection cleanup: ${result.message} (terminated ${result.terminated_connections} connections)`);
    } else {
      // Non-fatal: log but don't fail
      const errorText = await response.text();
      console.warn(`[Global Setup] Connection cleanup failed (non-fatal): ${response.status} ${errorText}`);
    }
  } catch (error) {
    // Non-fatal: log but don't fail the test suite
    console.warn(`[Global Setup] Could not cleanup connections (non-fatal): ${error}`);
  }
}

export default globalSetup;

