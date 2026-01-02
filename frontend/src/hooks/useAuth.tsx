import React, { createContext, useContext, useEffect, useState, useRef, ReactNode, useMemo, useCallback } from 'react';
import { AuthUser, AuthState, UserRole, UserType, ClinicInfo } from '../types';
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
  checkAuthStatus: (force?: boolean) => Promise<void>;
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
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
  
  // Use ref to store current user to avoid dependency cycles
  const userRef = useRef<AuthUser | null>(null);
  // Track last checked token to prevent unnecessary re-checks
  const lastCheckedTokenRef = useRef<string | null>(null);
  
  // Keep ref in sync with state
  useEffect(() => {
    userRef.current = authState.user;
  }, [authState.user]);

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
      // Use provided user or current user from ref (avoids dependency on authState.user)
      const user = userOverride ?? userRef.current;
      
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
  }, []); // No dependencies - uses userOverride parameter or userRef to access current state

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
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(atob(tokenParts[1]!)) as Record<string, unknown>;
        } catch (decodeError) {
          throw new Error('Invalid token format: failed to decode payload');
        }
        
        // Extract user data from JWT payload
        const userData: AuthUser = {
          user_id: (payload.user_id as number) || 0,  // Database user ID (now included in JWT)
          email: (payload.email as string) || '',
          full_name: (payload.name as string) || '',
          user_type: (payload.user_type as UserType) || 'clinic_user',
          roles: (payload.roles as UserRole[]) || [],
          active_clinic_id: (payload.active_clinic_id as number | null) ?? null,
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
  }, [clearAuthState, refreshAvailableClinics]);


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

  const checkAuthStatus = useCallback(async (force: boolean = false) => {
    try {
      // Check if we have a token (access or refresh)
      const accessToken = authStorage.getAccessToken();
      const refreshToken = authStorage.getRefreshToken();
      
      // Skip if we've already checked this token and user is authenticated (unless forced)
      // This prevents unnecessary re-checks on re-renders, but allows manual calls to force refresh
      if (!force && accessToken === lastCheckedTokenRef.current && authState.isAuthenticated && authState.user) {
        logger.debug('useAuth: Skipping auth check - token unchanged and user already authenticated');
        return;
      }
      
      // Update last checked token
      lastCheckedTokenRef.current = accessToken;
      
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
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(atob(tokenParts[1]!)) as Record<string, unknown>;
            } catch (decodeError) {
              throw new Error('Invalid token format: failed to decode payload');
            }
            
            // Extract user data from JWT payload
            const userData: AuthUser = {
              user_id: (payload.user_id as number) || 0,  // Database user ID (now included in JWT)
              email: (payload.email as string) || '',
              full_name: (payload.name as string) || '',
              user_type: (payload.user_type as UserType) || 'clinic_user',
              roles: (payload.roles as UserRole[]) || [],
              active_clinic_id: (payload.active_clinic_id as number | null) ?? null,
            };
            
            // Validate required fields
            if (!userData.email || !userData.user_type) {
              throw new Error('Invalid token: missing required fields');
            }
            
            // Only log in debug mode to reduce console noise (this runs on every auth check)
            logger.debug('useAuth: User data decoded from JWT token', { user_id: userData.user_id, email: userData.email });
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
    // We intentionally don't include authState.isAuthenticated or authState.user in deps
    // because we use refs (userRef, lastCheckedTokenRef) to avoid dependency cycles.
    // refreshAvailableClinics is stable (no deps), so checkAuthStatus is also stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshAvailableClinics]);

  // Initial auth check on mount (only run once)
  const hasCheckedAuthRef = useRef(false);
  useEffect(() => {
    // Skip authentication checks for signup pages
    if (window.location.pathname.startsWith('/signup/')) {
      setAuthState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    // Only run initial check once
    if (!hasCheckedAuthRef.current) {
      hasCheckedAuthRef.current = true;
      checkAuthStatus();
    }
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
    } catch (error: unknown) {
      logger.error('Failed to switch clinic:', error);
      
      // Handle specific error cases
      const axiosError = error as { response?: { status?: number; data?: { detail?: string } } };
      if (axiosError.response?.status === 429) {
        throw new Error('切換診所次數過於頻繁，請稍後再試');
      } else if (axiosError.response?.status === 403) {
        throw new Error(axiosError.response?.data?.detail || '您沒有此診所的存取權限');
      } else if (axiosError.response?.status === 400) {
        throw new Error(axiosError.response?.data?.detail || '無法切換診所');
      } else {
        throw new Error('切換診所失敗，請稍後再試');
      }
    } finally {
      setIsSwitchingClinic(false);
    }
  }, [isSwitchingClinic, refreshAvailableClinics]);

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
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};