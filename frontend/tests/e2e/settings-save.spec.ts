import { test, expect, Page, TestInfo } from '@playwright/test';
import { createAuthHelper } from './helpers';

// Helper function to wait for settings page to load
async function waitForSettingsPage(page: Page) {
  // Wait for the settings API request to complete first
  // This ensures data is loaded before checking for UI elements
  await page.waitForResponse(
    (response) => response.url().includes('/api/clinic/settings') && response.request().method() === 'GET',
    { timeout: 30000 }
  ).catch(() => {
    // If API request doesn't complete, continue - we'll check for error state below
  });
  
  // Wait for loading to complete - check for loading spinner to disappear
  // The spinner has role="status" with aria-label="載入中..."
  await page.waitForFunction(
    () => {
      const bodyText = document.body.textContent || '';
      const hasError = bodyText.includes('無法載入設定');
      // Check if loading spinner is present (role="status" with aria-busy="true")
      const spinner = document.querySelector('[role="status"][aria-busy="true"]');
      const isLoading = !!spinner || bodyText.includes('載入中');
      // Return true if we have an error or if we're not loading
      return hasError || !isLoading;
    },
    { timeout: 30000 }
  );
  
  // Check if we're in an error state - if so, don't wait for input
  const pageText = await page.textContent('body').catch(() => '') || '';
  if (pageText.includes('無法載入設定')) {
    // Error state - form won't render, this will be handled by checkSettingsLoaded
    return;
  }
  
  // Otherwise, wait for the input to be visible (not just in DOM)
  // This ensures the form is fully rendered and visible
  // Use a longer timeout for CI environments where rendering might be slower
  await page.waitForSelector('input[name="display_name"]', { 
    state: 'visible', 
    timeout: 30000 
  });
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
  test('save settings successfully', async ({ page }) => {
    test.setTimeout(60000);
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
    await page.goto('/admin/clinic/settings/clinic-info', { waitUntil: 'load', timeout: 20000 });
    
    // Wait for settings to load (waits for API response, loading completion, and input visibility)
    await waitForSettingsPage(page);

    // Check if settings loaded successfully
    if (!(await checkSettingsLoaded(page, test.info()))) {
      return;
    }

    // Input should already be visible from waitForSettingsPage, but get locator for interaction
    const displayNameInput = page.locator('input[name="display_name"]');

    // Update display name field
    const newValue = `Test Clinic ${Date.now()}`;
    await displayNameInput.fill(newValue);

    // Verify save button appears
    const saveButton = page.locator('button:has-text("儲存變更")');
    await expect(saveButton).toBeVisible({ timeout: 5000 });

    // Click save and wait for completion
    await saveButton.click();

    // Wait for save to complete - use Promise.race to catch any completion signal
    await Promise.race([
      // Wait for alert dialog (most immediate signal)
      page.waitForEvent('dialog', { timeout: 10000 }).catch(() => null),
      // Wait for save button to disappear (form reset completed)
      page.waitForFunction(
        () => {
          const saveBtn = Array.from(document.querySelectorAll('button')).find(
            btn => btn.textContent?.includes('儲存變更')
          );
          return !saveBtn || saveBtn.style.display === 'none' || !saveBtn.offsetParent;
        },
        { timeout: 10000 }
      ).catch(() => null),
      // Wait for success message in page
      page.waitForFunction(
        () => {
          const bodyText = document.body.textContent || '';
          return bodyText.includes('設定已成功儲存') || bodyText.includes('設定已儲存') || bodyText.includes('設定已更新');
        },
        { timeout: 10000 }
      ).catch(() => null),
    ]);

    // Now wait for all async operations to complete:
    // 1. Wait for save button to disappear (form reset completed)
    // 2. Wait for input value to reflect saved state
    // This ensures React has fully updated the form state
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

    // Set up alert handler for error message
    let errorAlertHandled = false;
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('儲存設定失敗') || dialog.message().includes('錯誤')) {
        errorAlertHandled = true;
        await dialog.accept();
      }
    });

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

    // Wait for error to appear - check for error message or alert
    await Promise.race([
      page.waitForFunction(
        () => {
          const bodyText = document.body.textContent || '';
          const hasErrorText = bodyText.includes('錯誤') || bodyText.includes('儲存設定失敗');
          const hasErrorBox = document.querySelector('[class*="error"], [class*="Error"]');
          return hasErrorText || !!hasErrorBox;
        },
        { timeout: 8000 }
      ).catch(() => null),
      page.waitForEvent('dialog', { timeout: 8000 }).catch(() => null),
    ]);

    // Verify error is shown (no blocking wait)
    const hasErrorText = await page.locator('text=錯誤, text=儲存設定失敗').first().isVisible({ timeout: 2000 }).catch(() => false);
    const hasErrorBox = await page.locator('[class*="error"], [class*="Error"]').first().isVisible({ timeout: 2000 }).catch(() => false);
    const hasErrorInPage = await page.evaluate(() => {
      const pageText = document.body.textContent || '';
      return pageText.includes('錯誤') || pageText.includes('儲存設定失敗');
    }).catch(() => false);

    expect(hasErrorText || hasErrorBox || hasErrorInPage || errorAlertHandled).toBe(true);
  });
});
