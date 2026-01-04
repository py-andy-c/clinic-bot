import { test, expect } from '../fixtures/auth';

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
    const calendar = authenticatedPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 15000 });
    
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
      await authenticatedPage.waitForTimeout(1000); // Wait for auth to process
      
      // Should not be redirected to login - verify we're still in admin area
      const currentUrl = authenticatedPage.url();
      expect(currentUrl).toContain('/admin/');
      expect(currentUrl).not.toContain('/admin/login');
    }
  });

  test('clinic user can open create appointment modal @appointment', async ({ authenticatedPage }) => {
    // Navigate to calendar page
    await authenticatedPage.goto('/admin/calendar', { waitUntil: 'load' });
    await authenticatedPage.waitForTimeout(1000); // Wait for auth to process
    
    // Verify we're on the calendar page
    const currentUrl = authenticatedPage.url();
    expect(currentUrl).toContain('/admin/calendar');
    
    // Verify calendar is visible
    const calendar = authenticatedPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 15000 });
    
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
});

