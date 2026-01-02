import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/**
 * MSW server setup for Node.js environments (e.g., Vitest)
 * 
 * Use this in Node-based tests.
 * Import and call server.listen() in your test setup.
 */
export const server = setupServer(...handlers);
