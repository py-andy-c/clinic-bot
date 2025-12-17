/**
 * Simplified storage utilities for localStorage operations.
 * 
 * Direct localStorage access with consistent key naming and no serialization overhead.
 */
import { logger } from './logger';

/**
 * Auth-specific storage utilities.
 * 
 * Uses 'auth_' prefix for all keys and stores values as plain strings (no JSON serialization).
 */
export const authStorage = {
  /**
   * Set access token in localStorage
   */
  setAccessToken(token: string): void {
    try {
      localStorage.setItem('auth_access_token', token);
    } catch (error) {
      logger.warn('Failed to save access token:', error);
    }
  },

  /**
   * Get access token from localStorage
   */
  getAccessToken(): string | null {
    try {
      return localStorage.getItem('auth_access_token');
    } catch (error) {
      logger.warn('Failed to read access token:', error);
      return null;
    }
  },

  /**
   * Remove access token from localStorage
   */
  removeAccessToken(): void {
    try {
      localStorage.removeItem('auth_access_token');
    } catch (error) {
      logger.warn('Failed to remove access token:', error);
    }
  },

  /**
   * Set refresh token in localStorage
   */
  setRefreshToken(token: string): void {
    try {
      localStorage.setItem('auth_refresh_token', token);
    } catch (error) {
      logger.warn('Failed to save refresh token:', error);
    }
  },

  /**
   * Get refresh token from localStorage
   */
  getRefreshToken(): string | null {
    try {
      return localStorage.getItem('auth_refresh_token');
    } catch (error) {
      logger.warn('Failed to read refresh token:', error);
      return null;
    }
  },

  /**
   * Remove refresh token from localStorage
   */
  removeRefreshToken(): void {
    try {
      localStorage.removeItem('auth_refresh_token');
    } catch (error) {
      logger.warn('Failed to remove refresh token:', error);
    }
  },

  /**
   * Clear all auth-related data from localStorage
   */
  clearAuth(): void {
    try {
      localStorage.removeItem('auth_access_token');
      localStorage.removeItem('auth_refresh_token');
    } catch (error) {
      logger.warn('Failed to clear auth data:', error);
    }
  },
};

/**
 * LIFF-specific storage utilities.
 * 
 * Uses 'liff_' prefix for all keys and stores values as plain strings (no JSON serialization).
 */
export const liffStorage = {
  /**
   * Set JWT token in localStorage
   */
  setJwtToken(token: string): void {
    try {
      localStorage.setItem('liff_jwt_token', token);
    } catch (error) {
      logger.warn('Failed to save LIFF JWT token:', error);
    }
  },

  /**
   * Get JWT token from localStorage
   */
  getJwtToken(): string | null {
    try {
      return localStorage.getItem('liff_jwt_token');
    } catch (error) {
      logger.warn('Failed to read LIFF JWT token:', error);
      return null;
    }
  },

  /**
   * Remove JWT token from localStorage
   */
  removeJwtToken(): void {
    try {
      localStorage.removeItem('liff_jwt_token');
    } catch (error) {
      logger.warn('Failed to remove LIFF JWT token:', error);
    }
  },
};

/**
 * Calendar view state interface.
 */
export interface CalendarViewState {
  view: 'month' | 'week' | 'day';
  currentDate: string; // ISO date string (YYYY-MM-DD)
  additionalPractitionerIds: number[];
  defaultPractitionerId: number | null;
}

/**
 * Calendar-specific storage utilities.
 * 
 * Uses 'calendar_' prefix for all keys and stores values as JSON.
 * Keys are scoped by userId and clinicId: calendar_${userId}_${clinicId}
 */
export const calendarStorage = {
  /**
   * Get storage key for a user and clinic combination
   */
  getStorageKey(userId: number, clinicId: number | null): string {
    const clinicKey = clinicId ?? 'no-clinic';
    return `calendar_${userId}_${clinicKey}`;
  },

  /**
   * Get calendar view state from localStorage
   */
  getCalendarState(userId: number, clinicId: number | null): CalendarViewState | null {
    try {
      const key = this.getStorageKey(userId, clinicId);
      const stored = localStorage.getItem(key);
      if (!stored) return null;
      
      const state = JSON.parse(stored) as CalendarViewState;
      
      // Validate state structure
      if (
        (state.view === 'month' || state.view === 'week' || state.view === 'day') &&
        typeof state.currentDate === 'string' &&
        Array.isArray(state.additionalPractitionerIds) &&
        (state.defaultPractitionerId === null || typeof state.defaultPractitionerId === 'number')
      ) {
        return state;
      }
      
      logger.warn('Invalid calendar state structure, clearing');
      this.clearCalendarState(userId, clinicId);
      return null;
    } catch (error) {
      logger.warn('Failed to read calendar state:', error);
      return null;
    }
  },

  /**
   * Set calendar view state in localStorage
   */
  setCalendarState(userId: number, clinicId: number | null, state: CalendarViewState): void {
    try {
      const key = this.getStorageKey(userId, clinicId);
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      logger.warn('Failed to save calendar state:', error);
    }
  },

  /**
   * Clear calendar view state from localStorage
   */
  clearCalendarState(userId: number, clinicId: number | null): void {
    try {
      const key = this.getStorageKey(userId, clinicId);
      localStorage.removeItem(key);
    } catch (error) {
      logger.warn('Failed to clear calendar state:', error);
    }
  },

  /**
   * Get storage key for resource selection
   */
  getResourceSelectionKey(userId: number, clinicId: number | null): string {
    const clinicKey = clinicId ?? 'no-clinic';
    return `calendar_resources_${userId}_${clinicKey}`;
  },

  /**
   * Get resource selection IDs from localStorage
   */
  getResourceSelection(userId: number, clinicId: number | null): number[] {
    try {
      const key = this.getResourceSelectionKey(userId, clinicId);
      const stored = localStorage.getItem(key);
      if (!stored) return [];
      
      const ids = JSON.parse(stored);
      if (Array.isArray(ids) && ids.every(id => typeof id === 'number')) {
        return ids;
      }
      
      logger.warn('Invalid resource selection structure, clearing');
      this.setResourceSelection(userId, clinicId, []);
      return [];
    } catch (error) {
      logger.warn('Failed to read resource selection:', error);
      return [];
    }
  },

  /**
   * Set resource selection IDs in localStorage
   */
  setResourceSelection(userId: number, clinicId: number | null, ids: number[]): void {
    try {
      const key = this.getResourceSelectionKey(userId, clinicId);
      localStorage.setItem(key, JSON.stringify(ids));
    } catch (error) {
      logger.warn('Failed to save resource selection:', error);
    }
  },

  /**
   * Clear resource selection from localStorage
   */
  clearResourceSelection(userId: number, clinicId: number | null): void {
    try {
      const key = this.getResourceSelectionKey(userId, clinicId);
      localStorage.removeItem(key);
    } catch (error) {
      logger.warn('Failed to clear resource selection:', error);
    }
  },
};
