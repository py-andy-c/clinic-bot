import React, { createContext, useContext, useEffect, useState, ReactNode, useMemo, useCallback, useRef } from 'react';
import { AuthUser, AuthState, UserRole, ClinicInfo } from '../types';
import { logger } from '../utils/logger';
import { authStorage } from '../utils/storage';
import { apiService } from '../services/api';
import { decodeJwtPayload } from '../utils/jwtUtils';

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
  // Clinic switching methods
  switchClinic: (clinicId: number) => Promise<void>;
  refreshAvailableClinics: () => Promise<void>;
  availableClinics: ClinicInfo[];
  isSwitchingClinic: boolean;
  // User data refresh
  refreshUserData: () => Promise<AuthUser>;
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
  const [availableClinics, setAvailableClinics] = useState<ClinicInfo[]>([]);
  const [isSwitchingClinic, setIsSwitchingClinic] = useState(false);
  const authInitializedRef = useRef(false);

  const clearAuthState = useCallback(() => {
    authStorage.clearAuth();
    setAuthState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  const refreshAvailableClinics = useCallback(async (userOverride?: AuthUser | null) => {
    try {
      // Use provided user or current auth state user
      const user = userOverride ?? authState.user;

      // Only fetch clinics for clinic users (system admins don't have clinics)
      if (!user || user.user_type !== 'clinic_user') {
        setAvailableClinics([]);
        return;
      }

      const response = await apiService.listAvailableClinics(false);
      setAvailableClinics(response.clinics);

      // Update user's available_clinics if user exists
      setAuthState(prev => ({
        ...prev,
        user: prev.user ? {
          ...prev.user,
          available_clinics: response.clinics,
          active_clinic_id: response.active_clinic_id ?? prev.user.active_clinic_id,
        } : null,
      }));
    } catch (error) {
      logger.error('Failed to refresh available clinics:', error);
      // Don't throw - just log the error
    }
  }, [authState.user]);

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
        const payload = decodeJwtPayload(token);

        if (!payload) {
          throw new Error('Invalid token format: failed to decode payload');
        }

        // Extract user data from JWT payload
        const userData: AuthUser = {
          user_id: payload.user_id || 0,  // Database user ID (now included in JWT)
          email: payload.email || '',
          full_name: payload.name || '',
          user_type: payload.user_type || 'clinic_user',
          roles: payload.roles || [],
          active_clinic_id: payload.active_clinic_id ?? null,
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

        // Fetch available clinics for clinic users (async, don't wait)
        if (userData.user_type === 'clinic_user') {
          // Use setTimeout to avoid calling setState during render
          // Pass userData to avoid closure issues with authState.user
          setTimeout(() => {
            refreshAvailableClinics(userData).catch(err => {
              logger.warn('Failed to fetch available clinics on OAuth callback:', err);
            });
          }, 0);
        }
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

    // Permission calculation complete

    return enhanced;
  }, [authState.user]);

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

  const switchClinic = useCallback(async (clinicId: number) => {
    if (isSwitchingClinic) {
      logger.warn('Clinic switch already in progress');
      return;
    }

    try {
      setIsSwitchingClinic(true);
      logger.log('Switching clinic', { clinicId });

      const response = await apiService.switchClinic(clinicId);

      // Update tokens if provided (idempotent case returns null)
      if (response.access_token) {
        authStorage.setAccessToken(response.access_token);
      }
      if (response.refresh_token) {
        authStorage.setRefreshToken(response.refresh_token);
      }

      // Update auth state with new clinic context
      setAuthState(prev => {
        if (!prev.user) {
          return prev;
        }

        return {
          ...prev,
          user: {
            ...prev.user,
            active_clinic_id: response.active_clinic_id,
            roles: response.roles as UserRole[],
            full_name: response.name,
          },
        };
      });

      // Refresh available clinics to get updated last_accessed_at
      await refreshAvailableClinics();

      logger.log('Clinic switched successfully', {
        clinicId: response.active_clinic_id,
        clinicName: response.clinic.name
      });
    } catch (error: any) {
      logger.error('Failed to switch clinic:', error);

      // Handle specific error cases
      if (error.response?.status === 429) {
        throw new Error('切換診所次數過於頻繁，請稍後再試');
      } else if (error.response?.status === 403) {
        throw new Error(error.response?.data?.detail || '您沒有此診所的存取權限');
      } else if (error.response?.status === 400) {
        throw new Error(error.response?.data?.detail || '無法切換診所');
      } else {
        throw new Error('切換診所失敗，請稍後再試');
      }
    } finally {
      setIsSwitchingClinic(false);
    }
  }, [isSwitchingClinic, refreshAvailableClinics]);

  const refreshUserData = useCallback(async () => {
    try {
      const response = await apiService.refreshUserData();

      // Update tokens in storage
      authStorage.setAccessToken(response.access_token);
      authStorage.setRefreshToken(response.refresh_token);

      const userData: AuthUser = {
        user_id: response.user.user_id,
        email: response.user.email,
        full_name: response.user.full_name,
        user_type: response.user.user_type,
        roles: response.user.roles || [],
        active_clinic_id: response.user.active_clinic_id,
      };

      // Update auth state with fresh user data
      setAuthState(prev => ({
        ...prev,
        user: userData,
        isAuthenticated: true,
        isLoading: false,
      }));

      return userData;
    } catch (error) {
      logger.error('Failed to refresh user data:', error);
      throw error;
    }
  }, [refreshAvailableClinics]);

  const checkAuthStatus = useCallback(async () => {
    try {
      // Prevent multiple simultaneous auth checks
      if (authState.isLoading === false && authState.user !== null) {
        logger.log('checkAuthStatus: Auth already initialized, skipping');
        return;
      }

      // Check if we have a token (access or refresh)
      const accessToken = authStorage.getAccessToken();
      const refreshToken = authStorage.getRefreshToken();

      if (accessToken || refreshToken) {
        // Proactively refresh user data to ensure we have current roles and permissions
        // This handles cases where roles were updated by an admin while user was logged in
        try {
          const userData = await refreshUserData();

          // Fetch available clinics for clinic users to populate dropdown
          if (userData && userData.user_type === 'clinic_user') {
            await refreshAvailableClinics(userData);
          }
          return;
        } catch (error) {
          logger.warn('checkAuthStatus: Failed to refresh user data, falling back to token decoding:', error);

          if (accessToken) {
            const payload = decodeJwtPayload(accessToken);
            if (!payload) {
              throw new Error('Invalid token format: failed to decode payload');
            }

            // Extract user data from JWT payload
            const userData: AuthUser = {
              user_id: payload.user_id || 0,  // Database user ID (now included in JWT)
              email: payload.email || '',
              full_name: payload.name || '',
              user_type: payload.user_type || 'clinic_user',
              roles: payload.roles || [],
              active_clinic_id: payload.active_clinic_id ?? null,
            };

            // Validate required fields
            if (!userData.email || !userData.user_type) {
              throw new Error('Invalid token: missing required fields');
            }

            logger.log('useAuth: User data decoded from JWT token (fallback after refresh failure)', {
              user_id: userData.user_id,
              email: userData.email,
              roles: userData.roles,
              active_clinic_id: userData.active_clinic_id,
              token_roles: payload.roles
            });
            setAuthState({
              user: userData,
              isAuthenticated: true,
              isLoading: false,
            });

            // Fetch available clinics for clinic users (async, don't wait)
            if (userData.user_type === 'clinic_user') {
              // Use setTimeout to avoid calling setState during render
              // Pass userData to avoid closure issues with authState.user
              setTimeout(() => {
                refreshAvailableClinics(userData).catch(err => {
                  logger.warn('Failed to fetch available clinics on auth check:', err);
                });
              }, 0);
            }

            return;
          }
        }
      }

      // If refresh failed and no valid token, set loading false
      setAuthState(prev => ({ ...prev, isLoading: false }));
    } catch (error) {
      logger.error('useAuth: Unexpected error in checkAuthStatus:', error);
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, [refreshUserData, refreshAvailableClinics, authState.isLoading, authState.user]);

  // Initial auth check on mount
  useEffect(() => {
    // Prevent multiple initialization calls
    if (authInitializedRef.current) {
      return;
    }
    authInitializedRef.current = true;

    // Skip authentication checks for signup pages
    if (window.location.pathname.startsWith('/signup/')) {
      setAuthState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    checkAuthStatus();
  }, [checkAuthStatus]);

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
    // Clinic switching
    switchClinic,
    refreshAvailableClinics,
    availableClinics,
    isSwitchingClinic,
    // User data refresh
    refreshUserData,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};