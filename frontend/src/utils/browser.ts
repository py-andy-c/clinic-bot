// Browser detection and compatibility utilities

/**
 * Detect if the current browser is Safari
 * Note: This detects Safari including iOS Safari and Safari on macOS
 * Excludes Chrome and Chromium-based browsers that may include "Safari" in user agent
 */
export const isSafari = (): boolean => {
  const userAgent = navigator.userAgent;
  const vendor = navigator.vendor;

  // Check for Safari (but not Chrome or other WebKit browsers)
  const isSafariBrowser = /^((?!chrome|android).)*safari/i.test(userAgent);

  // Additional check for Apple vendor (helps distinguish Safari from other WebKit browsers)
  const isAppleVendor = vendor && vendor.indexOf('Apple') > -1;

  return Boolean(isSafariBrowser && isAppleVendor);
};

/**
 * Detect if the current browser is iOS Safari specifically
 */
export const isIOS = (): boolean => {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
};

/**
 * Detect if the current browser is iOS Safari
 */
export const isIOSSafari = (): boolean => {
  return isIOS() && isSafari();
};

/**
 * Detect if the browser has Intelligent Tracking Prevention (Safari ITP)
 * This affects cross-domain cookie handling
 */
export const hasIntelligentTrackingPrevention = (): boolean => {
  return isSafari();
};

/**
 * Get recommended token storage strategy for the current browser
 * Safari should prefer localStorage due to ITP blocking cross-domain cookies
 */
export const getRecommendedTokenStorage = (): 'cookie' | 'localStorage' => {
  return hasIntelligentTrackingPrevention() ? 'localStorage' : 'cookie';
};

/**
 * Check if the browser supports secure cross-domain cookies
 * Safari ITP blocks these, so we should use localStorage instead
 */
export const supportsSecureCrossDomainCookies = (): boolean => {
  return !hasIntelligentTrackingPrevention();
};

/**
 * Get user-friendly guidance for authentication issues in this browser
 */
export const getAuthenticationGuidance = (): {
  title: string;
  message: string;
  suggestions: string[];
} => {
  if (isSafari()) {
    return {
      title: 'Safari Authentication Notice',
      message: 'Safari has security features that may affect login persistence. We recommend keeping this browser window open during your session.',
      suggestions: [
        'Keep this browser tab/window open during your session',
        'Avoid closing Safari completely while using the application',
        'If you experience logout issues, try refreshing the page',
        'Consider using Chrome or Firefox for better compatibility'
      ]
    };
  }

  return {
    title: 'Authentication Issue',
    message: 'We encountered an authentication problem. Please try logging in again.',
    suggestions: [
      'Try refreshing the page',
      'Clear your browser cache and cookies',
      'Try using an incognito/private browsing window'
    ]
  };
};

/**
 * Check if the browser needs special authentication handling
 */
export const requiresSpecialAuthHandling = (): boolean => {
  return hasIntelligentTrackingPrevention();
};
