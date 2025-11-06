// src/config/env.ts
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_LIFF_ID: string;
  readonly VITE_SENTRY_DSN?: string; // Optional: Sentry DSN for error tracking
}

function getEnv<K extends keyof ImportMetaEnv>(
  key: K,
  defaultValue?: string
): string {
  const value = import.meta.env[key] || defaultValue;

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export const config = {
  apiBaseUrl: getEnv('VITE_API_BASE_URL', '/api'),
  liffId: getEnv('VITE_LIFF_ID'),
} as const;
