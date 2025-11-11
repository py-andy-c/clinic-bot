import React, { createContext, useContext, useEffect, useState, ReactNode, useMemo, useCallback } from 'react';
import { AuthUser, AuthState, UserRole } from '../types';
import { logger } from '../utils/logger';
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

      // Store refresh token in localStorage
      if (refreshToken) {
        authStorage.setRefreshToken(refreshToken);
        logger.log('OAuth callback - access token and refresh token stored in localStorage');
      }

      // Clean up URL (remove token and refresh_token from query params)
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);

      // Decode JWT token to get user data (eliminates need for /auth/verify call)
      try {
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) {
          throw new Error('Invalid token format: expected 3 parts');
        }
        
        // Decode base64 payload
        let payload: any;
        try {
          payload = JSON.parse(atob(tokenParts[1]!));
        } catch (decodeError) {
          throw new Error('Invalid token format: failed to decode payload');
        }
        
        // Extract user data from JWT payload
        const userData: AuthUser = {
          user_id: payload.user_id || 0,  // Database user ID (now included in JWT)
          email: payload.email || '',
          full_name: payload.name || '',
          user_type: payload.user_type || 'clinic_user',
          roles: payload.roles || [],
          clinic_id: payload.clinic_id || undefined,
        };
        
        // Validate required fields
        if (!userData.email || !userData.user_type) {
          throw new Error('Invalid token: missing required fields');
        }
        
        logger.log('OAuth callback - User data decoded from JWT token', { user_id: userData.user_id, email: userData.email });
        setAuthState({
          user: userData,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch (error) {
        logger.error('OAuth callback token decoding failed:', error);
        clearAuthState();
        // Redirect to login with delay to avoid React rendering issues
        redirectToLogin();
      }

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
      // Check if we have a token (access or refresh)
      const accessToken = authStorage.getAccessToken();
      const refreshToken = authStorage.getRefreshToken();
      
      if (accessToken || refreshToken) {
        // If we have an access token, decode it to get user data
        // If access token is invalid, the first API call will trigger refresh via interceptor
        // The interceptor will:
        // 1. Detect 401 error from the API call
        // 2. Call tokenRefreshService.refreshToken() to get new tokens (with user data)
        // 3. Retry the API call with the new access token
        // 4. If refresh fails, redirect to login
        if (accessToken) {
          try {
            // Decode JWT token to get user data (eliminates need for /auth/verify call)
            const tokenParts = accessToken.split('.');
            if (tokenParts.length !== 3) {
              throw new Error('Invalid token format: expected 3 parts');
            }
            
            // Decode base64 payload
            let payload: any;
            try {
              payload = JSON.parse(atob(tokenParts[1]!));
            } catch (decodeError) {
              throw new Error('Invalid token format: failed to decode payload');
            }
            
            // Extract user data from JWT payload
            const userData: AuthUser = {
              user_id: payload.user_id || 0,  // Database user ID (now included in JWT)
              email: payload.email || '',
              full_name: payload.name || '',
              user_type: payload.user_type || 'clinic_user',
              roles: payload.roles || [],
              clinic_id: payload.clinic_id || undefined,
            };
            
            // Validate required fields
            if (!userData.email || !userData.user_type) {
              throw new Error('Invalid token: missing required fields');
            }
            
            logger.log('useAuth: User data decoded from JWT token', { user_id: userData.user_id, email: userData.email });
            setAuthState({
              user: userData,
              isAuthenticated: true,
              isLoading: false,
            });
            return;
          } catch (error) {
            logger.warn('useAuth: Failed to decode access token, will rely on first API call to validate:', error);
            // Continue to set loading false - first API call will validate token
          }
        }
        
        // If no access token or decoding failed, just set loading false
        // The first API call will trigger refresh if needed
        setAuthState(prev => ({ ...prev, isLoading: false }));
      } else {
        // No tokens available
        setAuthState(prev => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      logger.error('useAuth: Unexpected error in checkAuthStatus:', error);
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, [clearAuthState]);

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
      window.location.href = '/admin/login';
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