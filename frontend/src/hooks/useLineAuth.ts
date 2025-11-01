import { useEffect, useState } from 'react';
import { liffApiService, LiffLoginResponse } from '../services/liffApi';

// Get API base URL from environment variable
const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '/api';

interface UseLineAuthReturn {
  isAuthenticated: boolean;
  isFirstTime: boolean;
  isLoading: boolean;
  clinicId: number | null;
  displayName: string;
  error: string | null;
  authenticate: (lineUserId: string, displayName: string, accessToken: string) => Promise<void>;
  logout: () => void;
  refreshAuth: () => Promise<void>;
}

export const useLineAuth = (lineProfile: { userId: string; displayName: string } | null, liffAccessToken: string | null): UseLineAuthReturn => {
  // Check if we have existing authentication first (prioritize JWT token over LIFF profile)
  const checkExistingAuthFirst = async () => {
    const token = localStorage.getItem('liff_jwt_token');
    if (token) {
      try {
        const response = await fetch(`${API_BASE_URL}/liff/patients`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.ok) {
          // Token is valid - user is authenticated
          console.log('✅ JWT token validated - user is authenticated');
          setIsAuthenticated(true);
          setIsFirstTime(false);
          const urlClinicId = getClinicIdFromUrl();
          if (urlClinicId) {
            setClinicId(urlClinicId);
          }
          setIsLoading(false);
          return true; // Found valid existing auth
        } else {
          // Token invalid, clear it
          localStorage.removeItem('liff_jwt_token');
        }
      } catch (error) {
        // API error, clear token
        localStorage.removeItem('liff_jwt_token');
      }
    }
    return false; // No valid existing auth found
  };
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [clinicId, setClinicId] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Extract clinic_id from URL parameters
  const getClinicIdFromUrl = (): number | null => {
    const urlParams = new URLSearchParams(window.location.search);
    const clinicIdParam = urlParams.get('clinic_id');
    return clinicIdParam ? parseInt(clinicIdParam, 10) : null;
  };

  // Function to check authentication status

  // Check if user is already authenticated on mount and when URL changes
  useEffect(() => {
    const initAuth = async () => {
      // First check for existing JWT token (from previous sessions/registrations)
      const hasExistingAuth = await checkExistingAuthFirst();

      // If no existing auth, check if we have LIFF profile for new authentication
      if (!hasExistingAuth) {
        if (lineProfile && liffAccessToken) {
          // New user - trigger LIFF authentication
          await authenticate(lineProfile.userId, lineProfile.displayName, liffAccessToken);
        } else {
          // No existing auth and no LIFF profile - user needs to authenticate
          setIsFirstTime(true);
          setIsLoading(false);
        }
      }
    };

    initAuth();
  }, [lineProfile, liffAccessToken]);

  // Listen for authentication refresh events (e.g., after registration)
  useEffect(() => {
    const handleAuthRefresh = async () => {
      console.log('🔄 Auth refresh event received');
      await checkExistingAuthFirst();
    };

    window.addEventListener('auth-refresh', handleAuthRefresh);
    return () => window.removeEventListener('auth-refresh', handleAuthRefresh);
  }, []);

  const authenticate = async (lineUserId: string, displayName: string, accessToken: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const clinicId = getClinicIdFromUrl();
      if (!clinicId) {
        throw new Error('診所ID無效，請從診所的LINE官方帳號進入');
      }

      const request = {
        line_user_id: lineUserId,
        display_name: displayName,
        liff_access_token: accessToken,
        clinic_id: clinicId,
      };

      const response: LiffLoginResponse = await liffApiService.liffLogin(request);

      setIsAuthenticated(true);
      setIsFirstTime(response.is_first_time);
      setClinicId(response.clinic_id);
      setDisplayName(response.display_name);

    } catch (err) {
      console.error('LINE authentication failed:', err);
      setError(err instanceof Error ? err.message : '認證失敗');
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-authenticate when LIFF profile is available
  useEffect(() => {
    if (lineProfile && liffAccessToken && !isAuthenticated && !isLoading) {
      authenticate(lineProfile.userId, lineProfile.displayName, liffAccessToken);
    }
  }, [lineProfile, liffAccessToken, isAuthenticated, isLoading]);

  const logout = () => {
    localStorage.removeItem('liff_jwt_token');
    setIsAuthenticated(false);
    setIsFirstTime(false);
    setClinicId(null);
    setDisplayName('');
    setError(null);
  };

  const refreshAuth = async () => {
    setIsLoading(true);
    await checkExistingAuthFirst();
  };

  return {
    isAuthenticated,
    isFirstTime,
    isLoading,
    clinicId,
    displayName,
    error,
    authenticate,
    logout,
    refreshAuth,
  };
};
