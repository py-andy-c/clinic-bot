import { test, expect } from '@playwright/test';
import { createAuthHelper } from './helpers';

test.describe('Settings Save Flow', { tag: '@settings' }, () => {
  test.skip('save settings successfully', async ({ page }) => {
    // TODO: Implement when authentication is set up
    const auth = createAuthHelper(page);

    // Navigate to login
    await auth.gotoLogin();

    // Example flow (would be enabled with proper auth):
    // await auth.loginWithGoogle();
    // await page.goto('/admin/clinic/settings');
    // await page.waitForLoadState('networkidle');
    // await page.click('text=診所資訊');
    // await page.fill('[name="clinic_name"]', 'Test Clinic Updated');
    // await page.click('button:has-text("儲存")');
    // await expect(page.locator('text=設定已儲存')).toBeVisible();
    // await page.reload();
    // await expect(page.locator('[name="clinic_name"]')).toHaveValue('Test Clinic Updated');
  });

  test.skip('handle settings save error', async ({ page }) => {
    // TODO: Implement when authentication is set up
    // - Mock API error response for settings save
    // - Verify error message is displayed
  });
});
