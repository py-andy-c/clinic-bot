import { test as base } from '@playwright/test';

// Cache authentication tokens to avoid repeated logins
let cachedAuthState: { [key: string]: { cookies: any[], storageState: any } } = {};

export const test = base.extend({
  authenticatedPage: async ({ page, request }, use, testInfo) => {
    const email = 'test@example.com'; // Use consistent test email

    // Use cached auth state if available
    if (cachedAuthState[email]) {
      await page.context().addCookies(cachedAuthState[email].cookies);
      await use(page);
      return;
    }

    // Authenticate using test endpoint
    const response = await request.post('http://localhost:8001/api/test/auth/login', {
      data: { email },
    });

    if (!response.ok()) {
      throw new Error(`Auth failed: ${response.status()} ${response.statusText()}`);
    }

    const { access_token, refresh_token } = await response.json();

    // Set tokens in localStorage (matching frontend auth storage keys)
    await page.goto('/');
    await page.evaluate(({ access_token, refresh_token }) => {
      localStorage.setItem('auth_access_token', access_token);
      localStorage.setItem('auth_refresh_token', refresh_token);
    }, { access_token, refresh_token });

    // Navigate to calendar page (authenticated route)
    await page.goto('/admin/calendar');
    await page.waitForLoadState('networkidle');

    // Cache auth state for future tests
    const cookies = await page.context().cookies();
    cachedAuthState[email] = { cookies, storageState: null };

    await use(page);
  },
});