import { test as base } from '@playwright/test';

interface ScenarioData {
  clinic_id: number;
  users: Array<{
    id: number;
    email: string;
    roles: string[];
    clinic_id?: number;
    full_name: string;
  }>;
  tokens: Array<{
    user_id: number;
    access_token: string;
    refresh_token: string;
  }>;
  appointment_types?: Array<{
    id: number;
    name: string;
    duration_minutes: number;
  }>;
  patients?: Array<{
    id: number;
    full_name: string;
    phone_number: string;
  }>;
}

// Import the auth test to extend from it
import { test as authTest } from './auth';

export const test = authTest.extend<{
  seededPage: {
    page: any;
    scenarioData: ScenarioData;
    adminToken: string;
  };
}>({
  seededPage: async ({ authenticatedPage, request }, use, testInfo) => {
    const page = authenticatedPage;
    const scenario = testInfo.title.includes('minimal') ? 'minimal' :
                     'standard'; // Default to standard for all other tests

    // Get token from already authenticated page
    const access_token = await page.evaluate(() => localStorage.getItem('auth_access_token'));

    // Decode token to get user/clinic info for seeding
    let userId, clinicId;
    try {
      const tokenPayload = JSON.parse(atob(access_token!.split('.')[1]));
      userId = tokenPayload.user_id;
      clinicId = tokenPayload.active_clinic_id;
    } catch (e) {
      throw new Error('Could not decode auth token');
    }

    // First test if seed API is available
    const healthResponse = await request.get('http://localhost:8001/api/test/seed/health');
    if (!healthResponse.ok()) {
      throw new Error(`Seed API health check failed: ${healthResponse.status()} ${healthResponse.statusText()}`);
    }

    // Request scenario data from seed API with user/clinic context
    const seedResponse = await request.post('http://localhost:8001/api/test/seed/seed', {
      data: {
        scenario,
        user_id: userId,
        clinic_id: clinicId
      }
    });

    if (!seedResponse.ok()) {
      const errorText = await seedResponse.text();
      throw new Error(`Seed API failed: ${seedResponse.status()} ${seedResponse.statusText()}`);
    }

    const scenarioData: ScenarioData = await seedResponse.json();

    // Set auth tokens in localStorage and navigate to calendar
    await page.goto('/admin/calendar');
    await page.evaluate((token) => {
      localStorage.setItem('auth_access_token', token);
      localStorage.setItem('auth_refresh_token', 'dummy_refresh_token');
    }, access_token);

    // Reload the page to ensure React picks up the auth token
    await page.reload();
    await page.waitForLoadState('networkidle');

    // NOTE: Not mocking practitioners API - we want to test the real API call

    await page.route('**/clinic/practitioners/status/batch', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          practitioners: [{
            id: scenarioData.users[1]?.id || 2,
            status: 'available',
            next_appointment: null
          }]
        })
      });
    });

    const result = {
      page,
      scenarioData,
      adminToken: access_token
    };

    await use(result);
  },
});