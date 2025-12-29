/**
 * Unit tests for URL utility functions.
 * 
 * Tests the preserveQueryParams function to ensure it correctly
 * preserves important query parameters (like clinic_token) when updating URLs.
 * 
 * Updated: Testing --changed flag behavior
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { preserveQueryParams } from '../urlUtils';

// Mock window.location
const originalLocation = window.location;

describe('preserveQueryParams', () => {
  beforeEach(() => {
    // Mock window.location.search before each test
    Object.defineProperty(window, 'location', {
      value: {
        search: '',
      },
      writable: true,
    });
  });

  afterEach(() => {
    // Restore original location after each test
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  describe('preserving clinic_token', () => {
    it('should preserve clinic_token when updating mode', () => {
      window.location.search = '?clinic_token=token_123';
      
      const result = preserveQueryParams('/liff', { mode: 'book' });
      
      expect(result).toBe('/liff?clinic_token=token_123&mode=book');
    });

    it('should preserve clinic_token and other params when updating mode', () => {
      window.location.search = '?clinic_token=token_123&foo=bar';
      
      const result = preserveQueryParams('/liff', { mode: 'book' });
      
      expect(result).toContain('clinic_token=token_123');
      expect(result).toContain('mode=book');
      // foo is not in paramsToPreserve, so it should NOT be preserved
      expect(result).not.toContain('foo=');
    });

    it('should preserve clinic_token when it is already in URL', () => {
      window.location.search = '?clinic_token=token_456&mode=query';
      
      const result = preserveQueryParams('/liff', { mode: 'book' });
      
      // mode should be updated to 'book', clinic_token should be preserved
      expect(result).toBe('/liff?clinic_token=token_456&mode=book');
    });
  });

  describe('custom parameters to preserve', () => {
    it('should preserve custom parameters', () => {
      window.location.search = '?clinic_token=token_123&user_id=789&temp=old';
      
      const result = preserveQueryParams(
        '/liff',
        { mode: 'book' },
        ['clinic_token', 'user_id']
      );
      
      expect(result).toContain('clinic_token=token_123');
      expect(result).toContain('user_id=789');
      expect(result).toContain('mode=book');
      expect(result).not.toContain('temp=old');
    });

    it('should preserve multiple custom parameters', () => {
      window.location.search = '?clinic_token=token_123&user_id=789&session_id=abc';
      
      const result = preserveQueryParams(
        '/liff',
        { mode: 'book' },
        ['clinic_token', 'user_id', 'session_id']
      );
      
      expect(result).toContain('clinic_token=token_123');
      expect(result).toContain('user_id=789');
      expect(result).toContain('session_id=abc');
      expect(result).toContain('mode=book');
    });
  });

  describe('updating parameters', () => {
    it('should update existing parameter value', () => {
      window.location.search = '?mode=query&clinic_token=token_123';
      
      const result = preserveQueryParams('/liff', { mode: 'book' });
      
      expect(result).toBe('/liff?clinic_token=token_123&mode=book');
      expect(result).not.toContain('mode=query');
    });

    it('should add new parameter if not present', () => {
      window.location.search = '?clinic_token=token_123';
      
      const result = preserveQueryParams('/liff', { mode: 'book' });
      
      expect(result).toBe('/liff?clinic_token=token_123&mode=book');
    });

    it('should set multiple new parameters', () => {
      window.location.search = '?clinic_token=token_123';
      
      const result = preserveQueryParams('/liff', {
        mode: 'book',
        step: '1',
      });
      
      expect(result).toContain('clinic_token=token_123');
      expect(result).toContain('mode=book');
      expect(result).toContain('step=1');
    });
  });

  describe('edge cases', () => {
    it('should handle empty query string', () => {
      window.location.search = '';
      
      const result = preserveQueryParams('/liff', { mode: 'book' });
      
      expect(result).toBe('/liff?mode=book');
    });

    it('should handle URL without clinic_token', () => {
      window.location.search = '?mode=query';
      
      const result = preserveQueryParams('/liff', { mode: 'book' });
      
      expect(result).toBe('/liff?mode=book');
    });

    it('should handle special characters in parameter values', () => {
      window.location.search = '?clinic_token=token_123&name=test%20user';
      
      const result = preserveQueryParams('/liff', { mode: 'book' });
      
      expect(result).toContain('clinic_token=token_123');
      // URLSearchParams.toString() encodes spaces as +, not %20
      // But when we set 'name' in paramsToPreserve, it should preserve the original encoding
      // However, URLSearchParams will decode and re-encode, so we check for clinic_token and mode
      expect(result).toContain('mode=book');
      // Verify it doesn't preserve 'name' since it's not in paramsToPreserve
      expect(result).not.toContain('name=');
    });

    it('should handle empty preserve array', () => {
      window.location.search = '?clinic_token=token_123&foo=bar';
      
      const result = preserveQueryParams('/liff', { mode: 'book' }, []);
      
      // clinic_token should NOT be preserved
      expect(result).toBe('/liff?mode=book');
    });
  });

  describe('real-world scenarios', () => {
    it('should preserve clinic_token when navigating to appointment booking', () => {
      // Simulate navigating to appointment booking while preserving clinic_token
      window.location.search = '?clinic_token=token_123';
      
      const result = preserveQueryParams(window.location.pathname, { mode: 'book' });
      
      // Should preserve clinic_token and add mode=book
      const params = new URLSearchParams(result.split('?')[1]);
      expect(params.get('clinic_token')).toBe('token_123');
      expect(params.get('mode')).toBe('book');
    });

    it('should handle navigation between modes', () => {
      // User navigates from book to query mode
      window.location.search = '?clinic_token=token_123&mode=book';
      
      const result = preserveQueryParams('/liff', { mode: 'query' });
      
      expect(result).toBe('/liff?clinic_token=token_123&mode=query');
    });
  });
});
// Pre-commit test comment
// Pre-commit test comment
