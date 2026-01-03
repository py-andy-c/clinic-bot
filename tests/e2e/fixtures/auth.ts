import { test as base, Page } from '@playwright/test';

// Cache authentication tokens to avoid repeated logins within the same worker
// Cache is per-worker to maintain test isolation across parallel workers
let cachedAuthState: { accessToken: string; refreshToken: string; email: string; userType: string } | null = null;

/**
 * Authenticated page fixture that handles login via test-only endpoint.
 * 
 * Implements token caching for performance while maintaining test isolation.
 * Cache is per-worker (Playwright workers run tests in parallel).
 * Email and user type can be configured via environment variables:
 * - E2E_TEST_EMAIL (default: 'test@example.com')
 * - E2E_TEST_USER_TYPE (default: 'system_admin')
 */
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page, request }, use, testInfo) => {
    // Use configurable email and user type for flexibility
    const testEmail = process.env.E2E_TEST_EMAIL || 'test@example.com';
    const userType = process.env.E2E_TEST_USER_TYPE || 'system_admin';
    
    // Get backend URL from environment or default to localhost:8001
    const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8001';
    
    // Check if we have cached tokens for this email/userType combination
    // Cache is per-worker, so tests in the same worker can reuse tokens
    const cacheKey = `${testEmail}:${userType}`;
    const cachedKey = cachedAuthState ? `${cachedAuthState.email}:${cachedAuthState.userType}` : null;
    
    let access_token: string;
    let refresh_token: string;
    
    if (cachedAuthState && cachedKey === cacheKey) {
      // Use cached tokens
      access_token = cachedAuthState.accessToken;
      refresh_token = cachedAuthState.refreshToken;
    } else {
      // Authenticate via test-only endpoint
      const response = await request.post(`${apiBaseUrl}/api/test/login`, {
        data: {
          email: testEmail,
          user_type: userType,
        },
      });
      
      if (!response.ok()) {
        const errorText = await response.text();
        throw new Error(`Test login failed: ${response.status()} ${errorText}`);
      }
      
      const authData = await response.json();
      access_token = authData.access_token;
      refresh_token = authData.refresh_token;
      
      // Cache tokens for reuse within this worker
      cachedAuthState = {
        accessToken: access_token,
        refreshToken: refresh_token,
        email: testEmail,
        userType: userType,
      };
    }
    
    // Set tokens in localStorage (frontend uses auth_access_token and auth_refresh_token)
    await page.goto('/');
    await page.evaluate(({ accessToken, refreshToken }) => {
      localStorage.setItem('auth_access_token', accessToken);
      localStorage.setItem('auth_refresh_token', refreshToken);
    }, { accessToken: access_token, refreshToken: refresh_token });
    
    // Wait for page to load and auth to be processed
    await page.waitForLoadState('networkidle');
    
    await use(page);
    
    // Note: We don't clear localStorage here to allow token reuse within the same worker
    // Each worker gets its own page context, so tests are still isolated
  },
});

export { expect } from '@playwright/test';

