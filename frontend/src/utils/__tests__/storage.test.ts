import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageService, AuthStorage, LiffStorage, authStorage, liffStorage, appStorage } from '../storage';

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

  describe('StorageService', () => {
    let storage: StorageService;

    beforeEach(() => {
      storage = new StorageService({ prefix: 'test_' });
    });

    it('should set and get values with prefix', () => {
      const testData = { name: 'test', value: 123 };
      storage.set('item', testData);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'test_item',
        JSON.stringify(testData)
      );
    });

    it('should get values with default', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify({ name: 'test' }));
      const result = storage.get('item', { default: true });

      expect(result).toEqual({ name: 'test' });
    });

    it('should return default value when key not found', () => {
      localStorageMock.getItem.mockReturnValue(null);
      const result = storage.get('missing', 'default');

      expect(result).toBe('default');
    });

    it('should remove items with prefix', () => {
      storage.remove('item');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('test_item');
    });

    it('should check if key exists', () => {
      localStorageMock.getItem.mockReturnValue('value');
      expect(storage.exists('item')).toBe(true);

      localStorageMock.getItem.mockReturnValue(null);
      expect(storage.exists('missing')).toBe(false);
    });

    it('should handle JSON parsing errors gracefully', () => {
      localStorageMock.getItem.mockReturnValue('invalid json');
      const result = storage.get('item', 'default');

      expect(result).toBe('default');
    });

    it('should handle storage errors gracefully', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      // Should not throw
      expect(() => storage.set('item', 'value')).not.toThrow();
    });
  });

  describe('AuthStorage', () => {
    it('should handle access tokens', () => {
      const token = 'test-token';
      authStorage.setAccessToken(token);
      expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_access_token', JSON.stringify(token));

      localStorageMock.getItem.mockReturnValue(JSON.stringify(token));
      expect(authStorage.getAccessToken()).toBe(token);
    });

    it('should handle refresh tokens', () => {
      const token = 'refresh-token';
      authStorage.setRefreshToken(token);
      expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_refresh_token', JSON.stringify(token));

      localStorageMock.getItem.mockReturnValue(JSON.stringify(token));
      expect(authStorage.getRefreshToken()).toBe(token);
    });

    it('should handle was logged in flag', () => {
      authStorage.setWasLoggedIn(true);
      expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_was_logged_in', JSON.stringify(true));

      localStorageMock.getItem.mockReturnValue(JSON.stringify(true));
      expect(authStorage.getWasLoggedIn()).toBe(true);

      localStorageMock.getItem.mockReturnValue(null);
      expect(authStorage.getWasLoggedIn()).toBe(false);
    });

    it('should clear all auth data', () => {
      authStorage.clearAuth();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_access_token');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_refresh_token');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_was_logged_in');
    });
  });

  describe('LiffStorage', () => {
    it('should handle JWT tokens', () => {
      const token = 'liff-jwt-token';
      liffStorage.setJwtToken(token);
      expect(localStorageMock.setItem).toHaveBeenCalledWith('liff_jwt_token', JSON.stringify(token));

      localStorageMock.getItem.mockReturnValue(JSON.stringify(token));
      expect(liffStorage.getJwtToken()).toBe(token);
    });
  });

  describe('Default instances', () => {
    it('should export default instances', () => {
      expect(authStorage).toBeInstanceOf(AuthStorage);
      expect(liffStorage).toBeInstanceOf(LiffStorage);
      expect(appStorage).toBeInstanceOf(StorageService);
    });
  });

  describe('Backward compatibility', () => {
    it('should provide backward compatible functions', async () => {
      const { getAuthToken, setAuthToken, removeAuthToken } = await import('../storage');

      // Backward compatibility functions use OLD keys directly (without prefix)
      setAuthToken('test-token');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('access_token', JSON.stringify('test-token'));

      localStorageMock.getItem.mockReturnValue(JSON.stringify('test-token'));
      expect(getAuthToken()).toBe('test-token');

      removeAuthToken();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('access_token');
    });
  });
});
