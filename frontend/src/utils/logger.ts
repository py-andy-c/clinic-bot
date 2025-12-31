// src/utils/logger.ts
import { errorTracking } from './errorTracking';

const isDevelopment = import.meta.env.DEV;

export const logger = {
  log: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },
  info: (...args: unknown[]) => {
    if (isDevelopment) {
      console.info(...args);
    }
  },
  error: (...args: unknown[]) => {
    if (isDevelopment) {
      console.error(...args);
    } else {
      // Send to error tracking service
      const error = args.find((arg) => arg instanceof Error) as Error | undefined;
      if (error) {
        errorTracking.captureException(error, {
          additionalArgs: args.filter((arg) => !(arg instanceof Error)),
        });
      } else {
        errorTracking.captureMessage(args.map(String).join(' '), 'error');
      }
    }
  },
  warn: (...args: unknown[]) => {
    if (isDevelopment) {
      console.warn(...args);
    } else {
      // Send warnings to error tracking service
      errorTracking.captureMessage(args.map(String).join(' '), 'warning');
    }
  },
};
