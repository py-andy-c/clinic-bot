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

    if (token) {
      // Handle OAuth callback - extract token and redirect
      localStorage.setItem('access_token', token);
      localStorage.setItem('was_logged_in', 'true');

      // Clean up URL
      const newUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, newUrl);

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

  const refreshToken = async (): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // Send httpOnly refresh token cookie
      });

      if (response.ok) {
        const data = await response.json();
        // Store new access token
        localStorage.setItem('access_token', data.access_token);

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
        } else {
          // Token validation failed after refresh
          clearAuthState();
        }
      } else {
        // Refresh failed (401 or other error), clear auth state
        clearAuthState();
        // Redirect to login if we're not already there
        if (!window.location.pathname.startsWith('/login')) {
          window.location.replace('/login');
        }
      }
    } catch (error) {
      logger.error('Token refresh failed:', error);
      clearAuthState();
      // Redirect to login if we're not already there
      if (!window.location.pathname.startsWith('/login')) {
        window.location.replace('/login');
      }
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

      // Call logout endpoint to revoke refresh token
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });

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
