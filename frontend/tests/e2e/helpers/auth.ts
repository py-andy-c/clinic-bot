import { Page } from '@playwright/test';

/**
 * Authentication helpers for E2E tests
 */

export class AuthHelper {
  constructor(private page: Page) {}

  /**
   * Navigate to login page
   */
  async gotoLogin() {
    await this.page.goto('/admin/login');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Check if user is logged in by checking for navigation to admin routes
   */
  async isLoggedIn(): Promise<boolean> {
    const currentUrl = this.page.url();
    return currentUrl.includes('/admin/') && !currentUrl.includes('/admin/login');
  }

  /**
   * Attempt login with Google OAuth
   * Note: This requires test Google account setup and may need adjustments
   * based on your OAuth configuration
   */
  async loginWithGoogle() {
    // Click Google login button
    await this.page.click('button:has-text("Google 登入")');

    // Wait for OAuth redirect or handle popup
    // This will need to be configured based on your OAuth setup
    await this.page.waitForURL('**/admin/**', { timeout: 30000 });

    // Verify we're logged in
    const isLoggedIn = await this.isLoggedIn();
    if (!isLoggedIn) {
      throw new Error('Login failed - not redirected to admin area');
    }
  }

  /**
   * Login using API token (if available for testing)
   * This would require a test endpoint that accepts tokens
   */
  async loginWithToken(token: string) {
    // Set auth token in localStorage or cookies
    await this.page.addInitScript((token) => {
      localStorage.setItem('auth_token', token);
      // You might also need to set other auth-related data
    }, token);

    // Navigate to admin area
    await this.page.goto('/admin/calendar');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Logout user
   */
  async logout() {
    // Click logout button or navigate to logout endpoint
    // This will depend on your app's logout implementation
    await this.page.goto('/admin/login');
  }

  /**
   * Wait for authentication to complete
   */
  async waitForAuth() {
    await this.page.waitForFunction(() => {
      // Check if auth context is available
      return window.location.pathname.includes('/admin/') &&
             !window.location.pathname.includes('/admin/login');
    }, { timeout: 30000 });
  }
}

/**
 * Create auth helper for a page
 */
export function createAuthHelper(page: Page): AuthHelper {
  return new AuthHelper(page);
}
