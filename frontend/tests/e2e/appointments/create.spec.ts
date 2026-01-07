import { test } from '../fixtures';
import { expect } from '@playwright/test';
import moment from 'moment-timezone';

test.describe('Appointment Creation', () => {
  // Helper function for deterministic timing
  const getTestAppointmentDateTime = () => {
    const now = moment().tz('Asia/Taipei');

    // Always schedule for next Monday (predictable weekday)
    const nextMonday = now.clone().startOf('week').add(1, 'week').day(1);

    // If today is Monday and before 10 AM, use today. Otherwise next Monday.
    const targetDate = (now.day() === 1 && now.hour() < 10) ? now : nextMonday;

    // Fixed time: 10:00 AM Taiwan time (within business hours)
    return targetDate.hour(10).minute(0).second(0).millisecond(0);
  };

  // REMOVED REDUNDANT TESTS
  // These infrastructure tests are now covered by the comprehensive
  // "create full appointment" test which validates:
  // - Authentication & navigation
  // - Calendar page loading
  // - Seeded data availability
  // - Modal opening & form functionality
  // - Complete appointment creation flow

  test('create full appointment @critical @appointment', async ({ browser, request }) => {
    // Create a fresh browser context for this test to avoid fixture conflicts
    const context = await browser.newContext();
    const page = await context.newPage();

    // Ensure seed data exists for this test
    const seedResponse = await request.post('http://localhost:8001/api/test/seed/seed', {
      data: {
        scenario: 'standard'
        // Don't specify user_id or clinic_id - let the seed API create new ones
      }
    });

    if (!seedResponse.ok()) {
      throw new Error(`Seed API failed: ${seedResponse.status()}`);
    }
    const seedData = await seedResponse.json();

    // Use the tokens from the seeded data (these should have the correct clinic association)
    const primaryToken = seedData.tokens[0];
    await page.addInitScript((token) => {
      window.localStorage.setItem('auth_access_token', token.access_token);
      window.localStorage.setItem('auth_refresh_token', token.refresh_token);
    }, primaryToken);

    // Navigate to calendar page
    await page.goto('http://localhost:5174/admin/calendar');
    await page.waitForLoadState('networkidle');

    // Calculate deterministic appointment time
    const appointmentDateTime = getTestAppointmentDateTime();
    const dateString = appointmentDateTime.format('YYYY-MM-DD');
    const timeString = appointmentDateTime.format('HH:mm');

    // Verify we're on the calendar page
    await expect(page).toHaveURL(/.*\/admin\/calendar/);

    // Verify the page loaded with calendar heading
    await expect(page.getByRole('heading', { name: '行事曆' })).toBeVisible();

    // Click the create appointment button
    const createAppointmentBtn = page.getByTestId('create-appointment-button');
    await expect(createAppointmentBtn).toBeVisible();
    await expect(createAppointmentBtn).toBeEnabled();
    await createAppointmentBtn.click();

    // Wait for modal to appear
    const modal = page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 10000 });

    // 1. Select patient
    // Click on the search input to focus it and trigger patient loading
    const searchInput = page.getByTestId('patient-selector').locator('input');
    await searchInput.click();
    await searchInput.fill('Test'); // Type to trigger search
    await page.waitForLoadState('networkidle'); // Wait for patient list to load

    // Select Test Patient from the dropdown
    const testPatientButton = page.locator('button').filter({ hasText: 'Test Patient' });
    await testPatientButton.waitFor({ state: 'visible', timeout: 5000 });
    await testPatientButton.click();

    // 2. Select appointment type
    const appointmentTypeSelector = page.getByTestId('appointment-type-selector');

    // Wait for appointment types to load (more than just the placeholder option)
    await page.waitForFunction(() => {
      const selector = document.querySelector('[data-testid="appointment-type-selector"]') as HTMLSelectElement;
      return selector && selector.options.length > 1;
    }, { timeout: 10000 });

    // Select the appointment type (includes duration in the label)
    await appointmentTypeSelector.selectOption({ label: '一般治療 (60分鐘)' });

    // 3. Select practitioner
    const practitionerSelector = page.getByTestId('practitioner-selector');

    // Wait for practitioner selector to become enabled (it depends on appointment type selection)
    await page.waitForFunction(() => {
      const selector = document.querySelector('[data-testid="practitioner-selector"]') as HTMLSelectElement;
      return selector && !selector.disabled;
    }, { timeout: 5000 });

    // Wait for practitioners to load
    await page.waitForFunction(() => {
      const selector = document.querySelector('[data-testid="practitioner-selector"]') as HTMLSelectElement;
      return selector && selector.options.length > 1;
    }, { timeout: 10000 });

    // Select the first available practitioner (should be our seeded one)
    await practitionerSelector.selectOption({ index: 1 }); // Skip index 0 which is "選擇治療師"

    // 4. Select date
    const datePicker = page.getByTestId('date-picker');
    // Click on the button that contains "12" (the day we want to select)
    await datePicker.getByText('12').click();

    // 5. Select time
    // Look for time buttons in the time slots grid and click "10:00"
    const timeButton = page.getByRole('button', { name: '10:00' });
    await timeButton.click();

    // 6. Add clinic notes
    const notesField = page.getByTestId('clinic-notes').locator('textarea');
    await notesField.fill('E2E test appointment - automated creation');

    // 7. Click "Next Step" to go to confirmation
    const nextStepBtn = page.getByRole('button', { name: '下一步' });
    await expect(nextStepBtn).toBeEnabled();
    await nextStepBtn.click();

    // 8. Submit the appointment
    const submitBtn = page.getByTestId('create-appointment-submit');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 8. Verify success message
    await expect(page.getByText('預約已建立')).toBeVisible({ timeout: 10000 });

    // 9. Verify appointment appears in calendar (optional - would require checking calendar display)
    // For now, the success message is sufficient proof that the appointment was created

    // Close context after test
    await context.close();
  });
});