import { type FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  // Setup code that runs before all tests
  console.log('Global setup: Starting E2E test suite...');

  // Get test database URL (default matches CI configuration)
  const dbUrl = process.env.E2E_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/test_db';
  const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':****@'); // Hide password in logs
  console.log(`Global setup: Using database: ${maskedUrl}`);

  // Note: Database creation is handled by the backend launch script via migrations
  // If the database doesn't exist, the backend will attempt to create it during migration
  // For manual setup, see docs/TESTING.md

  console.log('Global setup: Complete');
}

export default globalSetup;