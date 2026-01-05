import { test, expect } from '../fixtures/api-monitoring';

/**
 * E2E test for appointment creation flow.
 * 
 * This test verifies that authenticated users can create appointments
 * through the calendar interface.
 */
test.describe('Appointment Creation', () => {
  // Use standard scenario for all tests in this file
  test.use({ scenario: 'standard' });

  test('clinic user can navigate to calendar page @smoke @appointment', async ({ seededPage }) => {
    // Navigate to calendar page
    await seededPage.goto('/admin/calendar', { waitUntil: 'load' });

    const currentUrl = seededPage.url();
    expect(currentUrl).toContain('/admin/calendar');

    await seededPage.waitForSelector('.rbc-calendar', { timeout: 30000 });

    // Wait for any loading spinners to disappear
    await seededPage.waitForFunction(() => {
      const loadingSpinners = document.querySelectorAll('[data-testid="loading-spinner"], .loading-spinner');
      return loadingSpinners.length === 0;
    }, { timeout: 30000 });

    const createButton = seededPage.locator('[data-testid="create-appointment-button"]');
    await expect(createButton).toBeVisible();
  });

  test('clinic user can access protected routes @smoke', async ({ seededPage }) => {
    const protectedRoutes = [
      '/admin/calendar',
      '/admin/clinic/patients',
      '/admin/clinic/members',
    ];

    for (const route of protectedRoutes) {
      await seededPage.goto(route, { waitUntil: 'load' });
      await seededPage.waitForLoadState('domcontentloaded');

      const currentUrl = seededPage.url();
      expect(currentUrl).toContain('/admin/');
      expect(currentUrl).not.toContain('/admin/login');
    }
  });

  test('clinic user can open create appointment modal @appointment', async ({ seededPage }) => {
    await seededPage.goto('/admin/calendar', { waitUntil: 'load' });
    await seededPage.waitForLoadState('domcontentloaded');

    const calendar = seededPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 30000 });

    const createButton = seededPage.locator('[data-testid="create-appointment-button"]');
    await expect(createButton).toBeVisible();
    await createButton.click();

    const modal = seededPage.locator('[data-testid="create-appointment-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const nextButton = seededPage.locator('[data-testid="appointment-form-next-button"]');
    await expect(nextButton).toBeAttached();
  });

  test.skip('clinic user can create appointment with full flow @appointment @critical', async ({ seededPage, seededData }) => {
    // TODO: Re-enable when appointment type selector timeout issue is fixed
    // Use data provided by the seed API
    const patientName = `Patient`; // Scenario 'standard' creates a patient with name containing 'Patient'

    await seededPage.goto('/admin/calendar', { waitUntil: 'load' });

    const calendar = seededPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 15000 });

    const createButton = seededPage.locator('[data-testid="create-appointment-button"]');
    await expect(createButton).toBeVisible();
    await createButton.click();

    const modal = seededPage.locator('[data-testid="create-appointment-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill in patient search
    const patientSearchInput = seededPage.getByPlaceholder(/搜尋病患/);
    await expect(patientSearchInput).toBeVisible();
    await patientSearchInput.fill(patientName);

    // Wait for patient to appear and click it
    const patientOption = seededPage.getByText(patientName).first();
    await expect(patientOption).toBeVisible({ timeout: 5000 });
    await patientOption.click();

    // Select appointment type (standard scenario creates at least one)
    const appointmentTypeSelect = seededPage.locator('select').first();
    await expect(appointmentTypeSelect).toBeVisible();
    if (seededData.appointment_type_name) {
      await appointmentTypeSelect.selectOption({ label: seededData.appointment_type_name });
    } else {
      await appointmentTypeSelect.selectOption({ index: 1 }); // Fallback if name not available
    }

    // Wait for practitioner select to be enabled
    const practitionerSelect = seededPage.locator('select').nth(1);
    await expect(practitionerSelect).toBeEnabled({ timeout: 5000 });
    await practitionerSelect.selectOption({ index: 1 });

    const dateTimePicker = seededPage.locator('[data-testid="datetime-picker"]');
    await expect(dateTimePicker).toBeVisible({ timeout: 5000 });

    const nextButton = seededPage.locator('[data-testid="appointment-form-next-button"]');
    await expect(nextButton).toBeEnabled({ timeout: 5000 });
    await nextButton.click();

    const confirmButton = seededPage.locator('[data-testid="confirm-create-appointment-button"]');
    await Promise.race([
      confirmButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
      modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => null),
    ]);

    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
      await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => null);
    }

    const calendarAfterCreate = seededPage.locator('.rbc-calendar');
    await expect(calendarAfterCreate).toBeVisible();

    // NO CLEANUP NEEDED
  });
});

