import { test, expect } from '../fixtures/api-monitoring';

/**
 * E2E test for calendar navigation flow.
 * 
 * This test verifies calendar navigation features (month view, week view, date navigation).
 */
test.describe('Calendar Navigation', () => {
  // Use minimal scenario for calendar navigation
  test.use({ scenario: 'minimal' });

  test('user can navigate calendar views @calendar', async ({ seededPage }) => {
    await seededPage.goto('/admin/calendar', { waitUntil: 'load' });
    await seededPage.waitForLoadState('domcontentloaded');

    const calendar = seededPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 15000 });

    const calendarHeader = seededPage.locator('.rbc-header');
    await expect(calendarHeader.first()).toBeAttached({ timeout: 5000 });

    const navButtons = seededPage.locator('button').filter({ hasText: /<|>|前|後|上|下/ });
    const navButtonCount = await navButtons.count();

    if (navButtonCount > 0) {
      const nextButton = navButtons.last();
      await expect(nextButton).toBeVisible();
      await nextButton.click();
      await seededPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);
      await expect(calendar).toBeVisible();

      const prevButton = navButtons.first();
      await expect(prevButton).toBeVisible();
      await prevButton.click();
      await seededPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);
      await expect(calendar).toBeVisible();
    }
  });

  test('user can switch calendar view modes @calendar', async ({ seededPage }) => {
    await seededPage.goto('/admin/calendar', { waitUntil: 'load' });
    await seededPage.waitForLoadState('domcontentloaded');

    await seededPage.waitForSelector('.rbc-calendar', { timeout: 30000 });

    await seededPage.waitForFunction(() => {
      const loadingSpinners = document.querySelectorAll('[data-testid="loading-spinner"], .loading-spinner');
      return loadingSpinners.length === 0;
    }, { timeout: 30000 });

    const calendar = seededPage.locator('.rbc-calendar');
    const viewButtons = seededPage.locator('button')
      .filter({ hasText: /月|週|日|Month|Week|Day|Agenda/ });

    const viewButtonCount = await viewButtons.count();

    if (viewButtonCount > 1) {
      const weekViewButton = viewButtons.nth(1);
      await expect(weekViewButton).toBeVisible();
      await weekViewButton.click();
      await seededPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);
      await expect(calendar).toBeVisible();

      const monthViewButton = viewButtons.first();
      await expect(monthViewButton).toBeVisible();
      await monthViewButton.click();
      await seededPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);
      await expect(calendar).toBeVisible();
    }
  });

  test('user can navigate to today @calendar', async ({ seededPage }) => {
    await seededPage.goto('/admin/calendar', { waitUntil: 'load' });
    await seededPage.waitForLoadState('domcontentloaded');

    await seededPage.waitForSelector('.rbc-calendar', { timeout: 30000 });

    await seededPage.waitForFunction(() => {
      const loadingSpinners = document.querySelectorAll('[data-testid="loading-spinner"], .loading-spinner');
      return loadingSpinners.length === 0;
    }, { timeout: 30000 });

    const calendar = seededPage.locator('.rbc-calendar');
    const todayButton = seededPage.locator('button')
      .filter({ hasText: /今天|Today|本日/ })
      .first();

    if (await todayButton.isVisible().catch(() => false)) {
      const navButtons = seededPage.locator('button').filter({ hasText: /<|>|前|後/ });
      if (await navButtons.count() > 0) {
        await navButtons.last().click();
        await seededPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);
      }

      await todayButton.click();
      await seededPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);
      await expect(calendar).toBeVisible();
    }
  });
});

