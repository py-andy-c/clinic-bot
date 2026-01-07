/**
 * Data Flow Health Check Tests
 *
 * These tests verify that seeded data flows correctly from backend API
 * through React Query to frontend components, preventing "working backend,
 * broken frontend" scenarios.
 */

import { test } from '../fixtures';
import { expect } from '@playwright/test';

test.describe('Data Flow Health Checks', () => {
  test('clinic settings data loads correctly', async ({ browser, request }) => {
    console.log('🏥 Testing clinic settings data flow...');

    // 1. Seed data
    const seedResponse = await request.post('http://localhost:8001/api/test/seed/seed', {
      data: { scenario: 'standard' }
    });

    expect(seedResponse.ok()).toBe(true);
    const seedData = await seedResponse.json();

    console.log(`✅ Seed data created: ${seedData.appointment_types?.length || 0} appointment types`);

    // 2. Create fresh browser context and authenticate
    const context = await browser.newContext();
    const page = await context.newPage();
    const primaryToken = seedData.tokens[0];

    // Set auth tokens
    await page.addInitScript((token) => {
      window.localStorage.setItem('auth_access_token', token.access_token);
      window.localStorage.setItem('auth_refresh_token', token.refresh_token);
    }, primaryToken);

    // Capture React Query errors
    const queryErrors: any[] = [];
    page.on('console', msg => {
      if (msg.text().includes('React Query Error') || msg.text().includes('Zod Validation Failed')) {
        queryErrors.push(msg.text());
      }
    });

    await page.goto('http://localhost:5174/admin/calendar');
    await page.waitForLoadState('networkidle');

    // 3. Verify UI shows loaded data by checking if appointment creation works
    // Instead of accessing React Query directly, test through UI behavior
    const createBtn = page.getByTestId('create-appointment-button');
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeEnabled();

    // 4. Open modal to verify appointment types are loaded
    await createBtn.click();
    const modal = page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible();

    // 5. Verify appointment types dropdown has options
    const appointmentTypeSelector = page.getByTestId('appointment-type-selector');
    await expect(appointmentTypeSelector).toBeVisible();

    // Wait for appointment types to load
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-testid="appointment-type-selector"]') as HTMLSelectElement;
      return select && select.options.length > 1;
    }, { timeout: 10000 });

    const appointmentOptions = appointmentTypeSelector.locator('option');
    const appointmentCount = await appointmentOptions.count();
    expect(appointmentCount).toBeGreaterThan(1);

    console.log('✅ Data flow health check passed - appointment types loaded successfully');

    // 4. Verify no React Query errors occurred
    expect(queryErrors.length).toBe(0);

    // 6. Verify UI reflects loaded data
    await expect(page.getByRole('heading', { name: '行事曆' })).toBeVisible();
    await expect(page.getByTestId('create-appointment-button')).toBeVisible();

    console.log('✅ Data flow health check passed');

    await context.close();
  });

  test('appointment types are available in modal', async ({ browser, request }) => {
    console.log('📅 Testing appointment types availability in modal...');

    // 1. Seed data
    const seedResponse = await request.post('http://localhost:8001/api/test/seed/seed', {
      data: { scenario: 'standard' }
    });
    expect(seedResponse.ok()).toBe(true);
    const seedData = await seedResponse.json();
    const primaryToken = seedData.tokens[0];

    // 2. Create fresh browser context and authenticate
    const context = await browser.newContext();
    const page = await context.newPage();

    // Set auth tokens
    await page.addInitScript((token) => {
      window.localStorage.setItem('auth_access_token', token.access_token);
      window.localStorage.setItem('auth_refresh_token', token.refresh_token);
    }, primaryToken);

    await page.goto('http://localhost:5174/admin/calendar');

    const createBtn = page.getByTestId('create-appointment-button');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    const modal = page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible();

    // 3. Verify appointment types are loaded in dropdown
    const appointmentTypeSelector = page.getByTestId('appointment-type-selector');
    await expect(appointmentTypeSelector).toBeVisible();

    // Wait for options to load
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-testid="appointment-type-selector"]') as HTMLSelectElement;
      return select && select.options.length > 1;
    }, { timeout: 10000 });

    // Verify we have appointment types loaded
    const options = appointmentTypeSelector.locator('option');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(1); // More than just placeholder

    console.log(`✅ Found ${optionCount} appointment type options in modal`);

    await context.close();
  });

  test('practitioners are available for appointment types', async ({ browser, request }) => {
    console.log('👥 Testing practitioner availability for appointment types...');

    // 1. Seed data
    const seedResponse = await request.post('http://localhost:8001/api/test/seed/seed', {
      data: { scenario: 'standard' }
    });
    expect(seedResponse.ok()).toBe(true);
    const seedData = await seedResponse.json();
    const primaryToken = seedData.tokens[0];

    // 2. Create fresh browser context and authenticate
    const context = await browser.newContext();
    const page = await context.newPage();

    // Set auth tokens
    await page.addInitScript((token) => {
      window.localStorage.setItem('auth_access_token', token.access_token);
      window.localStorage.setItem('auth_refresh_token', token.refresh_token);
    }, primaryToken);

    await page.goto('http://localhost:5174/admin/calendar');

    await page.getByTestId('create-appointment-button').click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // 3. Select appointment type
    const appointmentTypeSelector = page.getByTestId('appointment-type-selector');
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-testid="appointment-type-selector"]') as HTMLSelectElement;
      return select && select.options.length > 1;
    }, { timeout: 10000 });

    await appointmentTypeSelector.selectOption({ label: '一般治療 (60分鐘)' });

    // 4. Verify practitioners become available
    const practitionerSelector = page.getByTestId('practitioner-selector');
    await expect(practitionerSelector).toBeEnabled();

    await page.waitForFunction(() => {
      const select = document.querySelector('[data-testid="practitioner-selector"]') as HTMLSelectElement;
      return select && select.options.length > 1;
    }, { timeout: 10000 });

    const practitionerOptions = practitionerSelector.locator('option');
    const practitionerCount = await practitionerOptions.count();
    expect(practitionerCount).toBeGreaterThan(1); // More than just placeholder

    console.log(`✅ Found ${practitionerCount} practitioner options for selected appointment type`);

    await context.close();
  });
});
