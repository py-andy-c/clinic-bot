import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/**
 * MSW browser worker setup
 * 
 * Use this in development or browser-based tests.
 * Import and call worker.start() in your test setup or dev entry point.
 */
export const worker = setupWorker(...handlers);
