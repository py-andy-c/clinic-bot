import { isMobileViewport, getViewportWidth } from '../mobileUtils';

// Mock window.innerWidth
const mockWindowWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
};

describe('mobileUtils', () => {
  beforeEach(() => {
    mockWindowWidth(1024);
  });

  describe('isMobileViewport', () => {
    it('should return false for desktop viewport (1024px)', () => {
      mockWindowWidth(1024);
      expect(isMobileViewport()).toBe(false);
    });

    it('should return true for mobile viewport (375px)', () => {
      mockWindowWidth(375);
      expect(isMobileViewport()).toBe(true);
    });

    it('should return false for tablet viewport (768px)', () => {
      mockWindowWidth(768);
      expect(isMobileViewport()).toBe(false);
    });

    it('should return true for viewport just below breakpoint (767px)', () => {
      mockWindowWidth(767);
      expect(isMobileViewport()).toBe(true);
    });

    it('should use custom breakpoint when provided', () => {
      mockWindowWidth(900);
      expect(isMobileViewport(1000)).toBe(true);
      expect(isMobileViewport(800)).toBe(false);
    });

    it('should handle SSR (window undefined)', () => {
      const originalWindow = global.window;
      // @ts-ignore - intentionally setting to undefined for test
      global.window = undefined;

      expect(isMobileViewport()).toBe(false);

      // Restore window
      global.window = originalWindow;
    });
  });

  describe('getViewportWidth', () => {
    it('should return current viewport width', () => {
      mockWindowWidth(1024);
      expect(getViewportWidth()).toBe(1024);

      mockWindowWidth(375);
      expect(getViewportWidth()).toBe(375);
    });

    it('should return 0 when window is undefined (SSR)', () => {
      const originalWindow = global.window;
      // @ts-ignore - intentionally setting to undefined for test
      global.window = undefined;

      expect(getViewportWidth()).toBe(0);

      // Restore window
      global.window = originalWindow;
    });
  });
});

