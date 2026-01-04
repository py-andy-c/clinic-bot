import { test as base } from './auth';

/**
 * API Call Tracker for E2E tests.
 * 
 * Tracks API calls during test execution and provides methods to:
 * - Record API calls by endpoint
 * - Get call counts per endpoint
 * - Check for violations (excessive calls)
 * - Get total call count
 */
export class ApiCallTracker {
  private calls: Map<string, number> = new Map();
  private totalCalls: number = 0;
  private customLimits: {
    maxCallsPerEndpoint?: number;
    maxTotalCalls?: number;
    endpointLimits?: Record<string, number>;
  } | null = null;

  /**
   * Record an API call.
   * @param url - Full URL of the API call
   * @param method - HTTP method (GET, POST, etc.)
   */
  record(url: string, method: string = 'GET'): void {
    // Extract endpoint path (remove query params and base URL)
    const endpoint = this.extractEndpoint(url);
    const key = `${method} ${endpoint}`;
    
    const currentCount = this.calls.get(key) || 0;
    this.calls.set(key, currentCount + 1);
    this.totalCalls++;
  }

  /**
   * Extract endpoint path from full URL.
   * Examples:
   * - "http://localhost:8001/api/auth/clinics" -> "/api/auth/clinics"
   * - "http://localhost:8001/api/auth/clinics?foo=bar" -> "/api/auth/clinics"
   */
  private extractEndpoint(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname;
    } catch {
      // If URL parsing fails, try to extract path manually
      // Handles relative URLs, malformed URLs, and URLs without protocol
      const match = url.match(/\/api\/[^?#]*/);
      if (match) {
        return match[0];
      }
      // If no /api/ found, return the full URL as fallback
      return url;
    }
  }

  /**
   * Get call count for a specific endpoint.
   * @param endpoint - Endpoint path (e.g., "/api/auth/clinics")
   * @param method - HTTP method (optional, defaults to any method)
   */
  getCallCount(endpoint: string, method?: string): number {
    if (method) {
      const key = `${method} ${endpoint}`;
      return this.calls.get(key) || 0;
    }
    // Sum across all methods for this endpoint
    let total = 0;
    for (const [key, count] of this.calls.entries()) {
      if (key.endsWith(` ${endpoint}`)) {
        total += count;
      }
    }
    return total;
  }

  /**
   * Get total number of API calls.
   */
  getTotalCalls(): number {
    return this.totalCalls;
  }

  /**
   * Get all recorded calls as a map.
   */
  getAllCalls(): Map<string, number> {
    return new Map(this.calls);
  }

  /**
   * Get violations (endpoints that exceed the limit).
   * @param options - Configuration for violation checking
   * @returns Array of violation messages
   */
  getViolations(options: {
    maxCallsPerEndpoint?: number;
    maxTotalCalls?: number;
    endpointLimits?: Record<string, number>; // e.g., { "/api/auth/clinics": 5 }
  }): string[] {
    const violations: string[] = [];

    // Check per-endpoint limits
    if (options.endpointLimits) {
      for (const [endpoint, maxCalls] of Object.entries(options.endpointLimits)) {
        const count = this.getCallCount(endpoint);
        if (count > maxCalls) {
          violations.push(`${endpoint}: ${count} calls (max: ${maxCalls})`);
        }
      }
    }

    // Check global per-endpoint limit
    if (options.maxCallsPerEndpoint) {
      for (const [key, count] of this.calls.entries()) {
        if (count > options.maxCallsPerEndpoint) {
          violations.push(`${key}: ${count} calls (max: ${options.maxCallsPerEndpoint})`);
        }
      }
    }

    // Check total call limit
    if (options.maxTotalCalls !== undefined) {
      if (this.totalCalls > options.maxTotalCalls) {
        violations.push(`Total API calls: ${this.totalCalls} (max: ${options.maxTotalCalls})`);
      }
    }

    return violations;
  }

  /**
   * Reset all tracked calls.
   */
  reset(): void {
    this.calls.clear();
    this.totalCalls = 0;
  }

  /**
   * Set custom limits for this test.
   * Overrides default limits. Call this at the start of your test.
   * 
   * @param limits - Custom limits to use instead of defaults
   * 
   * @example
   * ```typescript
   * test('my test', async ({ apiCallTracker }) => {
   *   apiCallTracker.setLimits({ maxTotalCalls: 200 });
   *   // ... test code
   * });
   * ```
   */
  setLimits(limits: {
    maxCallsPerEndpoint?: number;
    maxTotalCalls?: number;
    endpointLimits?: Record<string, number>;
  }): void {
    this.customLimits = limits;
  }

  /**
   * Get the limits to use (custom if set, otherwise defaults).
   * @param defaultLimits - Default limits to use if no custom limits set
   */
  getLimits(defaultLimits: {
    maxCallsPerEndpoint?: number;
    maxTotalCalls?: number;
    endpointLimits?: Record<string, number>;
  }): {
    maxCallsPerEndpoint?: number;
    maxTotalCalls?: number;
    endpointLimits?: Record<string, number>;
  } {
    if (this.customLimits) {
      // Merge custom limits with defaults (custom takes precedence)
      return {
        ...defaultLimits,
        ...this.customLimits,
        // For endpointLimits, merge the objects
        endpointLimits: {
          ...defaultLimits.endpointLimits,
          ...this.customLimits.endpointLimits,
        },
      };
    }
    return defaultLimits;
  }
}

/**
 * Playwright fixture for API call tracking.
 * 
 * Automatically tracks all API calls during test execution.
 * Provides methods to check for excessive calls.
 * 
 * Usage:
 * ```typescript
 * // Default limits (automatic check at end of test)
 * test('basic test', async ({ authenticatedPage, apiCallTracker }) => {
 *   await authenticatedPage.goto('/admin/calendar');
 *   // Limits automatically checked at end
 * });
 * 
 * // Override limits for a specific test
 * test('test with more API calls', async ({ authenticatedPage, apiCallTracker }) => {
 *   apiCallTracker.setLimits({ maxTotalCalls: 200 });
 *   await authenticatedPage.goto('/admin/calendar');
 *   // Custom limits checked at end
 * });
 * 
 * // Manual check with custom limits
 * test('manual check', async ({ authenticatedPage, apiCallTracker }) => {
 *   await authenticatedPage.goto('/admin/calendar');
 *   const violations = apiCallTracker.getViolations({
 *     endpointLimits: { '/api/auth/clinics': 5 }
 *   });
 *   expect(violations).toHaveLength(0);
 * });
 * ```
 */
export const test = base.extend<{
  apiCallTracker: ApiCallTracker;
}>({
  apiCallTracker: async ({ authenticatedPage }, use, testInfo) => {
    const tracker = new ApiCallTracker();

    // Track all requests from the authenticated page
    authenticatedPage.on('request', (request) => {
      const url = request.url();
      // Only track API calls (not static assets, etc.)
      if (url.includes('/api/')) {
        tracker.record(url, request.method());
      }
    });

    await use(tracker);

    // After test completes, check for violations
    // Default limits can be overridden per test using tracker.setLimits()
    // All API call limits are defined here (per-endpoint and total budget)
    // 
    // Default limits rationale:
    // - maxCallsPerEndpoint: 10 - Based on typical test usage (most endpoints called 1-3 times)
    // - maxTotalCalls: 100 - Based on typical test usage (most tests make 10-30 API calls)
    // - '/api/auth/clinics': 5 - This endpoint was causing issues (100+ calls due to dependency loop)
    const defaultLimits = {
      maxCallsPerEndpoint: 10, // Default: max 10 calls per endpoint
      maxTotalCalls: 100, // Default: max 100 total calls per test
      // Critical endpoints with stricter limits
      endpointLimits: {
        '/api/auth/clinics': 5, // This endpoint was causing issues
      },
    };

    // Use custom limits if set, otherwise use defaults
    const limits = tracker.getLimits(defaultLimits);
    const violations = tracker.getViolations(limits);
    if (violations.length > 0) {
      // Get all calls for debugging
      const allCalls = Array.from(tracker.getAllCalls().entries())
        .map(([key, count]) => `  ${key}: ${count}`)
        .join('\n');

      throw new Error(
        `Excessive API calls detected in test "${testInfo.title}":\n` +
        violations.join('\n') +
        `\n\nAll API calls:\n${allCalls}\n` +
        `Total calls: ${tracker.getTotalCalls()}\n\n` +
        `If this test legitimately needs more API calls, override limits using:\n` +
        `  apiCallTracker.setLimits({ maxTotalCalls: 200, ... })`
      );
    }
  },
});

export { expect } from '@playwright/test';

