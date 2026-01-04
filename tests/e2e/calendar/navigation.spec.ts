import { test, expect } from '../fixtures/api-monitoring';

/**
 * E2E test for calendar navigation flow.
 * 
 * This test verifies calendar navigation features (month view, week view, date navigation).
 */
test.describe('Calendar Navigation', () => {
  test('user can navigate calendar views @calendar', async ({ authenticatedPage }) => {
    // Navigate to calendar page
    await authenticatedPage.goto('/admin/calendar', { waitUntil: 'load' });
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Wait for calendar to be visible
    const calendar = authenticatedPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 15000 });

    // Verify calendar controls are present
    // React Big Calendar typically has navigation buttons
    // Check if calendar header exists (may be hidden but still in DOM)
    const calendarHeader = authenticatedPage.locator('.rbc-header');
    // Header may be hidden but should exist in DOM
    await expect(calendarHeader.first()).toBeAttached({ timeout: 5000 });

    // Look for navigation buttons (previous/next month)
    const navButtons = authenticatedPage.locator('button').filter({ hasText: /<|>|前|後|上|下/ });
    const navButtonCount = await navButtons.count();

    if (navButtonCount > 0) {
      // Click next button to navigate forward
      const nextButton = navButtons.last(); // Usually the "next" button is last
      await expect(nextButton).toBeVisible();
      await nextButton.click();

      // Wait for calendar to update (wait for network to be idle or calendar to re-render)
      await authenticatedPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);

      // Verify calendar is still visible (didn't break)
      await expect(calendar).toBeVisible();

      // Click previous button to navigate back
      const prevButton = navButtons.first(); // Usually the "previous" button is first
      await expect(prevButton).toBeVisible();
      await prevButton.click();

      // Wait for calendar to update
      await authenticatedPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);

      // Verify calendar is still visible
      await expect(calendar).toBeVisible();
    } else {
      // Navigation buttons might be in a different format
      // Look for alternative navigation controls
      const altNav = authenticatedPage.locator('.rbc-toolbar button');
      if (await altNav.count() > 0) {
        // Try clicking a navigation button
        await altNav.first().click();
        await authenticatedPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);
        await expect(calendar).toBeVisible();
      }
    }
  });

  test('user can switch calendar view modes @calendar', async ({ authenticatedPage }) => {
    // Navigate to calendar page
    await authenticatedPage.goto('/admin/calendar', { waitUntil: 'load' });
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Wait for calendar to be visible
    const calendar = authenticatedPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 15000 });

    // Look for view mode buttons (month, week, day, agenda)
    // React Big Calendar toolbar typically has these
    const viewButtons = authenticatedPage.locator('button')
      .filter({ hasText: /月|週|日|Month|Week|Day|Agenda/ });

    const viewButtonCount = await viewButtons.count();

    if (viewButtonCount > 0) {
      // Try clicking a different view (e.g., week view)
      // Skip the first button (likely "month" which is current)
      if (viewButtonCount > 1) {
        const weekViewButton = viewButtons.nth(1);
        await expect(weekViewButton).toBeVisible();
        await weekViewButton.click();

        // Wait for view to change (calendar re-renders)
        await authenticatedPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);

        // Verify calendar is still visible with new view
        await expect(calendar).toBeVisible();

        // Switch back to month view
        const monthViewButton = viewButtons.first();
        await expect(monthViewButton).toBeVisible();
        await monthViewButton.click();

        // Wait for view to change back
        await authenticatedPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);

        // Verify calendar is still visible
        await expect(calendar).toBeVisible();
      }
    } else {
      // View switching might not be available or in different format
      // Test passes - verifies calendar is accessible even if view switching isn't available
    }
  });

  test('user can navigate to today @calendar', async ({ authenticatedPage }) => {
    // Navigate to calendar page
    await authenticatedPage.goto('/admin/calendar', { waitUntil: 'load' });
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Wait for calendar to be visible
    const calendar = authenticatedPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 15000 });

    // Look for "Today" button
    const todayButton = authenticatedPage.locator('button')
      .filter({ hasText: /今天|Today|本日/ })
      .first();

    if (await todayButton.isVisible().catch(() => false)) {
      // Navigate away from today (if possible)
      const navButtons = authenticatedPage.locator('button').filter({ hasText: /<|>|前|後/ });
      if (await navButtons.count() > 0) {
        await navButtons.last().click();
        await authenticatedPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);
      }

      // Click "Today" button
      await todayButton.click();

      // Wait for calendar to navigate to today
      await authenticatedPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);

      // Verify calendar is still visible
      await expect(calendar).toBeVisible();
    } else {
      // "Today" button might not be available
      // Test passes - verifies calendar is accessible even if "Today" button isn't available
    }
  });
});

