import { chromium, type FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  // Setup code that runs before all tests
  // For example, you could set up a test database or perform global initialization

  console.log('Global setup: Starting E2E test suite...');

  // You can add any global setup logic here
  // For example, starting a test database or seeding data

  console.log('Global setup: Complete');
}

export default globalSetup;