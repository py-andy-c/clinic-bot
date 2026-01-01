#!/usr/bin/env node

/**
 * Incremental E2E Testing Script
 * Analyzes git changes and runs relevant E2E tests
 *
 * Usage:
 *   npm run test:e2e:changed
 *   npm run test:e2e:changed -- --since=main
 *   npm run test:e2e:changed -- --files="src/components/CalendarView.tsx src/pages/AvailabilityPage.tsx"
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File to tag mappings - which test tags to run for which file changes
// 
// MAINTENANCE NOTE: When adding new components or features, update this mapping
// to ensure relevant E2E tests run when those files change. The mapping uses
// path prefixes, so more specific paths should come before general ones.
// 
// Example: If you add a new settings page component, add:
//   'src/pages/settings/NewSettingsPage.tsx': ['@settings'],
//
// See docs/TESTING.md for more details on the mapping strategy.
const FILE_TO_TAG_MAPPINGS = {
  // Calendar-related files
  'src/components/calendar/': ['@calendar'],
  'src/components/CalendarView.tsx': ['@calendar', '@auth'],
  'src/pages/AvailabilityPage.tsx': ['@calendar', '@auth'],
  'src/hooks/useCalendarSelection.ts': ['@calendar'],
  
  // Authentication and appointment files
  'src/pages/LoginPage.tsx': ['@auth'],
  'src/hooks/useAuth.tsx': ['@auth'],
  'src/components/PatientCreationModal.tsx': ['@auth'],
  
  // Settings-related files
  'src/pages/settings/': ['@settings'],
  'src/components/SettingsLayout.tsx': ['@settings'],
  'src/components/SettingsSection.tsx': ['@settings'],
  
  // Clinic switching files
  'src/components/ClinicSwitcher.tsx': ['@clinic'],
  'src/hooks/useApiData.ts': ['@clinic', '@auth', '@settings', '@calendar'], // Core data fetching
  
  // API services (affect all features)
  'src/services/api.ts': ['@auth', '@settings', '@calendar', '@clinic'],
  'src/services/': ['@auth', '@settings', '@calendar', '@clinic'],
  
  // Stores (affect multiple features)
  'src/stores/appointmentStore.ts': ['@auth', '@calendar'],
  'src/stores/': ['@basic'], // Any store change needs basic tests
  
  // General component changes
  'src/components/': ['@basic'], // Any component change affects basic functionality
  'src/pages/': ['@basic'], // Any page change affects basic functionality
  
  // Test file changes
  'tests/e2e/': [], // Don't run tests when test files themselves change
};

// Tag to test file mapping (for reference, but we'll use --grep instead)
const TAG_TO_TESTS = {
  '@auth': ['appointment-creation.spec.ts', 'appointment-editing.spec.ts'],
  '@settings': ['settings-save.spec.ts'],
  '@calendar': ['calendar-navigation.spec.ts'],
  '@clinic': ['clinic-switching.spec.ts'],
  '@basic': ['basic-test.spec.ts'],
};

function getChangedFiles() {
  try {
    // First, check working directory changes (staged + unstaged)
    let output = execSync('git diff --name-only HEAD', { encoding: 'utf8' });
    let changedFiles = output.trim().split('\n').filter(file => file.length > 0);
    
    // If no working changes, check staged changes (for pre-commit compatibility)
    if (changedFiles.length === 0) {
      output = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
      changedFiles = output.trim().split('\n').filter(file => file.length > 0);
    }
    
    // Filter to only frontend files and normalize paths (remove 'frontend/' prefix if present)
    const frontendFiles = changedFiles
      .filter(file => file.startsWith('frontend/') || file.startsWith('src/'))
      .map(file => file.startsWith('frontend/') ? file.substring(9) : file); // Remove 'frontend/' prefix
    
    return frontendFiles.length > 0 ? frontendFiles : changedFiles;
  } catch (error) {
    console.error('Error getting changed files:', error.message);
    // Fallback: check if we're in a git repo
    try {
      execSync('git status', { stdio: 'ignore' });
      return [];
    } catch {
      console.log('Not in a git repository, running all tests');
      return ['all'];
    }
  }
}

function getRelevantTags(changedFiles) {
  const relevantTags = new Set();

  // If explicitly requested all tests
  if (changedFiles.includes('all')) {
    return ['@basic']; // Run basic tests if explicitly requested
  }
  
  // If no changes detected, return empty array (no tests to run)
  if (changedFiles.length === 0) {
    return [];
  }

  // Check each changed file against our mappings
  for (const file of changedFiles) {
    // Skip test files themselves
    if (file.startsWith('tests/e2e/')) {
      continue;
    }

    // Check for exact file matches first
    if (FILE_TO_TAG_MAPPINGS[file]) {
      FILE_TO_TAG_MAPPINGS[file].forEach(tag => relevantTags.add(tag));
      continue;
    }

    // Check for directory/path matches
    for (const [pattern, tags] of Object.entries(FILE_TO_TAG_MAPPINGS)) {
      if (file.startsWith(pattern) && pattern !== file) {
        tags.forEach(tag => relevantTags.add(tag));
      }
    }

    // Frontend source changes generally need basic tests
    if (file.startsWith('src/') && !file.startsWith('src/test')) {
      relevantTags.add('@basic');
    }
  }

  // Always include @basic if any other tags are present
  if (relevantTags.size > 0 && !relevantTags.has('@basic')) {
    relevantTags.add('@basic');
  }

  return Array.from(relevantTags);
}

function runTests(tags) {
  if (tags.length === 0) {
    console.log('✅ No relevant tests to run for the changed files');
    console.log('   (No source file changes detected, or changes don\'t map to any test tags)');
    return;
  }

  console.log(`🔍 Running E2E tests with tags: ${tags.join(', ')}`);
  console.log('');

  // Map tags to test files
  const testFiles = new Set();
  tags.forEach(tag => {
    if (TAG_TO_TESTS[tag]) {
      TAG_TO_TESTS[tag].forEach(test => testFiles.add(test));
    }
  });

  if (testFiles.size === 0) {
    console.log('✅ No test files found for the selected tags');
    return;
  }

  // Build playwright command with test file filtering
  const testArgs = Array.from(testFiles).join(' ');
  const command = `npx playwright test ${testArgs}`;

  console.log(`🚀 Executing: ${command}`);
  console.log('');

  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error('\n❌ E2E tests failed');
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  let since = 'HEAD~1';

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since' && args[i + 1]) {
      since = args[i + 1];
      i++;
    } else if (args[i] === '--files' && args[i + 1]) {
      // Allow manual file specification
      const files = args[i + 1].split(',').map(f => f.trim());
      const relevantTags = getRelevantTags(files);
      runTests(relevantTags);
      return;
    }
  }

  console.log('📊 Analyzing current working directory changes...');
  console.log('');

  const changedFiles = getChangedFiles();

  if (changedFiles.length > 0) {
    console.log('📝 Changed files:');
    changedFiles.forEach(file => console.log(`  - ${file}`));
    console.log('');
  } else {
    console.log('📝 No changes detected in working directory');
    console.log('');
  }

  const relevantTags = getRelevantTags(changedFiles);
  runTests(relevantTags);
}

// Run if executed directly (not imported as a module)
// Check if this file is being run directly by comparing import.meta.url with process.argv[1]
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] && import.meta.url.replace('file://', '').endsWith(process.argv[1]));

if (isMainModule || process.argv[1]?.endsWith('run-changed-e2e-tests.js')) {
  main();
}

export { getChangedFiles, getRelevantTags };
