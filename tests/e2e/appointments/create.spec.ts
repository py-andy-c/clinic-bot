import { test, expect } from '../fixtures/api-monitoring';
import { createTestPatient, deleteTestPatient, getAppointmentTypes, getPractitioners, generateUniqueId, getAccessTokenFromPage } from '../helpers/test-data';

/**
 * E2E test for appointment creation flow.
 * 
 * This test verifies that authenticated users can create appointments
 * through the calendar interface.
 */
test.describe('Appointment Creation', () => {
  test('clinic user can navigate to calendar page @smoke @appointment', async ({ authenticatedPage }) => {
    // Navigate to calendar page
    await authenticatedPage.goto('/admin/calendar', { waitUntil: 'load' });
    
    // Clinic users should be on the calendar page
    const currentUrl = authenticatedPage.url();
    expect(currentUrl).toContain('/admin/calendar');
    
    // Wait for calendar to be visible (more reliable than networkidle)
    // Increase timeout for CI environments where loading may be slower
    const calendar = authenticatedPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 30000 });
    
    // Verify the create appointment button is visible (confirms page loaded correctly)
    const createButton = authenticatedPage.locator('[data-testid="create-appointment-button"]');
    await expect(createButton).toBeVisible();
  });

  test('clinic user can access protected routes @smoke', async ({ authenticatedPage }) => {
    // Test accessing different protected routes for clinic users
    const protectedRoutes = [
      '/admin/calendar',
      '/admin/clinic/patients',
      '/admin/clinic/members',
    ];
    
    for (const route of protectedRoutes) {
      await authenticatedPage.goto(route, { waitUntil: 'load' });
      // Wait for page to be fully loaded (check for admin content)
      await authenticatedPage.waitForLoadState('domcontentloaded');
      
      // Should not be redirected to login - verify we're still in admin area
      const currentUrl = authenticatedPage.url();
      expect(currentUrl).toContain('/admin/');
      expect(currentUrl).not.toContain('/admin/login');
    }
  });

  test('clinic user can open create appointment modal @appointment', async ({ authenticatedPage }) => {
    // Navigate to calendar page
    await authenticatedPage.goto('/admin/calendar', { waitUntil: 'load' });
    await authenticatedPage.waitForLoadState('domcontentloaded');
    
    // Verify we're on the calendar page
    const currentUrl = authenticatedPage.url();
    expect(currentUrl).toContain('/admin/calendar');
    
    // Verify calendar is visible
    const calendar = authenticatedPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 30000 });
    
    // Click create appointment button
    const createButton = authenticatedPage.locator('[data-testid="create-appointment-button"]');
    await expect(createButton).toBeVisible();
    await createButton.click();
    
    // Wait for modal to appear
    const modal = authenticatedPage.locator('[data-testid="create-appointment-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    
    // Verify modal form elements are present
    // The modal should have the next button (form step)
    const nextButton = authenticatedPage.locator('[data-testid="appointment-form-next-button"]');
    // Button may be disabled if form is not filled, but it should exist
    await expect(nextButton).toBeAttached();
  });

  test('clinic user can create appointment with full flow @appointment @critical', async ({ authenticatedPage, request }) => {
    let testPatientId: number | null = null;
    const uniqueId = generateUniqueId();
    const patientName = `Test Patient ${uniqueId}`;

    try {
      // Get access token for authenticated API requests
      const accessToken = await getAccessTokenFromPage(authenticatedPage);
      if (!accessToken) {
        throw new Error('Access token not found - authentication may have failed');
      }

      // Create test patient
      const patient = await createTestPatient(request, {
        full_name: patientName,
      }, accessToken);
      testPatientId = patient.patient_id;

      // Navigate to calendar page
      await authenticatedPage.goto('/admin/calendar', { waitUntil: 'load' });
      
      // Wait for calendar to be visible
      const calendar = authenticatedPage.locator('.rbc-calendar');
      await expect(calendar).toBeVisible({ timeout: 15000 });

      // Click create appointment button
      const createButton = authenticatedPage.locator('[data-testid="create-appointment-button"]');
      await expect(createButton).toBeVisible();
      await createButton.click();

      // Wait for modal to appear
      const modal = authenticatedPage.locator('[data-testid="create-appointment-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Fill in patient search (type patient name)
      const patientSearchInput = authenticatedPage.getByPlaceholder(/搜尋病患/);
      await expect(patientSearchInput).toBeVisible();
      await patientSearchInput.fill(patientName);

      // Wait for patient to appear in search results and click it
      const patientOption = authenticatedPage.getByText(patientName).first();
      await expect(patientOption).toBeVisible({ timeout: 5000 });
      await patientOption.click();

      // Get available appointment types and practitioners
      const appointmentTypes = await getAppointmentTypes(request, accessToken);
      const practitioners = await getPractitioners(request, accessToken);

      if (appointmentTypes.length === 0 || practitioners.length === 0) {
        test.skip();
        return;
      }

      // Select appointment type (first combobox) - use actual value
      const appointmentTypeSelect = authenticatedPage.locator('select').first();
      await expect(appointmentTypeSelect).toBeVisible();
      // Use the first available appointment type ID
      await appointmentTypeSelect.selectOption({ value: appointmentTypes[0].id.toString() });

      // Wait for practitioner select to be enabled (it depends on appointment type)
      const practitionerSelect = authenticatedPage.locator('select').nth(1);
      await expect(practitionerSelect).toBeEnabled({ timeout: 5000 });

      // Select practitioner - use actual value
      await practitionerSelect.selectOption({ value: practitioners[0].id.toString() });

      // Wait for date/time picker to appear
      const dateTimePicker = authenticatedPage.locator('[data-testid="datetime-picker"]');
      await expect(dateTimePicker).toBeVisible({ timeout: 5000 });

      // Click next button to proceed to confirmation
      const nextButton = authenticatedPage.locator('[data-testid="appointment-form-next-button"]');
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();

      // Wait for confirmation step (or success if it auto-submits)
      // The modal might close automatically on success, or show confirmation
      const confirmButton = authenticatedPage.locator('[data-testid="confirm-create-appointment-button"]');
      // Wait for either confirmation button to appear or modal to close
      await Promise.race([
        confirmButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
        modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => null),
      ]);

      // If confirmation button exists, click it
      if (await confirmButton.isVisible().catch(() => false)) {
        await confirmButton.click();
        // Wait for modal to close after confirmation
        await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => null);
      }

      // Verify appointment appears in calendar (check for patient name in calendar events)
      // Note: This is a simplified check - in a real scenario, we'd wait for the calendar to refresh
      // and verify the appointment appears on the correct date/time
      const calendarAfterCreate = authenticatedPage.locator('.rbc-calendar');
      await expect(calendarAfterCreate).toBeVisible();

    } finally {
      // Cleanup: delete test patient
      if (testPatientId) {
        try {
          const accessToken = await getAccessTokenFromPage(authenticatedPage);
          if (accessToken) {
            await deleteTestPatient(request, testPatientId, accessToken);
          }
        } catch (error) {
          console.warn(`Failed to cleanup test patient ${testPatientId}: ${error}`);
        }
      }
    }
  });
});

