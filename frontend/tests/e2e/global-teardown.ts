import { type FullConfig } from '@playwright/test';

async function globalTeardown(config: FullConfig) {
  // Cleanup code that runs after all tests
  console.log('Global teardown: Cleaning up E2E test suite...');

  // You can add any global cleanup logic here
  // For example, stopping test databases or cleaning up resources

  console.log('Global teardown: Complete');
}

export default globalTeardown;