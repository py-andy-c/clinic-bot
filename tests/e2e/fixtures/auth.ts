import { test as base, Page } from '@playwright/test';

// Cache authentication tokens to avoid repeated logins within the same worker
// Cache is per-worker to maintain test isolation across parallel workers
// Cache key includes email and roles to support different role combinations
let cachedAuthState: { accessToken: string; refreshToken: string; email: string; roles: string[] } | null = null;

/**
 * Authenticated page fixture that handles login via test-only endpoint.
 * 
 * Implements token caching for performance while maintaining test isolation.
 * Cache is per-worker (Playwright workers run tests in parallel).
 * 
 * Defaults to clinic_user with roles ['admin', 'practitioner'] for full access.
 * Email can be configured via E2E_TEST_EMAIL environment variable.
 * 
 * Future: When role-based testing is needed, we can extend this to support per-test roles:
 *   - Option 1: Use test.use() with a custom fixture option
 *   - Option 2: Create separate fixtures (authenticatedAdminPage, authenticatedPractitionerPage)
 *   - Option 3: Pass roles as a parameter to a helper function
 */
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page, request }, use, testInfo) => {
    // Use configurable email (default: 'test@example.com')
    const testEmail = process.env.E2E_TEST_EMAIL || 'test@example.com';
    
    // Default roles: ['admin', 'practitioner'] for full access
    // Future: Can be made configurable per-test when role-based testing is needed
    const roles = ['admin', 'practitioner'];
    
    // Get backend URL from environment or default to localhost:8001
    const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8001';
    
    // Create cache key from email and roles (sorted for consistency)
    const rolesKey = [...roles].sort().join(',');
    const cacheKey = `${testEmail}:${rolesKey}`;
    const cachedKey = cachedAuthState 
      ? `${cachedAuthState.email}:${[...cachedAuthState.roles].sort().join(',')}` 
      : null;
    
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
          user_type: 'clinic_user',
          roles: roles,
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
        roles: roles,
      };
    }
    
    // Set tokens in localStorage before navigating (frontend uses auth_access_token and auth_refresh_token)
    await page.goto('/');
    await page.evaluate(({ accessToken, refreshToken }) => {
      localStorage.setItem('auth_access_token', accessToken);
      localStorage.setItem('auth_refresh_token', refreshToken);
    }, { accessToken: access_token, refreshToken: refresh_token });
    
    // Reload page to trigger auth check with tokens in localStorage
    await page.reload();
    
    // Wait for page to load (use 'load' instead of 'networkidle' to avoid hanging on ongoing API calls)
    await page.waitForLoadState('load');
    
    // Wait a bit for auth to be processed (frontend makes async API calls)
    await page.waitForTimeout(1000);
    
    await use(page);
    
    // Note: We don't clear localStorage here to allow token reuse within the same worker
    // Each worker gets its own page context, so tests are still isolated
  },
});

export { expect } from '@playwright/test';


