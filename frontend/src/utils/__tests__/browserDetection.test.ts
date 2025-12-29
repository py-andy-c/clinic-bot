/**
 * Testing --changed flag with multiple files
 * Unit tests for browser detection utility functions.
 * 
 * Tests the isInAppBrowser, canOpenInBrowser, and openInBrowser functions
 * to ensure they correctly detect in-app browsers and handle opening URLs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isInAppBrowser, canOpenInBrowser, openInBrowser } from '../browserDetection';

// Store original values for restoration
const originalNavigator = global.navigator;
const originalWindow = global.window;

describe('isInAppBrowser', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original navigator
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
  });

  describe('Line browser detection', () => {
    it('should detect Line browser on iOS', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/10.0.0',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(true);
    });

    it('should detect Line browser on Android', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.120 Mobile Safari/537.36 Line/11.0.0',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(true);
    });
  });

  describe('Messenger browser detection', () => {
    it('should detect Facebook Messenger', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBDV/iPhone12,1;FBMD/iPhone;FBSN/iOS;FBSV/14.0;FBSS/2;FBID/phone;FBLC/en_US;FBRV/0]',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(true);
    });

    it('should detect Facebook in-app browser (fban)', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone12,1;FBMD/iPhone;FBSN/iOS;FBSV/14.0;FBSS/2;FBID/phone;FBLC/en_US;FBRV/0]',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(true);
    });
  });

  describe('Instagram browser detection', () => {
    it('should detect Instagram in-app browser', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 123.0.0.0.0',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(true);
    });
  });

  describe('WeChat browser detection', () => {
    it('should detect WeChat browser', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.120 Mobile Safari/537.36 MicroMessenger/8.0.0',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(true);
    });
  });

  describe('Android WebView detection', () => {
    it('should detect Android WebView', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Mobile Safari/537.36 wv',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(true);
    });

    it('should not detect Chrome on Android as WebView', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36 wv',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(false);
    });
  });

  describe('iOS in-app browser detection', () => {
    it('should detect iOS in-app browser when not standalone', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        },
        writable: true,
        configurable: true,
      });

      Object.defineProperty(global, 'window', {
        value: {
          navigator: {
            standalone: false,
          },
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(true);
    });

    it('should not detect iOS Safari as in-app browser', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        },
        writable: true,
        configurable: true,
      });

      Object.defineProperty(global, 'window', {
        value: {
          navigator: {
            standalone: false,
          },
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(false);
    });

    it('should not detect Chrome iOS as in-app browser', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/91.0.4472.120 Mobile/15E148 Safari/604.1',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(false);
    });
  });

  describe('regular browser detection', () => {
    it('should not detect regular Chrome as in-app browser', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(false);
    });

    it('should not detect regular Firefox as in-app browser', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(false);
    });

    it('should not detect regular Safari as in-app browser', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
        },
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return false when window is undefined', () => {
      Object.defineProperty(global, 'window', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(false);
    });

    it('should return false when navigator is undefined', () => {
      Object.defineProperty(global, 'navigator', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      expect(isInAppBrowser()).toBe(false);
    });
  });
});

describe('canOpenInBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it('should return false for Messenger', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBDV/iPhone12,1;FBMD/iPhone;FBSN/iOS;FBSV/14.0;FBSS/2;FBID/phone;FBLC/en_US;FBRV/0]',
      },
      writable: true,
      configurable: true,
    });

    expect(canOpenInBrowser()).toBe(false);
  });

  it('should return false for Facebook in-app browser', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone12,1;FBMD/iPhone;FBSN/iOS;FBSV/14.0;FBSS/2;FBID/phone;FBLC/en_US;FBRV/0]',
      },
      writable: true,
      configurable: true,
    });

    expect(canOpenInBrowser()).toBe(false);
  });

  it('should return true for Line', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/10.0.0',
      },
      writable: true,
      configurable: true,
    });

    expect(canOpenInBrowser()).toBe(true);
  });

  it('should return true for regular browsers', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36',
      },
      writable: true,
      configurable: true,
    });

    expect(canOpenInBrowser()).toBe(true);
  });
});

describe('openInBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.location
    delete (window as any).location;
    (window as any).location = {
      href: 'https://example.com/test',
    };
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
  });

  it('should return false for Messenger', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBDV/iPhone12,1;FBMD/iPhone;FBSN/iOS;FBSV/14.0;FBSS/2;FBID/phone;FBLC/en_US;FBRV/0]',
      },
      writable: true,
      configurable: true,
    });

    const result = openInBrowser();
    expect(result).toBe(false);
    expect(window.location.href).toBe('https://example.com/test');
  });

  it('should attempt to open in Safari for iOS Line', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/10.0.0',
      },
      writable: true,
      configurable: true,
    });

    const result = openInBrowser();
    expect(result).toBe(true);
    expect(window.location.href).toBe('x-safari-https://example.com/test');
  });

  it('should attempt to open with intent for Android', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.120 Mobile Safari/537.36 Line/11.0.0',
      },
      writable: true,
      configurable: true,
    });

    // Mock document.createElement for iframe
    const iframe = {
      style: { display: '' },
      src: '',
    };
    const appendChildSpy = vi.fn();
    const removeChildSpy = vi.fn();
    const containsSpy = vi.fn(() => true);

    vi.spyOn(document, 'createElement').mockReturnValue(iframe as any);
    vi.spyOn(document.body, 'appendChild').mockImplementation(appendChildSpy);
    vi.spyOn(document.body, 'removeChild').mockImplementation(removeChildSpy);
    vi.spyOn(document.body, 'contains').mockImplementation(containsSpy);

    const result = openInBrowser();
    expect(result).toBe(true);
    expect(iframe.src).toBe('intent://example.com/test#Intent;scheme=https;action=android.intent.action.VIEW;end');
  });

  it('should attempt to open in new window for desktop', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36',
      },
      writable: true,
      configurable: true,
    });

    const openSpy = vi.spyOn(window, 'open').mockReturnValue(window);

    const result = openInBrowser();
    expect(result).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('https://example.com/test', '_blank');

    openSpy.mockRestore();
  });

  it('should return false if window.open is blocked', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36',
      },
      writable: true,
      configurable: true,
    });

    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    const result = openInBrowser();
    expect(result).toBe(false);

    openSpy.mockRestore();
  });

  it('should handle errors gracefully', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/10.0.0',
      },
      writable: true,
      configurable: true,
    });

    // Make window.location.href setter throw an error
    const originalHref = window.location.href;
    let hrefValue = originalHref;
    Object.defineProperty(window, 'location', {
      value: {
        get href() {
          return hrefValue;
        },
        set href(_) {
          throw new Error('Cannot set href');
        },
      },
      writable: true,
      configurable: true,
    });

    const result = openInBrowser();
    expect(result).toBe(false);

    // Restore
    Object.defineProperty(window, 'location', {
      value: { ...originalWindow.location, href: originalHref },
      writable: true,
      configurable: true,
    });
  });
});
