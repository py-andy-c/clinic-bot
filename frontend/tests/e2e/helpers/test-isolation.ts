/**
 * Test isolation helpers
 * 
 * Provides utilities to ensure clean test state between test runs,
 * preventing state pollution when running tests in parallel.
 */

import { Page, BrowserContext } from '@playwright/test';

/**
 * Clear all browser state (cookies, localStorage, sessionStorage)
 * to ensure test isolation.
 * 
 * This should be called in test.beforeEach hooks to prevent
 * state pollution from previous tests when running in parallel.
 * 
 * @param page - Playwright page object
 * @param context - Playwright browser context
 */
export async function clearTestState(page: Page, context: BrowserContext): Promise<void> {
  // Clear all cookies (works without navigation)
  await context.clearCookies();
  
  // Clear storage if page is already loaded, otherwise it will be cleared on first navigation
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  } catch (e) {
    // Page might not be loaded yet, that's fine - storage will be cleared on first navigation
  }
}

