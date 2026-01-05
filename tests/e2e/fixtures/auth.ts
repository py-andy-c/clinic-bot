import { test as base, Page } from '@playwright/test';

/**
 * Fixtures for E2E tests.

/**
 * Authenticated page fixture that handles login via test-only endpoint.
 * 
 * Implements token caching for performance while maintaining test isolation.
 * Cache is per-worker (Playwright workers run tests in parallel).
 * 
 * Defaults to clinic_user with roles ['admin', 'practitioner'] for full access.
 * Email can be configured via E2E_TEST_EMAIL environment variable.
 * 
 * Future: When role-based testing is needed, we can extend this to support per-test roles:
 *   - Option 1: Use test.use() with a custom fixture option
 *   - Option 2: Create separate fixtures (authenticatedAdminPage, authenticatedPractitionerPage)
 *   - Option 3: Pass roles as a parameter to a helper function
 */

export type ScenarioName = 'minimal' | 'standard' | 'multi_clinic' | 'with_appointment';

export interface SeededData {
  clinic_id: number;
  tokens: {
    role: string;
    email?: string;
    clinic_id?: number;
    clinic_name?: string;
    access_token: string;
    refresh_token: string;
  }[];
  clinic_names?: string[];
  appointment_type_id?: number;
  appointment_type_name?: string;
  patient_id?: number;
  patient_name?: string;
}

export const test = base.extend<{
  // Option to specify scenario for seededPage
  scenario: ScenarioName;
  // Fixture that provides a pre-authenticated page with specific scenario data
  seededPage: Page;
  // Data returned from the seed API for the current test
  seededData: SeededData;
}>({
  // Default scenario is minimal
  scenario: ['minimal', { option: true }],

  seededData: async ({ request, scenario }, use) => {
    const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8001';

    // Call seed API
    const response = await request.post(`${apiBaseUrl}/api/test/seed`, {
      data: { scenario }
    });

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(`Seeding failed for scenario "${scenario}": ${response.status()} ${errorText}`);
    }

    const data = await response.json();
    await use(data);
  },

  seededPage: async ({ page, seededData }, use) => {
    // Use the first token returned by the seed API (usually the admin)
    const auth = seededData.tokens[0];

    // Set tokens in localStorage
    await page.goto('/');
    await page.evaluate(({ accessToken, refreshToken }) => {
      localStorage.setItem('auth_access_token', accessToken);
      localStorage.setItem('auth_refresh_token', refreshToken);
    }, { accessToken: auth.access_token, refreshToken: auth.refresh_token });

    // Reload to apply auth
    await page.reload();
    await page.waitForLoadState('load');

    // Brief wait for app initialization
    await page.waitForTimeout(500);

    await use(page);
  },
});

export { expect } from '@playwright/test';


