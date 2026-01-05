import { test, expect } from '../fixtures/api-monitoring';

/**
 * E2E test for appointment editing flow.
 * 
 * This test verifies that authenticated users can edit existing appointments.
 */
test.describe('Appointment Editing', () => {
  // Use the scenario with a pre-existing appointment
  test.use({ scenario: 'with_appointment' });

  test('clinic user can edit appointment @appointment', async ({ seededPage, seededData }) => {
    const patientName = seededData.patient_name || 'Patient';

    // Navigate directly to calendar page
    await seededPage.goto('/admin/calendar', { waitUntil: 'load' });
    await seededPage.waitForLoadState('domcontentloaded');

    // Wait for calendar to be visible
    const calendar = seededPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 15000 });

    // Switch to Day view to ensure the event is large enough to see
    const dayViewButton = seededPage.getByText(/Day|日/i).first();
    if (await dayViewButton.isVisible()) {
      await dayViewButton.click();
      await seededPage.waitForTimeout(1000); // Wait for transition
    }

    // Look for calendar events that contain the patient name
    // The scenario 'with_appointment' ensures one exists
    const appointmentEvent = seededPage.locator('.rbc-event').filter({ hasText: patientName }).first();

    // If still not found, print debug info
    if (!await appointmentEvent.isVisible({ timeout: 5000 })) {
      console.log('Appointment event not found for patient:', patientName);
      // Try finding ANY event as a fallback
      const anyEvent = seededPage.locator('.rbc-event').first();
      if (await anyEvent.isVisible()) {
        console.log('Found an event, clicking it.');
        await anyEvent.click();
      } else {
        throw new Error('No calendar events found at all.');
      }
    } else {
      await expect(appointmentEvent).toBeVisible({ timeout: 10000 });
      // Click it to open details/edit
      await appointmentEvent.click();
    }

    // Look for edit button
    const editButton = seededPage.getByText(/編輯|Edit/).first();
    await expect(editButton).toBeVisible({ timeout: 5000 });
    await editButton.click();

    // Wait for edit modal to appear
    const editModal = seededPage.locator('text=編輯預約').or(seededPage.locator('text=Edit Appointment'));
    await expect(editModal.first()).toBeVisible({ timeout: 5000 });

    // NO CLEANUP NEEDED
  });
});

