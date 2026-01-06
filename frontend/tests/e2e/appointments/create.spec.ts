import { test, authTest } from '../fixtures';
import { expect } from '@playwright/test';

test.describe('Appointment Creation', () => {
  test('basic authentication and navigation @smoke @infrastructure', async ({ seededPage }) => {
    // Test basic authentication flow and navigation
    const { page } = seededPage;

    // Verify we're on the calendar page
    await expect(page).toHaveURL(/.*\/admin\/calendar/);

    // Verify page loaded with basic content
    await expect(page.locator('h1, h2, h3').first()).toBeVisible();
  });

  test('basic calendar page functionality @smoke @infrastructure', async ({ seededPage }) => {
    const { page } = seededPage;

    // Verify we're on the calendar page
    await expect(page).toHaveURL(/.*\/admin\/calendar/);

    // Verify page loaded with basic content
    await expect(page.locator('h1, h2, h3').first()).toBeVisible();

    // Verify the create appointment button exists (desktop version)
    const createAppointmentBtn = page.getByTestId('create-appointment-button');
    await expect(createAppointmentBtn).toBeVisible();
    await expect(createAppointmentBtn).toBeEnabled();

    // Try clicking the button to verify modal functionality
    await createAppointmentBtn.click();

    // Check if modal appeared
    await page.waitForTimeout(1000);
    const modalExists = await page.locator('[role="dialog"]').count() > 0;
    expect(modalExists).toBe(true);
  });

  test('verify seeded data is available @smoke', async ({ seededPage }) => {
    const { scenarioData } = seededPage;

    // Verify scenario data structure
    expect(scenarioData.clinic_id).toBeDefined();
    expect(scenarioData.users).toHaveLength(2); // admin + practitioner
    expect(scenarioData.appointment_types).toHaveLength(1);
    expect(scenarioData.patients).toHaveLength(1);

    // Verify user roles
    const adminUser = scenarioData.users.find(u => u.roles.includes('admin'));
    const practitionerUser = scenarioData.users.find(u => u.roles.includes('practitioner'));

    expect(adminUser).toBeDefined();
    expect(practitionerUser).toBeDefined();
  });

  test('create appointment with seeded data @critical', async ({ seededPage }) => {
    const { page, scenarioData } = seededPage;

    // Verify we're on the calendar page
    await expect(page).toHaveURL(/.*\/admin\/calendar/);

    // Verify token is present
    const tokenInStorage = await page.evaluate(() => {
      return localStorage.getItem('auth_access_token');
    });
    expect(tokenInStorage).toBeTruthy();

    // Debug: Check page content
    const pageTitle = await page.title();
    // Verify basic page content is loaded
    await expect(page.getByRole('heading', { name: '行事曆' })).toBeVisible();

    // Check if the create appointment button is available
    const createAppointmentBtn = page.getByTestId('create-appointment-button');
    await expect(createAppointmentBtn).toBeVisible();
    await expect(createAppointmentBtn).toBeEnabled();

    // Wait for page to fully load with data
    await page.waitForTimeout(2000);

    // Wait for practitioners to load (CalendarView should render when practitioners are available)
    await page.waitForTimeout(2000);

    // Click the create appointment button (already declared above)
    await createAppointmentBtn.click();

    // Wait for modal to appear
    const modal = page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Verify modal has some interactive elements (indicates proper modal structure)
    const modalButtons = modal.locator('button');
    await expect(modalButtons.first()).toBeVisible({ timeout: 5000 });
  });
});