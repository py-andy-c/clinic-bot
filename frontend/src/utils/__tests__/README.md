# Frontend Unit Tests

This directory contains unit tests for frontend utility functions.

## Setup

To run these tests, you'll need to set up Vitest:

```bash
# Install Vitest and related dependencies
npm install --save-dev vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom

# Add test script to package.json:
# "test": "vitest",
# "test:ui": "vitest --ui"
```

## Configuration

Create `vitest.config.ts` in the frontend directory:

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

## Running Tests

```bash
# Run tests once
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with UI
npm run test:ui
```

## Test Files

- `urlUtils.test.ts` - Tests for URL parameter preservation utility
- `jwtUtils.test.ts` - Tests for JWT token clinic_id extraction logic

