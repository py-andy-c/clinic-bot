/**
 * DOM Element Cache Utility
 * Caches frequently accessed DOM elements to reduce query performance overhead
 * Targets 7 frequently accessed elements as specified in design requirements
 */

interface CachedElement {
  element: Element | null;
  timestamp: number;
  selector: string;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 20; // Prevent memory leaks

class DOMCache {
  private cache = new Map<string, CachedElement>();
  private cacheKeys: string[] = [];

  /**
   * Get cached element or query and cache it
   */
  getElement(selector: string): Element | null {
    const now = Date.now();
    const cached = this.cache.get(selector);

    // Return cached element if still valid
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      // Enhanced validation: check if element still exists and matches selector
      if (cached.element && document.contains(cached.element) &&
          cached.element.matches && cached.element.matches(selector)) {
        return cached.element;
      }
      // Element no longer valid, remove from cache
      this.removeElement(selector);
    }

    // Query new element
    const element = document.querySelector(selector);
    if (element) {
      this.setElement(selector, element);
    }

    return element;
  }

  /**
   * Cache an element
   */
  private setElement(selector: string, element: Element): void {
    const now = Date.now();

    // Add to cache
    this.cache.set(selector, {
      element,
      timestamp: now,
      selector
    });

    // Maintain cache size limit (LRU eviction)
    this.cacheKeys.push(selector);
    if (this.cacheKeys.length > MAX_CACHE_SIZE) {
      const oldestKey = this.cacheKeys.shift();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
  }

  /**
   * Remove element from cache
   */
  private removeElement(selector: string): void {
    this.cache.delete(selector);
    const index = this.cacheKeys.indexOf(selector);
    if (index > -1) {
      this.cacheKeys.splice(index, 1);
    }
  }

  /**
   * Clear all cached elements
   */
  clear(): void {
    this.cache.clear();
    this.cacheKeys = [];
  }

  /**
   * Invalidate cache entries containing specific text
   */
  invalidate(pattern: string): void {
    const keysToRemove: string[] = [];
    for (const [key, cached] of this.cache.entries()) {
      if (key.includes(pattern) || cached.selector.includes(pattern)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => this.removeElement(key));
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

// Global DOM cache instance
export const domCache = new DOMCache();

// Frequently accessed element selectors (7 elements as per design requirements)
export const FREQUENTLY_ACCESSED_ELEMENTS = {
  MAIN_VIEWPORT: '#main-viewport',
  CALENDAR_GRID: '.calendarGrid',
  CALENDAR_VIEWPORT: '[data-testid="calendar-viewport"]',
  RESOURCE_HEADERS: '#resource-headers',
  TIME_LABELS: '#time-labels',
  SIDEBAR: '[data-testid="calendar-sidebar"]',
  DATE_STRIP: '[data-testid="calendar-date-strip"]',
  CURRENT_TIME_INDICATOR: '[data-testid="current-time-indicator"]'
} as const;

/**
 * Get frequently accessed DOM element with caching
 */
export function getCachedElement(key: keyof typeof FREQUENTLY_ACCESSED_ELEMENTS): Element | null {
  const selector = FREQUENTLY_ACCESSED_ELEMENTS[key];
  return domCache.getElement(selector);
}

/**
 * Batch get multiple cached elements
 */
export function getCachedElements(keys: (keyof typeof FREQUENTLY_ACCESSED_ELEMENTS)[]): Record<string, Element | null> {
  const result: Record<string, Element | null> = {};
  keys.forEach(key => {
    result[key] = getCachedElement(key);
  });
  return result;
}

/**
 * Clear DOM cache (useful for cleanup)
 */
export function clearDOMCache(): void {
  domCache.clear();
}

/**
 * Invalidate cache for calendar-related elements
 */
export function invalidateCalendarCache(): void {
  domCache.invalidate('calendar');
  domCache.invalidate('viewport');
  domCache.invalidate('sidebar');
  domCache.invalidate('date-strip');
}

// Export for testing
export { DOMCache };