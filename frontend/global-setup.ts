import { execSync } from 'child_process';
import { Client } from 'pg';

// Global setup for E2E tests
async function globalSetup() {
  console.log('🚀 Starting E2E test global setup...');

  // Run database migrations
  console.log('📦 Running database migrations...');
  try {
    execSync('cd ../backend && source venv/bin/activate && alembic upgrade head', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL || 'postgresql://user:password@localhost/clinic_bot_e2e' }
    });
    console.log('✅ Database migrations completed');
  } catch (error) {
    console.error('❌ Database migrations failed:', error);
    throw error;
  }

  // Truncate business tables
  console.log('🗑️  Truncating business tables...');

  const client = new Client({
    connectionString: process.env.E2E_DATABASE_URL || 'postgresql://user:password@localhost/clinic_bot_e2e',
  });

  try {
    await client.connect();

    // Get all business tables (exclude system tables)
    const businessTablesQuery = `
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename NOT IN ('alembic_version', 'spatial_ref_sys')
      AND tablename NOT LIKE 'pg_%'
      AND tablename NOT LIKE 'sql_%'
    `;

    const result = await client.query(businessTablesQuery);
    const businessTables = result.rows.map(row => row.tablename);

    console.log(`Found ${businessTables.length} business tables to truncate`);

    if (businessTables.length > 0) {
      // Truncate all business tables with CASCADE
      const truncateQuery = `TRUNCATE TABLE ${businessTables.join(', ')} CASCADE`;
      await client.query(truncateQuery);
      console.log('✅ Business tables truncated');
    }

    // Seed system-level constants if needed
    console.log('🌱 Seeding system-level constants...');
    // Add any system constants seeding here if needed

    console.log('✅ Global setup completed');

  } catch (error) {
    console.error('❌ Database cleanup failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

export default globalSetup;
