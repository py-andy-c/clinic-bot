/**
 * Development-time schema validation warnings
 *
 * This utility provides development-time warnings for schema mismatches
 * between backend API responses and frontend expectations.
 */

import { ZodError, ZodType } from 'zod';

declare global {
  interface Window {
    __DEV_SCHEMA_WARNINGS__?: boolean;
  }
}

// Enable warnings in development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  window.__DEV_SCHEMA_WARNINGS__ = true;
}

/**
 * Logs development warnings for schema validation issues
 */
export function logSchemaWarning(schemaName: string, issue: string, details?: any) {
  if (typeof window === 'undefined' || !window.__DEV_SCHEMA_WARNINGS__) {
    return;
  }

  console.warn(`🚨 [Schema Warning] ${schemaName}: ${issue}`, {
    schema: schemaName,
    issue,
    details,
    timestamp: new Date().toISOString(),
    url: window.location.href
  });
}

/**
 * Enhanced Zod schema wrapper with development warnings
 */
export function createValidatedSchema<T extends ZodType>(
  schema: T,
  schemaName: string
): T {
  return schema.catch((error: ZodError, ctx: { data?: any }) => {
    // Log detailed warning in development
    logSchemaWarning(schemaName, 'Validation failed', {
      errors: error.errors.map(err => ({
        path: err.path.join('.'),
        message: err.message,
        code: err.code
      })),
      receivedData: ctx.data ? {
        type: typeof ctx.data,
        keys: typeof ctx.data === 'object' && ctx.data !== null ? Object.keys(ctx.data) : undefined,
        sample: JSON.stringify(ctx.data).substring(0, 200)
      } : 'No data',
      endpoint: typeof window !== 'undefined' ? window.location.pathname : 'unknown'
    });

    throw error;
  }) as unknown as T;
}

/**
 * Validates seed data against frontend schemas during development
 */
export async function validateSeedDataCompatibility(seedData: any) {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') {
    return;
  }

  try {
    // Import schemas dynamically to avoid circular dependencies
    const { AppointmentTypeSchema, UserSchema } = await import('../schemas/api');

    // Validate clinic settings structure
    if (seedData.appointment_types) {
      logSchemaWarning('SeedData', `Validating ${seedData.appointment_types.length} appointment types`);

      for (const aptType of seedData.appointment_types) {
        try {
          AppointmentTypeSchema.parse(aptType);
        } catch (error) {
          logSchemaWarning('AppointmentType', 'Seed data validation failed', { aptType, error });
        }
      }
    }

    // Validate user data structure
    if (seedData.users) {
      for (const user of seedData.users) {
        try {
          UserSchema.parse(user);
        } catch (error) {
          logSchemaWarning('User', 'Seed data validation failed', { user, error });
        }
      }
    }

  } catch (error) {
    logSchemaWarning('SeedValidation', 'Failed to validate seed data', error);
  }
}

/**
 * Performance monitoring for test execution
 */
export function logTestPerformance(testName: string, startTime: number, endTime?: number) {
  if (typeof window === 'undefined' || !window.__DEV_SCHEMA_WARNINGS__) {
    return;
  }

  const duration = endTime ? endTime - startTime : Date.now() - startTime;
  const status = endTime ? 'completed' : 'started';

  console.log(`⏱️ [Test Performance] ${testName}: ${status} (${duration}ms)`);

  if (endTime && duration > 5000) {
    console.warn(`🐌 [Slow Test] ${testName} took ${duration}ms (>5s threshold)`);
  }
}
