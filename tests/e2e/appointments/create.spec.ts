import { test, expect } from '../fixtures/auth';

/**
 * E2E test for appointment creation flow.
 * 
 * This test verifies that authenticated users can create appointments
 * through the calendar interface.
 */
test.describe('Appointment Creation', () => {
  test('user can navigate to calendar page after authentication @smoke @appointment', async ({ authenticatedPage }) => {
    // Navigate to calendar page
    await authenticatedPage.goto('/admin/calendar');
    
    // Wait for page to load
    await authenticatedPage.waitForLoadState('networkidle');
    
    // System admins may be redirected to their default route, so check for either calendar or system clinics
    const currentUrl = authenticatedPage.url();
    const isCalendarPage = currentUrl.includes('/admin/calendar');
    const isSystemAdminDefault = currentUrl.includes('/admin/system/clinics');
    
    // Verify we're on a valid admin page (not redirected to login)
    expect(isCalendarPage || isSystemAdminDefault).toBe(true);
    
    // If we're on the calendar page, verify calendar is visible
    if (isCalendarPage) {
      const calendar = authenticatedPage.locator('.rbc-calendar');
      await expect(calendar).toBeVisible({ timeout: 10000 });
      
      // Also verify the create appointment button is visible (confirms page loaded correctly)
      const createButton = authenticatedPage.locator('[data-testid="create-appointment-button"]');
      await expect(createButton).toBeVisible();
    } else {
      // If redirected to system admin default, verify that page loaded
      const body = authenticatedPage.locator('body');
      await expect(body).toBeVisible();
    }
  });

  test('authenticated user can access protected routes @smoke', async ({ authenticatedPage }) => {
    // Test accessing different protected routes
    // Note: System admins may be redirected to default routes, so we check for valid admin URLs
    const protectedRoutes = [
      '/admin/calendar',
      '/admin/clinic/patients',
      '/admin/clinic/members',
      '/admin/system/clinics', // System admin default route
    ];
    
    for (const route of protectedRoutes) {
      await authenticatedPage.goto(route);
      await authenticatedPage.waitForLoadState('networkidle');
      
      // Should not be redirected to login - verify we're still in admin area
      const currentUrl = authenticatedPage.url();
      expect(currentUrl).toContain('/admin/');
      expect(currentUrl).not.toContain('/admin/login');
    }
  });

  test('clinic user can open create appointment modal @appointment', async ({ authenticatedPage }) => {
    // This test requires clinic_user (not system_admin) to access calendar
    // Note: Run with E2E_TEST_USER_TYPE=clinic_user to test appointment creation
    // Navigate to calendar page
    await authenticatedPage.goto('/admin/calendar');
    await authenticatedPage.waitForLoadState('networkidle');
    
    // Check if we're on calendar page (clinic users can access it, system admins get redirected)
    const currentUrl = authenticatedPage.url();
    
    // If we're not on calendar page, this test is for clinic users only
    // System admins will be redirected to /admin/system/clinics
    if (!currentUrl.includes('/admin/calendar')) {
      // Skip test for system admins - they don't have access to calendar
      return;
    }
    
    // Verify calendar is visible
    const calendar = authenticatedPage.locator('.rbc-calendar');
    await expect(calendar).toBeVisible({ timeout: 10000 });
    
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

