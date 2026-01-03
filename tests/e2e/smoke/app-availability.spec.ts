import { test, expect } from '@playwright/test';

/**
 * Smoke test to verify the application is available and basic functionality works.
 * This is a minimal test to verify the E2E test infrastructure is set up correctly.
 */
test.describe('Application Availability', () => {
  test('frontend is accessible @smoke', async ({ page }) => {
    // Navigate to the frontend
    await page.goto('/');
    
    // Wait for the page to load (check for any visible content)
    // This is a basic smoke test - we're just verifying the app loads
    await expect(page).toHaveURL(/.*/);
    
    // Basic check that the page has loaded (has a body element)
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('backend health endpoint is accessible @smoke', async ({ request }) => {
    // Check backend health endpoint
    const response = await request.get('http://localhost:8001/health');
    
    expect(response.status()).toBe(200);
    
    const body = await response.json();
    expect(body).toHaveProperty('status');
    // Health endpoint returns "healthy" or "running" - both are valid
    expect(['healthy', 'running']).toContain(body.status);
  });
});

