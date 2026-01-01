import { test, expect } from '@playwright/test';

test.describe('Playwright Setup Check', () => {
  test('playwright is working', async ({ page }) => {
    // Simple test that doesn't require any servers
    await page.goto('data:text/html,<h1>Playwright Works!</h1>');
    await expect(page.locator('h1')).toContainText('Playwright Works!');
    console.log('✅ Playwright is properly configured and working!');
  });
});
