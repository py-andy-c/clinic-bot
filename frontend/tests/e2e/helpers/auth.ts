import { Page, expect } from '@playwright/test';

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
   * Login using test authentication endpoint
   * This bypasses OAuth and uses the test login endpoint
   * 
   * @param email - Email address for the test user
   * @param userType - Type of user: 'system_admin' or 'clinic_user' (default: 'clinic_user')
   */
  async loginWithTestAuth(email: string = 'test@example.com', userType: 'system_admin' | 'clinic_user' = 'clinic_user') {
    // Get the backend API URL
    // In E2E tests, backend runs on port 8000, frontend on port 3000
    // Use the baseURL from Playwright config or default to localhost:3000
    // Backend port can be overridden via E2E_BACKEND_PORT env var (default: 8000)
    const baseURL = this.page.context().baseURL || 'http://localhost:3000';
    const baseUrlObj = new URL(baseURL);
    const backendPort = process.env.E2E_BACKEND_PORT || '8000';
    const backendUrl = `${baseUrlObj.protocol}//${baseUrlObj.hostname}:${backendPort}`;
    const apiBaseURL = `${backendUrl}/api`;
    
    // Call the test login endpoint
    const response = await this.page.request.post(`${apiBaseURL}/auth/test/login`, {
      data: {
        email,
        user_type: userType,
      },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(`Test login failed: ${response.status()} ${errorText}`);
    }

    const authData = await response.json();

    // ROOT CAUSE FIX: Set tokens BEFORE any navigation using addInitScript
    // 
    // Race condition: If we navigate first, React's useAuth hook runs checkAuthStatus()
    // which checks localStorage for tokens. If tokens aren't there yet, it sets
    // isAuthenticated=false, causing AdminRoutes to redirect to /admin/login before
    // checkAuthStatus() completes.
    //
    // Solution: Use addInitScript to set tokens BEFORE any page loads, ensuring
    // tokens are in localStorage when React first checks auth.
    await this.page.addInitScript(
      ({ accessToken, refreshToken }) => {
        localStorage.setItem('auth_access_token', accessToken);
        localStorage.setItem('auth_refresh_token', refreshToken);
      },
      {
        accessToken: authData.access_token,
        refreshToken: authData.refresh_token,
      }
    );

    // Navigate to admin area to trigger auth initialization
    // Timeout: 20000ms - reduced from 45s, should be sufficient for most cases
    await this.page.goto('/admin', { waitUntil: 'load', timeout: 20000 });
    
    // Wait for auth state to stabilize - wait until we're not on login page
    // This handles the async checkAuthStatus() that runs after page load
    // Timeout: 8000ms - reduced from 20s, auth check is usually fast
    await this.page.waitForFunction(
      () => {
        const url = window.location.href;
        return url && !url.includes('/admin/login');
      },
      { timeout: 8000 }
    );
    
    // Verify we're authenticated (not on login page)
    // Timeout: 5000ms - reduced from 10s, should be quick if auth succeeded
    await expect(this.page).not.toHaveURL(/\/admin\/login/, { timeout: 5000 });
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
      localStorage.setItem('auth_access_token', token);
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
    // Clear auth tokens from localStorage
    await this.page.evaluate(() => {
      localStorage.removeItem('auth_access_token');
      localStorage.removeItem('auth_refresh_token');
    });

    // Navigate to login page
    await this.page.goto('/admin/login');
    await this.page.waitForLoadState('networkidle');
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
