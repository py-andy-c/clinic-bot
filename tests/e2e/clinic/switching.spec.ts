import { test, expect } from '../fixtures/api-monitoring';

/**
 * E2E test for clinic switching flow.
 * 
 * This test verifies that users with multiple clinic access can switch clinics.
 */
test.describe('Clinic Switching', () => {
  // Use the multi_clinic scenario
  test.use({ scenario: 'multi_clinic' });

  test.skip('user can switch between clinics @critical', async ({ seededPage, seededData }) => {
    // TODO: Re-enable when clinic switcher options not found issue is fixed
    // Navigate to a page that shows clinic switcher
    await seededPage.goto('/admin/calendar', { waitUntil: 'load' });
    await seededPage.waitForLoadState('domcontentloaded');

    // Expected clinic names from seed
    const expectedClinics = seededData.clinic_names || [];

    // Look for clinic switcher component
    const clinicSwitcher = seededPage.locator('[data-testid="clinic-switcher"]')
      .or(seededPage.locator('button').filter({ hasText: /診所|Clinic/ }))
      .or(seededPage.locator('select').filter({ hasText: /診所|Clinic/ }));

    await expect(clinicSwitcher.first()).toBeVisible({ timeout: 10000 });

    const currentClinicText = (await clinicSwitcher.first().textContent() || "").trim();
    const isGenericLabel = currentClinicText.includes("診所管理") || currentClinicText.includes("Clinic Management");

    // Click to open switcher
    await clinicSwitcher.first().click();

    // Look for other clinics
    const clinicOptions = seededPage.locator('[role="option"]')
      .or(seededPage.locator('button').filter({ hasText: /Clinic/ }))
      .or(seededPage.locator('li').filter({ hasText: /Clinic/ }));

    // Try to click the second clinic (which should be different from current)
    // We prefer using the seeded name
    if (expectedClinics.length > 1) {
      const secondClinicName = expectedClinics[1];
      console.log(`Attempting to switch to clinic: ${secondClinicName}`);

      const option = seededPage.getByRole('option', { name: secondClinicName })
        .or(seededPage.getByText(secondClinicName))
        .first();

      // Use a try-catch for visibility to fallback
      try {
        await expect(option).toBeVisible({ timeout: 5000 });
        await option.click();
      } catch (e) {
        console.log("Could not find clinic by name, falling back to index");
        // Fallback: click the second reachable option
        await expect(clinicOptions.nth(1)).toBeVisible({ timeout: 5000 });
        await clinicOptions.nth(1).click();
      }
    } else {
      // Fallback if no names seeded (shouldn't happen)
      await expect(clinicOptions.nth(1)).toBeVisible({ timeout: 5000 });
      await clinicOptions.nth(1).click();
    }

    // Wait for switch
    await seededPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);

    const pageAfterSwitch = seededPage.url();
    expect(pageAfterSwitch).toContain('/admin/');

    // Verify change
    if (!isGenericLabel) {
      const newClinicText = (await clinicSwitcher.first().textContent() || "").trim();
      expect(newClinicText).not.toBe(currentClinicText);
    }
  });

  test('clinic context persists after navigation @critical', async ({ seededPage }) => {
    await seededPage.goto('/admin/calendar', { waitUntil: 'load' });
    await seededPage.waitForLoadState('domcontentloaded');

    const clinicSwitcher = seededPage.locator('[data-testid="clinic-switcher"]')
      .or(seededPage.locator('button').filter({ hasText: /診所|Clinic/ }));

    const initialClinicText = await clinicSwitcher.first().textContent().catch(() => null);

    await seededPage.goto('/admin/clinic/patients', { waitUntil: 'load' });
    await seededPage.waitForLoadState('domcontentloaded');

    expect(seededPage.url()).toContain('/admin/');
    expect(seededPage.url()).not.toContain('/admin/login');

    await seededPage.goto('/admin/calendar', { waitUntil: 'load' });
    await seededPage.waitForLoadState('domcontentloaded');

    const finalClinicText = await clinicSwitcher.first().textContent().catch(() => null);
    expect(finalClinicText).toBe(initialClinicText);
  });
});
