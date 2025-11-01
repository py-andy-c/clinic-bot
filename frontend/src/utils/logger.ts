// src/utils/logger.ts
const isDevelopment = import.meta.env.DEV;

export const logger = {
  log: (...args: any[]) => {
    if (isDevelopment) console.log(...args);
  },
  error: (...args: any[]) => {
    if (isDevelopment) {
      console.error(...args);
    } else {
      // Send to error tracking service (e.g., Sentry)
      // TODO: Integrate with error tracking service
    }
  },
  warn: (...args: any[]) => {
    if (isDevelopment) console.warn(...args);
  },
};
