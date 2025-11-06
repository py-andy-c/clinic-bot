/**
 * Centralized storage utilities for type-safe localStorage operations
 */
import { logger } from './logger';

export interface StorageOptions {
  prefix?: string;
  serialize?: boolean;
}

/**
 * Type-safe localStorage wrapper
 */
export class StorageService {
  private prefix: string;
  private serialize: boolean;

  constructor(options: StorageOptions = {}) {
    this.prefix = options.prefix || 'clinic_bot_';
    this.serialize = options.serialize !== false; // Default to true
  }

  /**
   * Get full key with prefix
   */
  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  /**
   * Set a value in localStorage
   */
  set<T>(key: string, value: T): void {
    try {
      const fullKey = this.getKey(key);
      const valueToStore = this.serialize ? JSON.stringify(value) : String(value);
      localStorage.setItem(fullKey, valueToStore);
    } catch (error) {
      logger.warn('Failed to save to localStorage:', error);
    }
  }

  /**
   * Get a value from localStorage
   */
  get<T>(key: string, defaultValue?: T): T | null {
    try {
      const fullKey = this.getKey(key);
      const item = localStorage.getItem(fullKey);

      if (item === null) {
        return defaultValue ?? null;
      }

      return this.serialize ? JSON.parse(item) : (item as unknown as T);
    } catch (error) {
      logger.warn('Failed to read from localStorage:', error);
      return defaultValue ?? null;
    }
  }

  /**
   * Remove a value from localStorage
   */
  remove(key: string): void {
    try {
      const fullKey = this.getKey(key);
      localStorage.removeItem(fullKey);
    } catch (error) {
      logger.warn('Failed to remove from localStorage:', error);
    }
  }

  /**
   * Check if a key exists in localStorage
   */
  exists(key: string): boolean {
    try {
      const fullKey = this.getKey(key);
      return localStorage.getItem(fullKey) !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clear all keys with the current prefix
   */
  clear(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.prefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      logger.warn('Failed to clear localStorage:', error);
    }
  }
}

/**
 * Auth-specific storage service
 */
export class AuthStorage extends StorageService {
  constructor() {
    super({ prefix: 'auth_' });
  }

  setAccessToken(token: string): void {
    this.set('access_token', token);
  }

  getAccessToken(): string | null {
    return this.get<string>('access_token');
  }

  removeAccessToken(): void {
    this.remove('access_token');
  }

  setRefreshToken(token: string): void {
    this.set('refresh_token', token);
  }

  getRefreshToken(): string | null {
    return this.get<string>('refresh_token');
  }

  removeRefreshToken(): void {
    this.remove('refresh_token');
  }

  setWasLoggedIn(wasLoggedIn: boolean): void {
    this.set('was_logged_in', wasLoggedIn);
  }

  getWasLoggedIn(): boolean {
    return this.get<boolean>('was_logged_in', false) || false;
  }

  removeWasLoggedIn(): void {
    this.remove('was_logged_in');
  }

  /**
   * Clear all auth-related data
   */
  clearAuth(): void {
    this.removeAccessToken();
    this.removeRefreshToken();
    this.removeWasLoggedIn();
  }
}

/**
 * LIFF-specific storage service
 */
export class LiffStorage extends StorageService {
  constructor() {
    super({ prefix: 'liff_' });
  }

  setJwtToken(token: string): void {
    this.set('jwt_token', token);
  }

  getJwtToken(): string | null {
    return this.get<string>('jwt_token');
  }

  removeJwtToken(): void {
    this.remove('jwt_token');
  }
}

/**
 * Default instances
 */
export const authStorage = new AuthStorage();
export const liffStorage = new LiffStorage();
export const appStorage = new StorageService({ prefix: 'app_' });

// Backward compatibility - keep existing localStorage usage working
// These functions use the OLD keys directly (without prefix) to maintain compatibility
// TODO: Migrate all code to use authStorage directly, then remove these functions
export const getAuthToken = (): string | null => {
  try {
    const item = localStorage.getItem('access_token');
    return item ? JSON.parse(item) : null;
  } catch {
    return null;
  }
};

export const setAuthToken = (token: string): void => {
  try {
    localStorage.setItem('access_token', JSON.stringify(token));
  } catch (error) {
    logger.warn('Failed to save access token:', error);
  }
};

export const removeAuthToken = (): void => {
  try {
    localStorage.removeItem('access_token');
  } catch (error) {
    logger.warn('Failed to remove access token:', error);
  }
};
