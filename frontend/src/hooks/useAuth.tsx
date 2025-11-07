import React, { createContext, useContext, useEffect, useState, ReactNode, useMemo, useCallback } from 'react';
import { AuthUser, AuthState, UserRole } from '../types';
import { logger } from '../utils/logger';
import { tokenRefreshService } from '../services/tokenRefresh';
import { authStorage } from '../utils/storage';
import { apiService } from '../services/api';

/**
 * Redirect to login page with delay to avoid interrupting React rendering.
 * 
 * Uses requestAnimationFrame to ensure React has finished rendering before redirecting,
 * preventing "useAuth must be used within an AuthProvider" errors.
 */
const redirectToLogin = (): void => {
  requestAnimationFrame(() => {
    window.location.replace('/login');
  });
};

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
    authStorage.clearAuth();
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
    const refreshToken = urlParams.get('refresh_token');

    if (token) {
      // Handle OAuth callback - extract token and redirect
      authStorage.setAccessToken(token);
      authStorage.setWasLoggedIn(true);

      // Store refresh token in localStorage
      if (refreshToken) {
        authStorage.setRefreshToken(refreshToken);
        logger.log('OAuth callback - access token and refresh token stored in localStorage');
      }

      // Clean up URL (remove token and refresh_token from query params)
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);

      // Validate the token and get user info using axios client
      // This goes through the axios interceptor which handles token refresh automatically
      apiService.verifyToken()
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
          // Redirect to login with delay to avoid React rendering issues
          redirectToLogin();
        });

      return; // Skip normal auth check
    }

    // Check if user is already authenticated on app load
    // Note: checkAuthStatus will be called after it's defined (see useEffect below)

    // Listen for storage events (e.g., when token is cleared by another tab)
    const handleStorageChange = (e: StorageEvent) => {
      // Check for auth_ prefixed keys (used by authStorage)
      if (e.key === 'auth_access_token' && !e.newValue) {
        // Token was cleared (e.g., logout in another tab)
        clearAuthState();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [clearAuthState]);

  const refreshToken = useCallback(async (): Promise<void> => {
    try {
      logger.log('useAuth: Starting token refresh...');
      // Use centralized token refresh service
      // Don't validate token here - just refresh and update state
      // Validation will happen when we check auth status
      await tokenRefreshService.refreshToken({
        validateToken: false,
      });

      // Get user data by validating the new token
      const newToken = authStorage.getAccessToken();
      if (!newToken) {
        throw new Error('No access token after refresh');
      }

      logger.log('useAuth: Token refreshed, validating new token...');
      // Validate the new token to get user data using axios client
      // This goes through the axios interceptor which handles token refresh automatically
      const userData = await apiService.verifyToken();

      setAuthState({
        user: userData,
        isAuthenticated: true,
        isLoading: false,
      });
      logger.log('useAuth: Token refresh and validation successful');
    } catch (error) {
      logger.error('useAuth: Token refresh failed:', error);
      clearAuthState();
      // Redirect to login if we're not already there
      // Use delayed redirect to avoid React rendering issues
      if (!window.location.pathname.startsWith('/login')) {
        redirectToLogin();
      }
    }
  }, [clearAuthState]);

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

    return enhanced;
  }, [authState.user]);

  const checkAuthStatus = useCallback(async () => {
    try {
      // Check if we have a valid access token
      const token = authStorage.getAccessToken();
      if (token) {
        // Validate token with backend using axios client
        // This goes through the axios interceptor which handles token refresh automatically
        try {
          const userData = await apiService.verifyToken();

          setAuthState({
            user: userData,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          // Token is invalid, try refresh
          // The axios interceptor should have already attempted refresh, but if it failed,
          // we try again here
          try {
            await refreshToken();
          } catch (refreshError) {
            // If refresh also fails, clear auth state and redirect to login
            // This ensures consistent behavior across all error paths
            logger.error('useAuth: Token refresh failed in checkAuthStatus:', refreshError);
            clearAuthState();
            if (!window.location.pathname.startsWith('/login')) {
              redirectToLogin();
            } else {
              setAuthState(prev => ({ ...prev, isLoading: false }));
            }
          }
        }
      } else {
        // No access token
        const wasLoggedIn = authStorage.getWasLoggedIn();
        if (wasLoggedIn) {
          try {
            await refreshToken();
          } catch (refreshError) {
            // If refresh fails, clear auth state and redirect to login
            // This ensures consistent behavior across all error paths
            logger.error('useAuth: Token refresh failed in checkAuthStatus:', refreshError);
            clearAuthState();
            if (!window.location.pathname.startsWith('/login')) {
              redirectToLogin();
            } else {
              setAuthState(prev => ({ ...prev, isLoading: false }));
            }
          }
        } else {
          setAuthState(prev => ({ ...prev, isLoading: false }));
        }
      }
    } catch (error) {
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, [refreshToken]);

  // Initial auth check on mount
  useEffect(() => {
    // Skip authentication checks for signup pages
    if (window.location.pathname.startsWith('/signup/')) {
      setAuthState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    checkAuthStatus();
  }, [checkAuthStatus]);

  const login = async (userType?: 'system_admin' | 'clinic_user') => {
    try {
      setAuthState(prev => ({ ...prev, isLoading: true }));

      // Get the OAuth URL from backend using axios client
      const data = await apiService.initiateGoogleAuth(userType);

      // Redirect to Google OAuth
      window.location.href = data.auth_url;
    } catch (error) {
      setAuthState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Call logout endpoint to revoke refresh token
      // apiService.logout() will get the refresh token and clear storage
      await apiService.logout();

      clearAuthState();

      // Redirect to login page
      window.location.href = '/login';
    } catch (error) {
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