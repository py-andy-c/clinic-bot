import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCachedElement, getCachedElements, clearDOMCache, invalidateCalendarCache } from '../domCache';

// Mock document globally for DOM cache tests
Object.defineProperty(global, 'document', {
  value: {
    querySelector: vi.fn().mockReturnValue(null), // Return null by default for non-existent elements
    contains: vi.fn().mockReturnValue(true),
  },
  configurable: true,
  writable: true,
});

describe('DOM Cache', () => {
  beforeEach(() => {
    clearDOMCache();
  });

  it('should export required functions', () => {
    expect(typeof getCachedElement).toBe('function');
    expect(typeof getCachedElements).toBe('function');
    expect(typeof clearDOMCache).toBe('function');
    expect(typeof invalidateCalendarCache).toBe('function');
  });

  it('should handle basic caching operations without throwing', () => {
    // Test that the functions don't throw errors
    expect(() => getCachedElement('#test')).not.toThrow();
    expect(() => getCachedElements(['#test'])).not.toThrow();
    expect(() => clearDOMCache()).not.toThrow();
    expect(() => invalidateCalendarCache()).not.toThrow();
  });

  it('should return null for non-existent elements', () => {
    // In a real browser, this would return null for non-existent selectors
    const result = getCachedElement('#non-existent-element');
    expect(result).toBeNull();
  });

  it('should handle multiple cached element keys', () => {
    // Test with valid keys from FREQUENTLY_ACCESSED_ELEMENTS
    const keys = ['MAIN_VIEWPORT', 'CALENDAR_GRID'] as const;
    const result = getCachedElements(keys);

    expect(typeof result).toBe('object');
    expect(result.MAIN_VIEWPORT).toBeNull(); // Will be null in test environment
    expect(result.CALENDAR_GRID).toBeNull();
  });

  it('should maintain cache state', () => {
    clearDOMCache();
    expect(() => getCachedElement('#test')).not.toThrow();

    clearDOMCache();
    expect(() => getCachedElement('#test')).not.toThrow();
  });
});