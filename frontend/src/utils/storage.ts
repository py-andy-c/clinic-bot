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
