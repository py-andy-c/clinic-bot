import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authStorage, liffStorage } from '../storage';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('Storage Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    localStorageMock.setItem.mockImplementation(() => {});
    localStorageMock.removeItem.mockImplementation(() => {});
  });

  describe('authStorage', () => {
    it('should set and get access token', () => {
      const token = 'test-access-token';
      authStorage.setAccessToken(token);
      expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_access_token', token);

      localStorageMock.getItem.mockReturnValue(token);
      expect(authStorage.getAccessToken()).toBe(token);
    });

    it('should set and get refresh token', () => {
      const token = 'test-refresh-token';
      authStorage.setRefreshToken(token);
      expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_refresh_token', token);

      localStorageMock.getItem.mockReturnValue(token);
      expect(authStorage.getRefreshToken()).toBe(token);
    });

    it('should remove access token', () => {
      authStorage.removeAccessToken();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_access_token');
    });

    it('should remove refresh token', () => {
      authStorage.removeRefreshToken();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_refresh_token');
    });

    it('should clear all auth data', () => {
      authStorage.clearAuth();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_access_token');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_refresh_token');
    });

    it('should return null when token not found', () => {
      localStorageMock.getItem.mockReturnValue(null);
      expect(authStorage.getAccessToken()).toBeNull();
      expect(authStorage.getRefreshToken()).toBeNull();
    });

    it('should handle storage errors gracefully', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      // Should not throw
      expect(() => authStorage.setAccessToken('token')).not.toThrow();
      expect(() => authStorage.setRefreshToken('token')).not.toThrow();
    });

    it('should handle read errors gracefully', () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('Storage read error');
      });

      // Should return null on error
      expect(authStorage.getAccessToken()).toBeNull();
      expect(authStorage.getRefreshToken()).toBeNull();
    });
  });

  describe('liffStorage', () => {
    it('should set and get JWT token', () => {
      const token = 'liff-jwt-token';
      liffStorage.setJwtToken(token);
      expect(localStorageMock.setItem).toHaveBeenCalledWith('liff_jwt_token', token);

      localStorageMock.getItem.mockReturnValue(token);
      expect(liffStorage.getJwtToken()).toBe(token);
    });

    it('should remove JWT token', () => {
      liffStorage.removeJwtToken();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('liff_jwt_token');
    });

    it('should return null when token not found', () => {
      localStorageMock.getItem.mockReturnValue(null);
      expect(liffStorage.getJwtToken()).toBeNull();
    });

    it('should handle storage errors gracefully', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      // Should not throw
      expect(() => liffStorage.setJwtToken('token')).not.toThrow();
    });

    it('should handle read errors gracefully', () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('Storage read error');
      });

      // Should return null on error
      expect(liffStorage.getJwtToken()).toBeNull();
    });
  });
});
