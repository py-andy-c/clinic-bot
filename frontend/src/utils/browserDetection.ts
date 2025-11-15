/**
 * Detects if the current browser is an in-app browser (e.g., Line, Messenger, Facebook, Instagram, etc.)
 * These browsers often block Google OAuth due to security policies.
 * 
 * @returns true if the user is in an in-app browser, false otherwise
 */
export function isInAppBrowser(): boolean {
  if (typeof window === 'undefined' || !navigator) {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const standalone = (window.navigator as any).standalone;
  
  // Check for common in-app browser patterns (these are definitive indicators)
  const inAppPatterns = [
    'line/',           // Line app
    'messenger',       // Facebook Messenger
    'fban',            // Facebook in-app browser
    'fbav',            // Facebook in-app browser
    'fbios',           // Facebook iOS in-app browser
    'fbsv',            // Facebook in-app browser
    'instagram',       // Instagram in-app browser
    'wechat',          // WeChat
    'micromessenger',  // WeChat (Chinese)
    'qq/',             // QQ browser
    'mqqbrowser',      // QQ browser
  ];

  // Check if it's an in-app browser based on user agent
  const isInAppByUA = inAppPatterns.some(pattern => userAgent.includes(pattern));

  // Android: Check for WebView indicators (but exclude Chrome)
  // Chrome on Android has 'wv' in user agent but also has 'chrome', so we check for WebView without Chrome
  const isAndroidWebView = /android/.test(userAgent) && 
                          (userAgent.includes('wv') || userAgent.includes('webview')) &&
                          !userAgent.includes('chrome');

  // iOS: Check if it's opened from another app
  // If standalone is false, it might be in-app, but we need to be careful not to flag regular Safari
  // We only flag if there are other indicators or if it's clearly not a real browser
  const isIOS = /iphone|ipad|ipod/.test(userAgent);
  const isIOSInApp = isIOS && 
                     !standalone && 
                     !userAgent.includes('crios') && // Chrome iOS
                     !userAgent.includes('fxios') && // Firefox iOS
                     !userAgent.includes('version/'); // Regular Safari has version/ in UA

  return isInAppByUA || isAndroidWebView || isIOSInApp;
}

/**
 * Detects if the current browser is Messenger or Facebook in-app browser
 * These browsers are particularly restrictive and don't support URL schemes
 */
function isMessengerOrFacebook(): boolean {
  if (typeof window === 'undefined' || !navigator) {
    return false;
  }
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes('messenger') || 
         userAgent.includes('fban') || 
         userAgent.includes('fbav') || 
         userAgent.includes('fbios') || 
         userAgent.includes('fbsv');
}

/**
 * Checks if "open in browser" functionality will likely work
 * Returns false for browsers where we know it won't work (like Messenger)
 */
export function canOpenInBrowser(): boolean {
  return !isMessengerOrFacebook();
}

/**
 * Opens the current URL in the device's default browser
 * This is useful for in-app browsers where OAuth might be blocked
 * Returns true if the attempt was made (may still fail), false if we know it won't work
 */
export function openInBrowser(): boolean {
  const currentUrl = window.location.href;
  const userAgent = navigator.userAgent.toLowerCase();
  const isMessenger = isMessengerOrFacebook();
  
  // For Messenger/Facebook, we know it won't work, so don't try
  if (isMessenger) {
    return false;
  }
  
  // For iOS (non-Messenger), try to open in Safari
  if (/iphone|ipad|ipod/.test(userAgent)) {
    // Try Safari URL scheme (works in some in-app browsers like Line)
    // Note: x-safari-https:// scheme may not work in all contexts (e.g., some WebViews
    // or restricted environments). If it fails, the component will show URL copy fallback.
    try {
      // Use window.location.href directly for Line and other in-app browsers
      // This is more reliable than iframe approach
      window.location.href = `x-safari-https://${currentUrl.replace(/^https?:\/\//, '')}`;
      return true;
    } catch (e) {
      return false;
    }
  }
  
  // For Android (non-Messenger), try to open in default browser using intent
  if (/android/.test(userAgent)) {
    try {
      // Try Android intent URL
      const urlWithoutProtocol = currentUrl.replace(/^https?:\/\//, '');
      const intentUrl = `intent://${urlWithoutProtocol}#Intent;scheme=https;action=android.intent.action.VIEW;end`;
      
      // Use a hidden iframe to avoid navigation errors
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = intentUrl;
      document.body.appendChild(iframe);
      
      // Remove iframe after a short delay
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 100);
      
      return true;
    } catch (e) {
      return false;
    }
  }
  
  // Fallback: try to open in new window/tab
  try {
    const opened = window.open(currentUrl, '_blank');
    return opened !== null;
  } catch (e) {
    return false;
  }
}

