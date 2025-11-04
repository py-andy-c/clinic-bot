import React, { createContext, useContext, useEffect, useState, ReactNode, useMemo, useCallback, useRef } from 'react';
import { AuthUser, AuthState, UserRole } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config/env';
import { isSafari, getRecommendedTokenStorage, getAuthenticationGuidance } from '../utils/browser';

// Get API base URL from environment variable
const API_BASE_URL = config.apiBaseUrl;

interface AuthContextType extends AuthState {
  user: AuthUser | null;
  login: (userType?: 'system_admin' | 'clinic_user') => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  checkAuthStatus: () => Promise<void>;
  hasRole: (role: UserRole) => boolean;
  isSystemAdmin: boolean;
  isClinicAdmin: boolean;
  isPractitioner: boolean;
  isReadOnlyUser: boolean;
  isClinicUser: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });
  
  // Debug: Log component mount/unmount
  useEffect(() => {
    logger.log('DEBUG: AuthProvider mounted', {
      timestamp: new Date().toISOString(),
      initialAuthState: authState
    });
    
    return () => {
      logger.log('DEBUG: AuthProvider unmounting', {
        timestamp: new Date().toISOString(),
        finalAuthState: authState
      });
    };
  }, []);
  
  // Debug: Log auth state changes
  useEffect(() => {
    logger.log('DEBUG: Auth state changed', {
      isAuthenticated: authState.isAuthenticated,
      isLoading: authState.isLoading,
      hasUser: !!authState.user,
      userEmail: authState.user?.email,
      timestamp: new Date().toISOString(),
      stackTrace: new Error().stack?.split('\n').slice(0, 5).join('\n')
    });
  }, [authState.isAuthenticated, authState.isLoading, authState.user?.email]);

  // Ref to store checkAuthStatus function so it can be called from refreshToken
  const checkAuthStatusRef = useRef<(() => Promise<void>) | null>(null);

  // Promise-based lock to prevent concurrent refresh attempts
  const refreshTokenPromiseRef = useRef<Promise<void> | null>(null);

  const clearAuthState = useCallback(() => {
    logger.log('DEBUG: clearAuthState called', {
      timestamp: new Date().toISOString(),
      stackTrace: new Error().stack?.split('\n').slice(0, 5).join('\n')
    });
    localStorage.removeItem('access_token');
    localStorage.removeItem('was_logged_in');
    localStorage.removeItem('refresh_token'); // Clear refresh token for security
    setAuthState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  useEffect(() => {
    // Skip authentication checks for signup pages
    if (window.location.pathname.startsWith('/signup/')) {
      setAuthState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    // Check for OAuth callback tokens in URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const refreshToken = urlParams.get('refresh_token'); // Fallback for cross-origin scenarios

    if (token) {
      // Handle OAuth callback - extract token and redirect
      localStorage.setItem('access_token', token);
      localStorage.setItem('was_logged_in', 'true');
      
      const browserIsSafari = isSafari();

      // Store refresh token in localStorage
      // Safari: Always store in localStorage (primary method)
      // Non-Safari: Store in localStorage as fallback for cross-origin scenarios
      if (refreshToken) {
        localStorage.setItem('refresh_token', refreshToken);
        logger.log('OAuth callback - refresh token stored in localStorage', {
          hasAccessToken: !!localStorage.getItem('access_token'),
          hasRefreshToken: !!localStorage.getItem('refresh_token'),
          urlHasRefreshToken: !!refreshToken,
          browserIsSafari,
          storageStrategy: browserIsSafari ? 'localStorage (primary)' : 'localStorage (fallback)',
          currentOrigin: window.location.origin
        });
      } else {
        logger.warn('OAuth callback - refresh token missing from URL parameters', {
          hasAccessToken: !!token,
          browserIsSafari,
          urlParams: Array.from(urlParams.keys())
        });
      }

      // Clean up URL (remove token and refresh_token from query params)
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);

      // Validate the token and get user info
      fetch(`${API_BASE_URL}/auth/verify`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
        .then(response => {
          if (response.ok) {
            return response.json();
          } else {
            throw new Error('Token validation failed');
          }
        })
        .then(userData => {
          logger.log('OAuth callback - User data received');

          // Show Safari-specific guidance if needed
          const browserIsSafari = isSafari();
          if (browserIsSafari && !localStorage.getItem('safari_auth_warning_shown')) {
            const guidance = getAuthenticationGuidance();
            logger.log('Showing Safari authentication guidance', guidance);

            // Mark that we've shown the warning
            localStorage.setItem('safari_auth_warning_shown', 'true');

            // You could show a toast notification or modal here
            // For now, we'll just log it and rely on the console for debugging
            console.warn(`${guidance.title}: ${guidance.message}`);
            guidance.suggestions.forEach(suggestion => console.warn(`• ${suggestion}`));
          }

          setAuthState({
            user: userData,
            isAuthenticated: true,
            isLoading: false,
          });
        })
        .catch(error => {
          logger.error('OAuth callback token validation failed:', error);
          clearAuthState();
        });

      return; // Skip normal auth check
    }

    // Check if user is already authenticated on app load
    // Note: checkAuthStatus will be called after it's defined (see useEffect below)

    // Listen for storage events (e.g., when token is cleared by another tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'access_token' && !e.newValue) {
        // Token was cleared (e.g., logout in another tab)
        clearAuthState();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [clearAuthState]);

  // Helper function to decode JWT and check if token is expired or expiring soon
  const isTokenExpiredOrExpiringSoon = useCallback((token: string, bufferSeconds: number = 30): boolean => {
    try {
      // Decode JWT without verification (we only need the exp claim)
      const parts = token.split('.');
      if (parts.length !== 3 || !parts[1]) {
        return true; // Invalid token format
      }
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const payload = JSON.parse(jsonPayload);
      const exp = payload.exp; // Expiration time in seconds

      if (!exp) {
        // Token doesn't have exp claim, consider it expired
        return true;
      }

      // Check if token is expired or will expire within bufferSeconds
      const now = Math.floor(Date.now() / 1000);
      return exp <= now + bufferSeconds;
    } catch (error) {
      logger.error('Error decoding token:', error);
      // If we can't decode the token, consider it expired
      return true;
    }
  }, []);

  const refreshToken = useCallback(async (): Promise<void> => {
    // Check if refresh is already in progress - if so, wait for it
    const refreshInProgress = localStorage.getItem('_refresh_in_progress') === 'true';
    if (refreshInProgress && refreshTokenPromiseRef.current) {
      logger.log('DEBUG: Refresh already in progress, waiting for existing refresh', {
        timestamp: new Date().toISOString()
      });
      await refreshTokenPromiseRef.current;
      return; // Exit early - the existing refresh will handle it
    }

    // Create a new refresh promise and store it
    const refreshPromise = (async () => {
      try {
        // Set flag to prevent concurrent refreshes
        localStorage.setItem('_refresh_in_progress', 'true');
        
        // Enhanced logging for refresh attempt (consensus recommendation)
        const hasCookie = document.cookie.includes('refresh_token');
        const hasLocalStorage = !!localStorage.getItem('refresh_token');
        const refreshTokenValue = localStorage.getItem('refresh_token');
        const accessTokenValue = localStorage.getItem('access_token');
        const wasLoggedIn = localStorage.getItem('was_logged_in') === 'true';
        const browserIsSafari = isSafari();
        const recommendedStorage = getRecommendedTokenStorage();

        logger.log('Attempting to refresh token...', {
          hasCookie,
          hasLocalStorage,
          hasRefreshTokenValue: !!refreshTokenValue,
          hasAccessTokenValue: !!accessTokenValue,
          wasLoggedIn,
          refreshTokenLength: refreshTokenValue?.length || 0,
          browserIsSafari,
          recommendedStorage,
          apiBaseUrl: API_BASE_URL,
          currentOrigin: window.location.origin,
          userAgent: navigator.userAgent
        });

        // Storage strategy: Safari prefers localStorage, others prefer cookies
        let response;
        const shouldTryLocalStorageFirst = browserIsSafari;
        const authStrategy = shouldTryLocalStorageFirst ? 'Safari (localStorage → cookie)' : 'Standard (cookie → localStorage)';

        logger.log('Authentication strategy selected:', {
          browserIsSafari,
          shouldTryLocalStorageFirst,
          authStrategy,
          hasRefreshTokenValue: !!refreshTokenValue,
          hasCookie,
          wasLoggedIn
        });

        if (shouldTryLocalStorageFirst && refreshTokenValue) {
          // Safari: Try localStorage first
          logger.log('Safari strategy: Step 1 - attempting localStorage refresh', {
            hasRefreshToken: !!refreshTokenValue,
            tokenLength: refreshTokenValue.length,
            tokenPrefix: refreshTokenValue.substring(0, 10) + '...',
            apiBaseUrl: API_BASE_URL
          });

          try {
            const localStorageStartTime = Date.now();
            response = await fetch(`${API_BASE_URL}/auth/refresh`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ refresh_token: refreshTokenValue }),
              credentials: 'include',
            });
            const localStorageEndTime = Date.now();

            logger.log('Safari strategy: Step 1 result - localStorage attempt completed', {
              status: response.status,
              statusText: response.statusText,
              responseTime: localStorageEndTime - localStorageStartTime,
              headers: Object.fromEntries(response.headers.entries()),
              ok: response.ok
            });

            if (!response.ok) {
              logger.warn('Safari strategy: localStorage failed, proceeding to cookie fallback', {
                status: response.status,
                statusText: response.statusText,
                hasCookie
              });
            }
          } catch (localStorageError) {
            const isCorsError = localStorageError instanceof TypeError && 
              (localStorageError.message.includes('CORS') || 
               localStorageError.message.includes('access control') ||
               localStorageError.message.includes('Load failed'));
            
            logger.error('Safari strategy: Step 1 failed with exception', {
              error: localStorageError instanceof Error ? localStorageError.message : String(localStorageError),
              errorType: localStorageError instanceof Error && localStorageError.constructor ? localStorageError.constructor.name : 'Unknown',
              isCorsError,
              hasCookie,
              willAttemptCookieFallback: hasCookie
            });
            
            // If it's a CORS error, the backend might have still processed the request
            // But we can't read the response to get the new tokens
            // The old refresh token might have been revoked, so we can't retry with it
            // Instead, check if the cookie was set (even if we can't read the response)
            if (isCorsError) {
              logger.log('DEBUG: CORS error detected, checking if cookie was set', {
                hasAccessToken: !!localStorage.getItem('access_token'),
                hasCookie: document.cookie.includes('refresh_token'),
                timestamp: new Date().toISOString()
              });
              
              // Wait a moment - cookie might have been set even if response was blocked
              await new Promise(resolve => setTimeout(resolve, 200));
              
              // Check if cookie was set - if so, try cookie-based refresh
              const cookieAfterCors = document.cookie.includes('refresh_token');
              if (cookieAfterCors) {
                logger.log('DEBUG: Cookie found after CORS error - retrying with cookie', {
                  timestamp: new Date().toISOString()
                });
                try {
                  const cookieRetryResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
                    method: 'POST',
                    credentials: 'include', // Use cookie instead of old revoked token
                  });
                  
                  if (cookieRetryResponse.ok) {
                    const cookieRetryData = await cookieRetryResponse.json();
                    localStorage.setItem('access_token', cookieRetryData.access_token);
                    if (cookieRetryData.refresh_token) {
                      localStorage.setItem('refresh_token', cookieRetryData.refresh_token);
                    }
                    
                    // Validate the new token
                    const userResponse = await fetch(`${API_BASE_URL}/auth/verify`, {
                      method: 'GET',
                      headers: {
                        'Authorization': `Bearer ${cookieRetryData.access_token}`,
                      },
                    });
                    
                    if (userResponse.ok) {
                      const userData = await userResponse.json();
                      setAuthState({
                        user: userData,
                        isAuthenticated: true,
                        isLoading: false,
                      });
                      localStorage.setItem('was_logged_in', 'true');
                      logger.log('DEBUG: Cookie retry succeeded after CORS error', {
                        userEmail: userData.email,
                        timestamp: new Date().toISOString()
                      });
                      return; // Success - exit early
                    }
                  }
                } catch (cookieRetryError) {
                  logger.warn('DEBUG: Cookie retry also failed', {
                    error: cookieRetryError instanceof Error ? cookieRetryError.message : String(cookieRetryError),
                    timestamp: new Date().toISOString()
                  });
                }
              }
            }
            
            // Fall through to cookie attempt
          }
        }

        // Try cookie-based refresh (either as primary method or fallback)
        if (!response || !response.ok) {
          const stepNumber = shouldTryLocalStorageFirst ? 'Step 2' : 'Step 1';
          const strategy = shouldTryLocalStorageFirst ? 'Safari cookie fallback' : 'Standard cookie primary';

          logger.log(`${strategy}: ${stepNumber} - attempting cookie refresh`, {
            hasCookie,
            previousAttemptFailed: !!response,
            previousAttemptWasLocalStorage: shouldTryLocalStorageFirst,
            cookieNames: document.cookie.split(';').map(c => c.trim().split('=')[0]).filter(name => name && name.includes('token')),
            apiBaseUrl: API_BASE_URL
          });

          const cookieStartTime = Date.now();
          try {
            response = await fetch(`${API_BASE_URL}/auth/refresh`, {
              method: 'POST',
              credentials: 'include', // Send httpOnly refresh token cookie
            });
            const cookieEndTime = Date.now();

            logger.log(`${strategy}: ${stepNumber} result - cookie attempt completed`, {
              status: response.status,
              statusText: response.statusText,
              responseTime: cookieEndTime - cookieStartTime,
              headers: Object.fromEntries(response.headers.entries()),
              ok: response.ok,
              finalAuthStrategy: authStrategy
            });
        } catch (cookieError) {
          const isCorsError = cookieError instanceof TypeError && 
            (cookieError.message.includes('CORS') || 
             cookieError.message.includes('access control') ||
             cookieError.message.includes('Load failed'));
          
          logger.error(`${strategy}: ${stepNumber} failed with exception`, {
            error: cookieError instanceof Error ? cookieError.message : String(cookieError),
            errorType: cookieError instanceof Error && cookieError.constructor ? cookieError.constructor.name : 'Unknown',
            isCorsError,
            responseTime: Date.now() - cookieStartTime
          });
          
          // If it's a CORS error, check if we have a valid token anyway
          if (isCorsError) {
            logger.log('DEBUG: CORS error on cookie refresh, checking if we have valid token', {
              hasAccessToken: !!localStorage.getItem('access_token'),
              timestamp: new Date().toISOString()
            });
            
            // Wait a moment for any async operations to complete
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Check if we have a valid access token - backend might have succeeded despite CORS error
            const currentAccessToken = localStorage.getItem('access_token');
            if (currentAccessToken) {
              logger.log('DEBUG: Access token exists, attempting validation after CORS error', {
                timestamp: new Date().toISOString()
              });
              try {
                const verifyResponse = await fetch(`${API_BASE_URL}/auth/verify`, {
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${currentAccessToken}`,
                  },
                });
                if (verifyResponse.ok) {
                  const userData = await verifyResponse.json();
                  logger.log('DEBUG: Token validation succeeded after CORS error - refresh was successful', {
                    userEmail: userData.email,
                    timestamp: new Date().toISOString()
                  });
                  setAuthState({
                    user: userData,
                    isAuthenticated: true,
                    isLoading: false,
                  });
                  localStorage.setItem('was_logged_in', 'true');
                  return; // Success - exit early
                }
              } catch (verifyError) {
                logger.warn('DEBUG: Token validation failed after CORS error', {
                  error: verifyError instanceof Error ? verifyError.message : String(verifyError),
                  timestamp: new Date().toISOString()
                });
              }
            }
          }
          
            throw cookieError;
          }
        } else {
          logger.log('Cookie refresh skipped - previous attempt succeeded', {
            status: response.status,
            statusText: response.statusText,
            authStrategy
          });
        }

        // Fallback logic: depends on which method was tried first
        if (!response.ok && response.status === 401) {
          const refreshTokenFromStorage = localStorage.getItem('refresh_token');
          const accessTokenFromStorage = localStorage.getItem('access_token');

          if (shouldTryLocalStorageFirst) {
            // Safari: localStorage failed, and we already tried cookie as primary method
            // Since both methods failed, throw error (no duplicate cookie attempt)
            logger.error('Safari authentication failed - both localStorage and cookie methods failed', {
              authStrategy,
              localStorageAttempted: true,
              localStorageFailed: true,
              cookieAttempted: true,
              cookieFailed: true,
              finalResponseStatus: response.status,
              finalResponseStatusText: response.statusText,
              hasCookie,
              localStorageKeys: Object.keys(localStorage),
              localStorageTokenLength: localStorage.getItem('refresh_token')?.length || 0,
              wasLoggedIn,
              browserIsSafari,
              recommendedStorage,
              userAgent: navigator.userAgent,
              timestamp: new Date().toISOString(),
              sessionInfo: {
                hasAccessToken: !!localStorage.getItem('access_token'),
                hasRefreshToken: !!localStorage.getItem('refresh_token'),
                hasSafariWarningShown: !!localStorage.getItem('safari_auth_warning_shown')
              }
            });
          throw new Error(`Safari authentication failed - both storage methods failed (status: ${response.status})`);
        } else {
          // Non-Safari: Try localStorage as fallback after cookie failure
          logger.log('Non-Safari: Cookie failed (401), trying localStorage fallback...', {
            hasRefreshTokenInStorage: !!refreshTokenFromStorage,
            refreshTokenLength: refreshTokenFromStorage?.length || 0,
            hasAccessTokenInStorage: !!accessTokenFromStorage,
            accessTokenLength: accessTokenFromStorage?.length || 0,
            wasLoggedIn,
            browserIsSafari,
            localStorageKeys: Object.keys(localStorage)
          });

          if (refreshTokenFromStorage) {
            logger.log('Attempting localStorage fallback with refresh token...', {
              hasRefreshToken: !!refreshTokenFromStorage,
              tokenLength: refreshTokenFromStorage.length,
              tokenPrefix: refreshTokenFromStorage.substring(0, 20) + '...'
            });

            try {
              response = await fetch(`${API_BASE_URL}/auth/refresh`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ refresh_token: refreshTokenFromStorage }),
                credentials: 'include',
              });
              logger.log('Refresh response status (localStorage attempt):', {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries())
              });

              if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                logger.error('LocalStorage fallback failed:', {
                  status: response.status,
                  statusText: response.statusText,
                  error: errorText,
                  hasRefreshToken: !!refreshTokenFromStorage,
                  tokenLength: refreshTokenFromStorage.length,
                  browserIsSafari
                });
              }
            } catch (fetchError) {
              logger.error('LocalStorage fallback fetch error:', {
                error: fetchError,
                hasRefreshToken: !!refreshTokenFromStorage,
                browserIsSafari
              });
              throw fetchError;
            }
          } else {
            logger.warn('No refresh token in localStorage for fallback', {
              localStorageKeys: Object.keys(localStorage),
              wasLoggedIn,
              browserIsSafari
            });
          }
          }
        }

        if (response.ok) {
          const data = await response.json();
          // Store new access token with error handling
          try {
            localStorage.setItem('access_token', data.access_token);
            logger.log('New access token stored');
          } catch (storageError) {
          logger.error('Failed to store access token in localStorage:', storageError);
          throw new Error('Failed to persist authentication token');
        }

        // Always update refresh token in localStorage (backend now always includes it)
        // This ensures localStorage stays in sync with cookie and provides fallback if cookies fail
        if (data.refresh_token) {
          try {
            localStorage.setItem('refresh_token', data.refresh_token);
            const hasCookieNow = document.cookie.includes('refresh_token');
            logger.log('Token refresh successful - new refresh token stored in localStorage', {
              hasAccessToken: !!localStorage.getItem('access_token'),
              hasRefreshToken: !!localStorage.getItem('refresh_token'),
              tokenSource: hasCookieNow ? 'cookie' : 'localStorage'
            });
          } catch (storageError) {
            logger.error('Failed to store refresh token in localStorage:', storageError);
            // Don't throw here as access token was stored successfully
            logger.warn('Refresh token storage failed, but access token was stored');
          }
        } else {
          logger.warn('Refresh response missing refresh_token - this should not happen', {
            responseData: data
          });
        }

        // Validate the new token to get user data
        const userResponse = await fetch(`${API_BASE_URL}/auth/verify`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${data.access_token}`,
          },
        });

        if (userResponse.ok) {
          const userData = await userResponse.json();
          // Mark that user was successfully logged in
          localStorage.setItem('was_logged_in', 'true');
          
          // Debug: Log state before update
          logger.log('DEBUG: Before setAuthState in refreshToken', {
            currentAuthState: authState,
            newUserData: userData.email,
            timestamp: new Date().toISOString()
          });
          
          // Ensure state update (Fix 3: Enhanced logging)
          setAuthState({
            user: userData,
            isAuthenticated: true,
            isLoading: false,
          });
          
          // Debug: Log state after update (note: this won't reflect immediately due to React batching)
          logger.log('Token refresh successful, user authenticated', {
            user: userData.email,
            isAuthenticated: true,
            timestamp: new Date().toISOString(),
            userType: userData.user_type,
            roles: userData.roles,
            stateUpdateCalled: true
          });
          
          // Debug: Verify state update happened after React processes it
          setTimeout(() => {
            logger.log('DEBUG: Auth state after refresh (delayed check)', {
              hasAccessToken: !!localStorage.getItem('access_token'),
              hasRefreshToken: !!localStorage.getItem('refresh_token'),
              wasLoggedIn: localStorage.getItem('was_logged_in'),
              timestamp: new Date().toISOString()
            });
          }, 50); // Reduced from 100ms
        } else {
          // Token validation failed after refresh
          logger.error('Token validation failed after refresh, status:', userResponse.status);
          clearAuthState();
        }
      } else {
        // Refresh failed (401 or other error)
        const errorText = await response.text().catch(() => 'Unknown error');
        
        // Check if error is "token not found" - might be refresh token rotation race condition
        const isTokenNotFoundError = response.status === 401 && 
          (errorText.includes('not found') || errorText.includes('expired/revoked'));
        
        if (isTokenNotFoundError) {
          logger.log('DEBUG: Refresh failed with "token not found" - might be rotation race condition', {
            error: errorText,
            timestamp: new Date().toISOString()
          });
          
          // Wait a moment - another refresh might have succeeded and updated localStorage
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Check if we have a new token (another refresh might have succeeded)
          const newToken = localStorage.getItem('access_token');
          if (newToken && newToken !== accessTokenValue) {
            logger.log('DEBUG: New token found after "token not found" error - another refresh succeeded', {
              timestamp: new Date().toISOString()
            });
            try {
              const verifyResponse = await fetch(`${API_BASE_URL}/auth/verify`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${newToken}` },
              });
              if (verifyResponse.ok) {
                const userData = await verifyResponse.json();
                setAuthState({
                  user: userData,
                  isAuthenticated: true,
                  isLoading: false,
                });
                localStorage.setItem('was_logged_in', 'true');
                return; // Success - exit early
              }
            } catch (verifyError) {
              logger.warn('DEBUG: Token validation failed after rotation recovery', {
                error: verifyError instanceof Error ? verifyError.message : String(verifyError)
              });
            }
          }
        }
        
        logger.error('Token refresh failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          isTokenNotFoundError,
        });
        clearAuthState();
        // Safari-specific: If both storage methods failed, provide better error context
        if (browserIsSafari) {
          logger.error('Safari authentication failure - both localStorage and cookie methods failed', {
            browserIsSafari,
            recommendedStorage,
            hasCookie,
            hasLocalStorage,
            localStorageKeys: Object.keys(localStorage),
            userAgent: navigator.userAgent
          });
        }

          // Redirect to login if we're not already there
          if (!window.location.pathname.startsWith('/login')) {
            window.location.replace('/login');
          }
        }
      } catch (error) {
        logger.error('Token refresh failed with exception:', error);
        clearAuthState();
        // Redirect to login if we're not already there
        if (!window.location.pathname.startsWith('/login')) {
          window.location.replace('/login');
        }
      } finally {
        // Always clear the refresh flag and promise
        localStorage.removeItem('_refresh_in_progress');
        refreshTokenPromiseRef.current = null;
      }
    })();
    
    // Store the promise so other concurrent calls can wait for it
    refreshTokenPromiseRef.current = refreshPromise;
    
    // Wait for the refresh to complete
    await refreshPromise;
  }, [clearAuthState]);

  // Proactive token refresh: check periodically and refresh before token expires
  useEffect(() => {
    // Skip token refresh checks for signup pages
    if (window.location.pathname.startsWith('/signup/')) {
      return;
    }

    // Only set up proactive refresh if user is authenticated
    if (!authState.isAuthenticated) {
      return;
    }

    const checkAndRefreshToken = async () => {
      const token = localStorage.getItem('access_token');
      const wasLoggedIn = localStorage.getItem('was_logged_in') === 'true';

      // If we have a token and user was logged in, check if it's expired or expiring soon
      if (token && wasLoggedIn) {
        // Calculate adaptive buffer based on token lifetime
        // Buffer is 50% of remaining token lifetime, with minimum 30 seconds and maximum 30 minutes
        // This ensures we refresh before expiry for any token length
        let bufferSeconds = 30; // Default minimum buffer
        
        try {
          // Decode token to get expiry time
          const parts = token.split('.');
          if (parts.length === 3 && parts[1]) {
            const base64Url = parts[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(
              atob(base64)
                .split('')
                .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
            );
            const payload = JSON.parse(jsonPayload);
            const exp = payload.exp;
            
            if (exp) {
              const now = Math.floor(Date.now() / 1000);
              const remainingSeconds = exp - now;
              
              if (remainingSeconds > 0) {
                // Buffer is 50% of remaining time, capped between 30s and 30 minutes (1800s)
                bufferSeconds = Math.max(30, Math.min(1800, Math.floor(remainingSeconds * 0.5)));
              }
            }
          }
        } catch (error) {
          // If we can't decode, use default buffer
          logger.log('Could not calculate adaptive buffer, using default:', error);
        }
        
        const isExpiringSoon = isTokenExpiredOrExpiringSoon(token, bufferSeconds);
        const hasRefreshToken = !!localStorage.getItem('refresh_token');
        logger.log('Proactive refresh check:', {
          hasToken: !!token,
          wasLoggedIn,
          isExpiringSoon,
          hasRefreshToken,
        });
        
        if (isExpiringSoon) {
          // Check if a refresh is already in progress (e.g., from api.ts interceptor)
          // Use a simple flag in localStorage to coordinate between refresh mechanisms
          const refreshInProgress = localStorage.getItem('_refresh_in_progress') === 'true';
          
          if (refreshInProgress) {
            logger.log('Refresh already in progress, skipping proactive refresh to avoid race condition');
            return; // Skip proactive refresh if reactive refresh is already happening
          }
          
          // Token is expired or will expire within the buffer time, refresh it
          logger.log(`Token expiring soon (within ${bufferSeconds}s), refreshing proactively...`);
          try {
            // Set flag to prevent concurrent refreshes
            localStorage.setItem('_refresh_in_progress', 'true');
            await refreshToken();
            logger.log('Proactive refresh successful');
          } catch (error) {
            // Error is already logged in refreshToken
            logger.error('Proactive refresh failed:', error);
            // Don't clear state here as refreshToken handles that
          } finally {
            // Clear flag after refresh completes (success or failure)
            localStorage.removeItem('_refresh_in_progress');
          }
        } else {
          logger.log('Token still valid, no refresh needed');
        }
      } else {
        logger.log('Proactive refresh check skipped:', {
          hasToken: !!token,
          wasLoggedIn,
        });
      }
    };

    // Check immediately
    checkAndRefreshToken();

    // Check every 30 seconds for proactive refresh
    // This is frequent enough to catch expiry even with longer token lifetimes
    const CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
    const intervalId = setInterval(checkAndRefreshToken, CHECK_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [authState.isAuthenticated, isTokenExpiredOrExpiringSoon, refreshToken]);

  // Enhanced user object with role helpers
  const enhancedUser = useMemo(() => {
    if (!authState.user) return null;
    
    const enhanced = {
      ...authState.user,
      hasRole: (role: UserRole) => authState.user?.roles?.includes(role) ?? false,
      isSystemAdmin: authState.user?.user_type === 'system_admin',
      isClinicAdmin: authState.user?.user_type === 'clinic_user' && authState.user?.roles?.includes('admin'),
      isPractitioner: authState.user?.user_type === 'clinic_user' && authState.user?.roles?.includes('practitioner'),
      isReadOnlyUser: authState.user?.user_type === 'clinic_user' && (!authState.user?.roles || authState.user?.roles.length === 0),
      isClinicUser: authState.user?.user_type === 'clinic_user',
    };
    
    logger.log('Enhanced user object created:', {
      user_type: authState.user?.user_type,
      roles: authState.user?.roles,
      isSystemAdmin: enhanced.isSystemAdmin,
      isClinicAdmin: enhanced.isClinicAdmin,
      isPractitioner: enhanced.isPractitioner,
      isReadOnlyUser: enhanced.isReadOnlyUser,
      isClinicUser: enhanced.isClinicUser,
    });
    
    return enhanced;
  }, [authState.user]);

  const checkAuthStatus = useCallback(async () => {
    try {
      logger.log('DEBUG: checkAuthStatus called', {
        currentAuthState: authState,
        hasAccessToken: !!localStorage.getItem('access_token'),
        hasRefreshToken: !!localStorage.getItem('refresh_token'),
        wasLoggedIn: localStorage.getItem('was_logged_in'),
        timestamp: new Date().toISOString()
      });
      
      // Update ref so it can be called from refreshToken
      checkAuthStatusRef.current = checkAuthStatus;
      
      // Check if we have a valid access token
      const token = localStorage.getItem('access_token');
      if (token) {
        // Validate token with backend
        try {
          const response = await fetch(`${API_BASE_URL}/auth/verify`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (response.ok) {
            const userData = await response.json();
            logger.log('Token validation successful');
            
            logger.log('DEBUG: Before setAuthState in checkAuthStatus', {
              currentAuthState: authState,
              newUserData: userData.email,
              timestamp: new Date().toISOString()
            });
            
            setAuthState({
              user: userData,
              isAuthenticated: true,
              isLoading: false,
            });
            
            logger.log('DEBUG: After setAuthState in checkAuthStatus', {
              userEmail: userData.email,
              timestamp: new Date().toISOString()
            });
          } else {
            // Token is invalid, try refresh
            logger.log('DEBUG: Token validation failed, attempting refresh', {
              status: response.status,
              timestamp: new Date().toISOString()
            });
            await refreshToken();
          }
        } catch (error) {
          logger.error('Token validation failed:', error);
          // Try refresh token flow
          await refreshToken();
        }
      } else {
        // No access token in localStorage
        // Only try refresh if we have indication of previous login
        // (e.g., if this is a page reload and user was previously authenticated)
        const wasLoggedIn = localStorage.getItem('was_logged_in') === 'true';
        logger.log('DEBUG: No access token, checking wasLoggedIn', {
          wasLoggedIn,
          timestamp: new Date().toISOString()
        });
        
        if (wasLoggedIn) {
          await refreshToken();
        } else {
          // User is not logged in, no need to try refresh
          logger.log('DEBUG: No token and not logged in, setting isLoading false', {
            timestamp: new Date().toISOString()
          });
          setAuthState(prev => ({ ...prev, isLoading: false }));
        }
      }
    } catch (error) {
      logger.error('Auth check failed:', error);
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, [refreshToken]);
  
  // Update ref whenever checkAuthStatus changes
  useEffect(() => {
    checkAuthStatusRef.current = checkAuthStatus;
  }, [checkAuthStatus]);

  // Initial auth check on mount (moved here so checkAuthStatus is defined)
  useEffect(() => {
    // Skip authentication checks for signup pages
    if (window.location.pathname.startsWith('/signup/')) {
      return;
    }
    
    logger.log('DEBUG: Initial auth check on mount', {
      hasAccessToken: !!localStorage.getItem('access_token'),
      hasRefreshToken: !!localStorage.getItem('refresh_token'),
      wasLoggedIn: localStorage.getItem('was_logged_in'),
      currentAuthState: authState,
      timestamp: new Date().toISOString()
    });
    
    // Check if user is already authenticated on app load
    checkAuthStatus();
  }, [checkAuthStatus]);

  // Handle page visibility changes (Fix 2: Page Visibility API)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Tab became visible - re-check auth state
        const token = localStorage.getItem('access_token');
        const wasLoggedIn = localStorage.getItem('was_logged_in') === 'true';
        
        logger.log('DEBUG: Tab became visible (visibilitychange event)', {
          hasToken: !!token,
          wasLoggedIn,
          currentAuthState: authState,
          documentHidden: document.hidden,
          timestamp: new Date().toISOString()
        });
        
        if (token || wasLoggedIn) {
          // User was logged in, verify state
          // Add a small delay to allow CORS preflight to complete when Safari resumes
          setTimeout(() => {
            logger.log('Tab became visible - re-checking auth state (delayed)', {
              hasToken: !!token,
              wasLoggedIn,
              timestamp: new Date().toISOString()
            });
            checkAuthStatus();
          }, 200); // Reduced from 500ms to 200ms
        } else {
          logger.log('DEBUG: Tab visible but no token/wasLoggedIn - skipping auth check', {
            hasToken: !!token,
            wasLoggedIn,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        logger.log('DEBUG: Tab became hidden', {
          timestamp: new Date().toISOString()
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [checkAuthStatus, authState]);

  const login = async (userType?: 'system_admin' | 'clinic_user') => {
    try {
      setAuthState(prev => ({ ...prev, isLoading: true }));

      // Get the OAuth URL from backend first
      const params = userType ? `?user_type=${userType}` : '';
      const response = await fetch(`${API_BASE_URL}/auth/google/login${params}`);

      if (!response.ok) {
        throw new Error(`Failed to get OAuth URL: ${response.status}`);
      }

      const data = await response.json();

      // Redirect to Google OAuth
      window.location.href = data.auth_url;
    } catch (error) {
      logger.error('Login failed:', error);
      setAuthState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Clear local storage
      localStorage.removeItem('access_token');

      // Get refresh token from localStorage (fallback when cookies don't work)
      const refreshTokenFromStorage = localStorage.getItem('refresh_token');

      // Call logout endpoint to revoke refresh token
      // Try cookie-based logout first (preferred)
      let response = await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });

      // If cookie-based logout fails and we have a localStorage token, try with request body
      if (!response.ok && refreshTokenFromStorage) {
        logger.log('Cookie-based logout failed, trying localStorage fallback...');
        response = await fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refresh_token: refreshTokenFromStorage }),
          credentials: 'include',
        });
      }

      clearAuthState();

      // Redirect to login page
      window.location.href = '/login';
    } catch (error) {
      logger.error('Logout failed:', error);
      // Still clear local state even if API call fails
      clearAuthState();
    }
  };

  const hasRole = (role: UserRole): boolean => {
    return enhancedUser?.hasRole(role) ?? false;
  };

  const value: AuthContextType = {
    user: enhancedUser,
    isAuthenticated: authState.isAuthenticated,
    isLoading: authState.isLoading,
    login,
    logout,
    refreshToken,
    checkAuthStatus,
    hasRole,
    isSystemAdmin: enhancedUser?.isSystemAdmin ?? false,
    isClinicAdmin: enhancedUser?.isClinicAdmin ?? false,
    isPractitioner: enhancedUser?.isPractitioner ?? false,
    isReadOnlyUser: enhancedUser?.isReadOnlyUser ?? false,
    isClinicUser: enhancedUser?.isClinicUser ?? false,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
