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
    console.log(`🔧 Setting up seededPage for test: "${testInfo.title}"`);
    const page = authenticatedPage;
    const scenario = testInfo.title.includes('minimal') ? 'minimal' :
                     'standard'; // Default to standard for all other tests

    console.log(`📋 Using scenario: ${scenario}`);

    // For E2E tests, use fixed test user/clinic IDs
    const userId = 1; // test@example.com user
    const clinicId = 2; // test clinic

    // Request scenario data from seed API
    console.log('🌱 Requesting seed data...');
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
    console.log(`✅ Seed data received: ${scenarioData.users.length} users, ${scenarioData.appointment_types.length} appointment types`);

    // Create storage state with auth tokens
    const primaryToken = scenarioData.tokens[0];
    console.log('🔑 Creating storage state with authentication...');

    const storageState = {
      cookies: [],
      origins: [{
        origin: 'http://localhost:5174',
        localStorage: [{
          name: 'auth_access_token',
          value: primaryToken.access_token
        }, {
          name: 'auth_refresh_token',
          value: primaryToken.refresh_token
        }]
      }]
    };

    // Apply storage state to the context
    await page.context().addCookies(storageState.cookies);
    // Note: addInitScript for localStorage would be better, but let's try storage state

    // Navigate to calendar page
    console.log('🏠 Navigating to calendar page...');
    await page.goto('/admin/calendar');
    console.log('📄 Waiting for page load...');
    await page.waitForLoadState('networkidle');
    console.log(`📍 Final URL: ${page.url()}`);

    // Manually set localStorage after navigation
    await page.evaluate((token) => {
      try {
        localStorage.setItem('auth_access_token', token.access_token);
        localStorage.setItem('auth_refresh_token', token.refresh_token);
        console.log('Auth tokens set in localStorage');
      } catch (e) {
        console.log('Failed to set localStorage:', e.message);
      }
    }, primaryToken);

    // Mock practitioners API for testing
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
      adminToken: scenarioData.tokens[0].access_token // Use token from seeded data
    };

    await use(result);
  },
});