import { test, expect } from '@playwright/test';
import { createAuthHelper } from './helpers';

test.describe('Clinic Switching', { tag: '@clinic' }, () => {
  test.skip('switch between clinics', async ({ page }) => {
    // TODO: Implement when authentication is set up
    // - Navigate to calendar page
    // - Click clinic switcher and select different clinic
    // - Verify clinic switch and data refresh
  });

  test.skip('clinic switch preserves user preferences', async ({ page }) => {
    // TODO: Implement when authentication is set up
    // - Set up user preferences (selected practitioners, view settings)
    // - Switch between clinics and verify preferences are preserved
  });
});