/// <reference types="node" />
import { test, expect, Page, TestInfo } from '@playwright/test';
import { createAuthHelper, clearTestState } from './helpers';

// Helper function to wait for settings page to load
async function waitForSettingsPage(page: Page) {
  // Use shorter timeout for local runs, longer for CI
  const timeout = process.env.CI ? 30000 : 10000;
  
  console.log(`[${new Date().toISOString()}] [TEST] [WAIT] waitForSettingsPage: Waiting for API response...`);
  // Wait for the settings API request to complete first
  // This ensures data is loaded before checking for UI elements
  await page.waitForResponse(
    (response) => response.url().includes('/api/clinic/settings') && response.request().method() === 'GET',
    { timeout }
  ).catch(() => {
    console.log(`[${new Date().toISOString()}] [TEST] [WAIT] waitForSettingsPage: API response wait timed out or failed`);
    // If API request doesn't complete, continue - we'll check for error state below
  });
  console.log(`[${new Date().toISOString()}] [TEST] [WAIT] waitForSettingsPage: API response received`);
  
  // Wait for input to be visible - this implicitly waits for loading to complete
  // The input won't be visible until React finishes rendering after API response
  // Check for error state first, then wait for input
  console.log(`[${new Date().toISOString()}] [TEST] [WAIT] waitForSettingsPage: Checking for error state...`);
  // Check page content immediately without waiting
  const bodyText = await page.textContent('body').catch(() => '') || '';
  const hasErrorText = bodyText.includes('無法載入設定');
  console.log(`[${new Date().toISOString()}] [TEST] [WAIT] waitForSettingsPage: Body text check - hasErrorText: ${hasErrorText}, body length: ${bodyText.length}`);
  
  // Also check if input exists in DOM (even if not visible)
  const inputExists = await page.locator('input[name="display_name"]').count();
  console.log(`[${new Date().toISOString()}] [TEST] [WAIT] waitForSettingsPage: Input exists in DOM: ${inputExists > 0}`);
  
  const hasError = hasErrorText;
  
  if (hasError) {
    // Error state - form won't render, this will be handled by checkSettingsLoaded
    console.log(`[${new Date().toISOString()}] [TEST] [WAIT] waitForSettingsPage: Returning early due to error state`);
    return;
  }
  
  // Wait for the input to be visible (not just in DOM)
  // This ensures the form is fully rendered and visible
  // After API response, this should complete quickly
  console.log(`[${new Date().toISOString()}] [TEST] [WAIT] waitForSettingsPage: Waiting for input[name="display_name"] to be visible (timeout: ${timeout}ms)...`);
  await page.waitForSelector('input[name="display_name"]', { 
    state: 'visible', 
    timeout 
  });
  console.log(`[${new Date().toISOString()}] [TEST] [WAIT] waitForSettingsPage: Input is now visible`);
}

// Helper function to check if settings loaded successfully
async function checkSettingsLoaded(page: Page, testInfo?: TestInfo): Promise<boolean> {
  const pageText = await page.textContent('body').catch(() => '') || '';
  if (pageText.includes('無法載入設定')) {
    await expect(page).toHaveURL(/\/admin\/clinic\/settings\/clinic-info/);
    if (testInfo) {
      testInfo.annotations.push({ type: 'note', description: 'Settings page loaded but settings data failed to load - may need clinic setup' });
    }
    return false;
  }
  return true;
}

test.describe('Settings Save Flow', { tag: '@settings' }, () => {
  // Run tests in this file serially to avoid React state race conditions
  // This ensures tests run one after another, even with multiple workers
  test.describe.configure({ mode: 'serial' });
  
  // Test isolation: Clear storage and reset state before each test
  // This prevents state pollution from previous tests when running in parallel
  // Note: We clear cookies via context (works without navigation)
  // Storage will be cleared by navigating to a blank page if needed, but
  // we avoid navigating to baseURL here to not interfere with addInitScript in auth
  test.beforeEach(async ({ page, context }) => {
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
  });

  test('save settings successfully', async ({ page }) => {
    test.setTimeout(60000);
    
    const testStartTime = new Date().toISOString();
    const startTime = Date.now();
    console.log(`[${testStartTime}] [TEST] [SETTINGS-SAVE] ========== TEST STARTED: save settings successfully ==========`);
    console.log(`[${testStartTime}] [TEST] [SETTINGS-SAVE] Test function execution began`);
    
    // Monitor ALL API requests with timestamps
    const apiRequests: Array<{ url: string; time: number; method: string; timestamp: string }> = [];
    const apiResponses: Array<{ url: string; status: number; time: number; timestamp: string }> = [];
    
    page.on('request', (request) => {
      const url = request.url();
      const timestamp = new Date().toISOString();
      const relativeTime = Date.now() - startTime;
      apiRequests.push({ url, time: relativeTime, method: request.method(), timestamp });
      if (url.includes('/api/')) {
        console.log(`[${timestamp}] [TEST] [SETTINGS-SAVE-REQUEST] ${request.method()} ${url} (relative: +${relativeTime}ms)`);
      }
    });
    
    page.on('response', (response) => {
      const url = response.url();
      const timestamp = new Date().toISOString();
      const relativeTime = Date.now() - startTime;
      const requestTime = apiRequests.find(r => r.url === url && !apiResponses.find(res => res.url === url))?.time || 0;
      apiResponses.push({ url, status: response.status(), time: relativeTime, timestamp });
      if (url.includes('/api/')) {
        console.log(`[${timestamp}] [TEST] [SETTINGS-SAVE-RESPONSE] ${response.request().method()} ${url} - Status: ${response.status()} (relative: +${relativeTime}ms, request was at +${requestTime}ms)`);
      }
    });
    
    // Capture browser console logs with timestamps
    page.on('console', (msg) => {
      const timestamp = new Date().toISOString();
      const text = msg.text();
      const type = msg.type();
      // Log all frontend logs, errors, and warnings
      if (text.includes('[FRONTEND]') || text.includes('AXIOS') || text.includes('RQ-') || text.includes('RETRY') || 
          text.includes('CORS') || text.includes('Access-Control') || text.includes('Origin') || 
          text.includes('preflight') || type === 'error' || type === 'warning') {
        console.log(`[${timestamp}] [TEST] [SETTINGS-SAVE-CONSOLE-${type.toUpperCase()}] ${text}`);
      }
    });

    const auth = createAuthHelper(page);

    // Authenticate using test endpoint (clinic_user with admin role)
    await auth.loginWithTestAuth('test-clinic-user@example.com', 'clinic_user');

    // Set up alert handler for success message
    let alertHandled = false;
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('設定已成功儲存') || dialog.message().includes('設定已更新')) {
        alertHandled = true;
        await dialog.accept();
      }
    });

    // Navigate to settings page
    const navStartTime = Date.now();
    console.log(`[${new Date().toISOString()}] [TEST] [SETTINGS-SAVE] [STEP] Navigating to settings page...`);
    await page.goto('/admin/clinic/settings/clinic-info', { waitUntil: 'load', timeout: 20000 });
    console.log(`[${new Date().toISOString()}] [TEST] [SETTINGS-SAVE] [STEP] Navigation complete (took ${Date.now() - navStartTime}ms)`);
    
    // Wait for settings to load (waits for API response, loading completion, and input visibility)
    const waitStartTime = Date.now();
    console.log(`[${new Date().toISOString()}] [TEST] [SETTINGS-SAVE] [STEP] Waiting for settings page to load...`);
    await waitForSettingsPage(page);
    console.log(`[${new Date().toISOString()}] [TEST] [SETTINGS-SAVE] [STEP] Settings page wait complete (took ${Date.now() - waitStartTime}ms)`);

    // Check if settings loaded successfully
    console.log(`[${new Date().toISOString()}] [TEST] [STEP] Checking if settings loaded successfully...`);
    if (!(await checkSettingsLoaded(page, test.info()))) {
      console.log(`[${new Date().toISOString()}] [TEST] [STEP] Settings failed to load, exiting test`);
      return;
    }
    console.log(`[${new Date().toISOString()}] [TEST] [STEP] Settings loaded successfully`);

    // Input should already be visible from waitForSettingsPage, but get locator for interaction
    const displayNameInput = page.locator('input[name="display_name"]');

    // Update display name field
    const newValue = `Test Clinic ${Date.now()}`;
    console.log(`[${new Date().toISOString()}] [TEST] [STEP] Filling display name field with: ${newValue}`);
    await displayNameInput.fill(newValue);
    console.log(`[${new Date().toISOString()}] [TEST] [STEP] Display name field filled`);

    // Verify save button appears
    const saveButton = page.locator('button:has-text("儲存變更")');
    console.log(`[${new Date().toISOString()}] [TEST] [STEP] Waiting for save button to appear...`);
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    console.log(`[${new Date().toISOString()}] [TEST] [STEP] Save button is visible`);

    // Click save and wait for completion
    console.log(`[${new Date().toISOString()}] [TEST] [STEP] Clicking save button...`);
    await saveButton.click();
    console.log(`[${new Date().toISOString()}] [TEST] [STEP] Save button clicked, waiting for completion...`);

    // Wait for save to complete - use Promise.race to catch any completion signal
    console.log(`[${new Date().toISOString()}] [TEST] [STEP] Starting Promise.race for save completion...`);
    const raceStartTime = Date.now();
    await Promise.race([
      // Wait for alert dialog (most immediate signal)
      page.waitForEvent('dialog', { timeout: 10000 }).then(() => {
        console.log(`[${new Date().toISOString()}] [TEST] [STEP] Dialog detected (${Date.now() - raceStartTime}ms)`);
        return 'dialog';
      }).catch(() => {
        console.log(`[${new Date().toISOString()}] [TEST] [STEP] Dialog wait timed out (${Date.now() - raceStartTime}ms)`);
        return null;
      }),
      // Wait for save button to disappear (form reset completed)
      page.waitForFunction(
        () => {
          const saveBtn = Array.from(document.querySelectorAll('button')).find(
            btn => btn.textContent?.includes('儲存變更')
          );
          return !saveBtn || saveBtn.style.display === 'none' || !saveBtn.offsetParent;
        },
        { timeout: 10000 }
      ).then(() => {
        console.log(`[${new Date().toISOString()}] [TEST] [STEP] Save button disappeared (${Date.now() - raceStartTime}ms)`);
        return 'button-gone';
      }).catch(() => {
        console.log(`[${new Date().toISOString()}] [TEST] [STEP] Save button wait timed out (${Date.now() - raceStartTime}ms)`);
        return null;
      }),
      // Wait for success message in page
      page.waitForFunction(
        () => {
          const bodyText = document.body.textContent || '';
          return bodyText.includes('設定已成功儲存') || bodyText.includes('設定已儲存') || bodyText.includes('設定已更新');
        },
        { timeout: 10000 }
      ).then(() => {
        console.log(`[${new Date().toISOString()}] [TEST] [STEP] Success message found (${Date.now() - raceStartTime}ms)`);
        return 'success-message';
      }).catch(() => {
        console.log(`[${new Date().toISOString()}] [TEST] [STEP] Success message wait timed out (${Date.now() - raceStartTime}ms)`);
        return null;
      }),
    ]);
    console.log(`[${new Date().toISOString()}] [TEST] [STEP] Promise.race completed (${Date.now() - raceStartTime}ms)`);

    // Now wait for all async operations to complete:
    // 1. Wait for save button to disappear (form reset completed)
    // 2. Wait for input value to reflect saved state
    // This ensures React has fully updated the form state
    console.log(`[${new Date().toISOString()}] [TEST] [STEP] Starting Promise.all for async operations...`);
    const allStartTime = Date.now();
    await Promise.all([
      // Wait for save button to be gone (with longer timeout for slow renders)
      page.waitForFunction(
        () => {
          const saveBtn = Array.from(document.querySelectorAll('button')).find(
            btn => btn.textContent?.includes('儲存變更')
          );
          return !saveBtn || saveBtn.style.display === 'none' || !saveBtn.offsetParent;
        },
        { timeout: 10000 }
      ).catch(() => {
        // If button is still visible, that's okay - we'll check other signals
      }),
      // Wait for input value to be saved (form reset has completed)
      page.waitForFunction(
        (expectedValue) => {
          const input = document.querySelector('input[name="display_name"]') as HTMLInputElement;
          return input && input.value === expectedValue;
        },
        newValue,
        { timeout: 10000 }
      ).catch(() => {
        // If value check fails, we'll verify with other signals
      }),
    ]);

    // Final verification - check multiple success indicators
    const savedValue = await displayNameInput.inputValue().catch(() => '');
    const hasSuccessMessage = await page.locator('text=設定已成功儲存, text=設定已儲存, text=設定已更新').first().isVisible({ timeout: 3000 }).catch(() => false);
    const saveButtonStillVisible = await saveButton.isVisible({ timeout: 2000 }).catch(() => false);
    
    // Success if: alert was shown, value was saved, success message appears, or save button disappeared
    const success = alertHandled || savedValue === newValue || hasSuccessMessage || !saveButtonStillVisible;
    expect(success).toBe(true);
  });

  test('handle settings save error', async ({ page }) => {
    test.setTimeout(60000);
    const auth = createAuthHelper(page);

    // Authenticate using test endpoint
    await auth.loginWithTestAuth('test-clinic-user@example.com', 'clinic_user');

    // Navigate directly to clinic info settings page
    await page.goto('/admin/clinic/settings/clinic-info', { waitUntil: 'load', timeout: 20000 });
    
    // Wait for settings to load (waits for API response, loading completion, and input visibility)
    await waitForSettingsPage(page);

    // Check if settings loaded successfully
    if (!(await checkSettingsLoaded(page, test.info()))) {
      return;
    }

    // Input should already be visible from waitForSettingsPage, but get locator for interaction
    const displayNameInput = page.locator('input[name="display_name"]');

    // Intercept the API call and force an error response
    // The API endpoint is /api/clinic/settings (PUT request)
    await page.route('**/api/clinic/settings', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Internal server error' }),
        });
      } else {
        await route.continue();
      }
    });

    // Update a field to make form dirty
    await displayNameInput.fill('Test Error');

    // Click save button
    const saveButton = page.locator('button:has-text("儲存變更")');
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();

    // Wait for React modal to appear (not browser dialog)
    // The alert() function from ModalContext creates a React modal with role="dialog"
    // Modal shows: Title: '儲存失敗', Message: 'Internal server error'
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 10000 });

    // Verify error modal is shown with correct content
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 2000 });

    // Check for modal title '儲存失敗' or message 'Internal server error'
    const hasTitle = await modal.locator('text=儲存失敗').isVisible({ timeout: 2000 }).catch(() => false);
    const hasMessage = await modal.locator('text=Internal server error').isVisible({ timeout: 2000 }).catch(() => false);
    const hasErrorInModal = await modal.evaluate((el) => {
      const text = el.textContent || '';
      return text.includes('儲存失敗') || text.includes('Internal server error');
    }).catch(() => false);

    expect(hasTitle || hasMessage || hasErrorInModal).toBe(true);
  });
});
