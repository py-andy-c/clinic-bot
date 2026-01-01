/**
 * Test helpers index
 */

export { AuthHelper, createAuthHelper } from './auth';
export { CalendarHelper, createCalendarHelper } from './calendar';

// Common test data
export const TEST_DATA = {
  users: {
    admin: {
      email: 'admin@test.clinic',
      name: 'Test Admin'
    },
    practitioner: {
      email: 'practitioner@test.clinic',
      name: 'Test Practitioner'
    }
  },
  patients: {
    patient1: {
      name: '測試病患一',
      phone: '0912345678'
    },
    patient2: {
      name: '測試病患二',
      phone: '0987654321'
    }
  },
  appointments: {
    basic: {
      type: '一般治療',
      date: '15', // Day of month
      time: '10:00 AM',
      notes: 'Test appointment'
    }
  }
};

// Common test utilities
export class TestUtils {
  /**
   * Wait for page to be fully loaded
   */
  static async waitForPageLoad(page: any) {
    await page.waitForLoadState('networkidle');
    await page.waitForLoadState('domcontentloaded');
  }

  /**
   * Take screenshot on failure
   */
  static async takeScreenshotOnFailure(page: any, testName: string) {
    await page.screenshot({
      path: `test-results/screenshots/${testName}-failure.png`,
      fullPage: true
    });
  }

  /**
   * Mock API responses for testing
   */
  static async mockAPIResponse(page: any, url: string, response: any) {
    await page.route(url, (route: any) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response)
      });
    });
  }
}
