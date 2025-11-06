/**
 * Error Tracking Utility
 * 
 * Provides error tracking integration with Sentry (optional).
 * If Sentry is not configured, errors are logged to console.
 * 
 * To enable Sentry:
 * 1. Install @sentry/react: npm install @sentry/react
 * 2. Set VITE_SENTRY_DSN environment variable
 * 3. Initialize Sentry in main.tsx
 */

interface ErrorTrackingService {
  init: () => void;
  captureException: (error: Error, context?: Record<string, any>) => void;
  captureMessage: (message: string, level?: 'error' | 'warning' | 'info') => void;
  setUser: (user: { id?: string; email?: string; username?: string }) => void;
  clearUser: () => void;
}

/**
 * Check if Sentry is available and configured
 */
const isSentryAvailable = (): boolean => {
  try {
    // Check if Sentry is installed and DSN is configured
    const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
    return typeof window !== 'undefined' && !!sentryDsn;
  } catch {
    return false;
  }
};

/**
 * Error tracking service implementation
 * Falls back to console logging if Sentry is not available
 */
export const errorTracking: ErrorTrackingService = {
  /**
   * Initialize error tracking
   * Should be called once in main.tsx
   */
  init: () => {
    if (!isSentryAvailable()) {
      if (import.meta.env.DEV) {
        console.log('[Error Tracking] Sentry not configured. Using console logging.');
      }
      return;
    }

    // Initialize Sentry here when @sentry/react is installed
    // Example:
    // import * as Sentry from '@sentry/react';
    // Sentry.init({
    //   dsn: import.meta.env.VITE_SENTRY_DSN,
    //   environment: import.meta.env.MODE,
    //   integrations: [new Sentry.BrowserTracing()],
    //   tracesSampleRate: 1.0,
    // });
  },

  /**
   * Capture an exception
   */
  captureException: (error: Error, context?: Record<string, any>) => {
    if (!isSentryAvailable()) {
      // Fallback to console logging
      if (import.meta.env.DEV) {
        console.error('[Error Tracking] Exception:', error);
        if (context) {
          console.error('[Error Tracking] Context:', context);
        }
      }
      return;
    }

    // When @sentry/react is installed, uncomment this:
    // import * as Sentry from '@sentry/react';
    // Sentry.captureException(error, { extra: context });
    
    // For now, just log in development
    if (import.meta.env.DEV) {
      console.error('[Error Tracking] Exception:', error);
      if (context) {
        console.error('[Error Tracking] Context:', context);
      }
    }
  },

  /**
   * Capture a message
   */
  captureMessage: (message: string, level: 'error' | 'warning' | 'info' = 'error') => {
    if (!isSentryAvailable()) {
      // Fallback to console logging
      if (import.meta.env.DEV) {
        const logMethod = level === 'error' ? console.error : level === 'warning' ? console.warn : console.info;
        logMethod(`[Error Tracking] ${level.toUpperCase()}:`, message);
      }
      return;
    }

    // When @sentry/react is installed, uncomment this:
    // import * as Sentry from '@sentry/react';
    // Sentry.captureMessage(message, { level });
    
    // For now, just log in development
    if (import.meta.env.DEV) {
      const logMethod = level === 'error' ? console.error : level === 'warning' ? console.warn : console.info;
      logMethod(`[Error Tracking] ${level.toUpperCase()}:`, message);
    }
  },

  /**
   * Set user context for error tracking
   */
  setUser: (user: { id?: string; email?: string; username?: string }) => {
    if (!isSentryAvailable()) {
      // Fallback: no-op
      if (import.meta.env.DEV) {
        console.log('[Error Tracking] Set user:', user);
      }
      return;
    }

    // When @sentry/react is installed, uncomment this:
    // import * as Sentry from '@sentry/react';
    // Sentry.setUser(user);
    
    // For now, just log in development
    if (import.meta.env.DEV) {
      console.log('[Error Tracking] Set user:', user);
    }
  },

  /**
   * Clear user context
   */
  clearUser: () => {
    if (!isSentryAvailable()) {
      // Fallback: no-op
      if (import.meta.env.DEV) {
        console.log('[Error Tracking] Cleared user');
      }
      return;
    }

    // When @sentry/react is installed, uncomment this:
    // import * as Sentry from '@sentry/react';
    // Sentry.setUser(null);
    
    // For now, just log in development
    if (import.meta.env.DEV) {
      console.log('[Error Tracking] Cleared user');
    }
  },
};

