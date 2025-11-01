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

  // Consolidated authentication effect - handles all auth logic in one place
  useEffect(() => {
    let cancelled = false;

    const handleAuth = async () => {
      // First check for existing JWT token
      const token = localStorage.getItem('liff_jwt_token');
      if (token) {
        try {
          const response = await fetch(`${API_BASE_URL}/liff/patients`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (response.ok && !cancelled) {
            // Token is valid - user is authenticated
            console.log('✅ JWT token validated - user is authenticated');
            setIsAuthenticated(true);
            setIsFirstTime(false);
            const urlClinicId = getClinicIdFromUrl();
            if (urlClinicId) {
              setClinicId(urlClinicId);
            }
            setIsLoading(false);
            return;
          } else {
            // Token invalid, clear it
            localStorage.removeItem('liff_jwt_token');
          }
        } catch (error) {
          // API error, clear token
          localStorage.removeItem('liff_jwt_token');
        }
      }

      // If no valid token and we have LIFF credentials, authenticate
      if (lineProfile && liffAccessToken && !cancelled) {
        await performAuthentication(lineProfile.userId, lineProfile.displayName, liffAccessToken);
      } else if (!cancelled) {
        // No existing auth and no LIFF profile - user needs to authenticate
        setIsFirstTime(true);
        setIsLoading(false);
      }
    };

    const performAuthentication = async (lineUserId: string, displayName: string, accessToken: string) => {
      try {
        if (cancelled) return;

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

        if (!cancelled) {
          setIsAuthenticated(true);
          setIsFirstTime(response.is_first_time);
          setClinicId(response.clinic_id);
          setDisplayName(response.display_name);
        }

      } catch (err) {
        if (!cancelled) {
          console.error('LINE authentication failed:', err);
          setError(err instanceof Error ? err.message : '認證失敗');
          setIsAuthenticated(false);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    handleAuth();

    return () => { cancelled = true; };
  }, [lineProfile, liffAccessToken]); // Only depend on external inputs

  // Listen for authentication refresh events (simplified)
  useEffect(() => {
    const handleAuthRefresh = async () => {
      console.log('🔄 Auth refresh event received');
      setIsLoading(true);

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
            setIsAuthenticated(true);
            setIsFirstTime(false);
            const urlClinicId = getClinicIdFromUrl();
            if (urlClinicId) {
              setClinicId(urlClinicId);
            }
          } else {
            localStorage.removeItem('liff_jwt_token');
            setIsAuthenticated(false);
          }
        } catch (error) {
          localStorage.removeItem('liff_jwt_token');
          setIsAuthenticated(false);
        }
      }
      setIsLoading(false);
    };

    window.addEventListener('auth-refresh', handleAuthRefresh);
    return () => window.removeEventListener('auth-refresh', handleAuthRefresh);
  }, []);

  const authenticate = async (lineUserId: string, displayName: string, accessToken: string) => {
    const performAuthentication = async (userId: string, dispName: string, token: string) => {
      try {
        setIsLoading(true);
        setError(null);

        const clinicId = getClinicIdFromUrl();
        if (!clinicId) {
          throw new Error('診所ID無效，請從診所的LINE官方帳號進入');
        }

        const request = {
          line_user_id: userId,
          display_name: dispName,
          liff_access_token: token,
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

    await performAuthentication(lineUserId, displayName, accessToken);
  };

  const logout = () => {
    localStorage.removeItem('liff_jwt_token');
    setIsAuthenticated(false);
    setIsFirstTime(false);
    setClinicId(null);
    setDisplayName('');
    setError(null);
  };

  const refreshAuth = async () => {
    console.log('🔄 Auth refresh event received');
    setIsLoading(true);

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
          setIsAuthenticated(true);
          setIsFirstTime(false);
          const urlClinicId = getClinicIdFromUrl();
          if (urlClinicId) {
            setClinicId(urlClinicId);
          }
        } else {
          localStorage.removeItem('liff_jwt_token');
          setIsAuthenticated(false);
        }
      } catch (error) {
        localStorage.removeItem('liff_jwt_token');
        setIsAuthenticated(false);
      }
    }
    setIsLoading(false);
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
