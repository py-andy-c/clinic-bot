import React, { createContext, useContext, useEffect, useState, ReactNode, useMemo, useCallback } from 'react';
import { AuthUser, AuthState, UserRole } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config/env';

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

  const clearAuthState = useCallback(() => {
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
      
      // Store refresh token in localStorage as fallback (for cross-origin cookie issues)
      if (refreshToken) {
        localStorage.setItem('refresh_token', refreshToken);
        logger.log('Refresh token stored in localStorage (fallback for cookie issues)');
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
    checkAuthStatus();

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
    try {
      logger.log('Attempting to refresh token...');
      
      // Try cookie-based refresh first (preferred)
      let response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // Send httpOnly refresh token cookie
      });

      logger.log('Refresh response status (cookie attempt):', response.status);

      // If cookie-based refresh fails (401), fall back to localStorage-based refresh
      if (!response.ok && response.status === 401) {
        const refreshTokenFromStorage = localStorage.getItem('refresh_token');
        if (refreshTokenFromStorage) {
          logger.log('Cookie-based refresh failed, trying localStorage fallback...', {
            hasRefreshToken: !!refreshTokenFromStorage,
            tokenLength: refreshTokenFromStorage.length
          });
          response = await fetch(`${API_BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ refresh_token: refreshTokenFromStorage }),
            credentials: 'include',
          });
          logger.log('Refresh response status (localStorage attempt):', response.status);
          if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            logger.error('LocalStorage fallback also failed:', {
              status: response.status,
              error: errorText
            });
          }
        } else {
          logger.warn('No refresh token in localStorage for fallback');
        }
      }

      if (response.ok) {
        const data = await response.json();
        // Store new access token
        localStorage.setItem('access_token', data.access_token);
        logger.log('New access token stored');

        // Update refresh token in localStorage if provided (for cross-origin fallback)
        // The backend includes refresh_token in response when cookies don't work
        if (data.refresh_token) {
          localStorage.setItem('refresh_token', data.refresh_token);
          logger.log('New refresh token stored in localStorage');
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
          setAuthState({
            user: userData,
            isAuthenticated: true,
            isLoading: false,
          });
          logger.log('Token refresh successful, user authenticated');
        } else {
          // Token validation failed after refresh
          logger.error('Token validation failed after refresh, status:', userResponse.status);
          clearAuthState();
        }
      } else {
        // Refresh failed (401 or other error), clear auth state
        const errorText = await response.text().catch(() => 'Unknown error');
        logger.error('Token refresh failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        clearAuthState();
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
    }
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
        // Refresh if token expires within 5 minutes (300 seconds)
        // This ensures we refresh before expiry even with longer-lived tokens
        // For 60-minute tokens, this refreshes at ~55 minutes
        const EXPIRY_BUFFER_SECONDS = 300; // 5 minutes
        const isExpiringSoon = isTokenExpiredOrExpiringSoon(token, EXPIRY_BUFFER_SECONDS);
        const hasRefreshToken = !!localStorage.getItem('refresh_token');
        logger.log('Proactive refresh check:', {
          hasToken: !!token,
          wasLoggedIn,
          isExpiringSoon,
          hasRefreshToken,
        });
        
        if (isExpiringSoon) {
          // Token is expired or will expire within the buffer time, refresh it
          logger.log(`Token expiring soon (within 300s), refreshing proactively...`);
          try {
            await refreshToken();
            logger.log('Proactive refresh successful');
          } catch (error) {
            // Error is already logged in refreshToken
            logger.error('Proactive refresh failed:', error);
            // Don't clear state here as refreshToken handles that
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

  const checkAuthStatus = async () => {
    try {
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
            setAuthState({
              user: userData,
              isAuthenticated: true,
              isLoading: false,
            });
          } else {
            // Token is invalid, try refresh
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
        if (wasLoggedIn) {
          await refreshToken();
        } else {
          // User is not logged in, no need to try refresh
          setAuthState(prev => ({ ...prev, isLoading: false }));
        }
      }
    } catch (error) {
      logger.error('Auth check failed:', error);
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  };

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
