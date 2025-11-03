import { useEffect, useState } from 'react';
import { liffApiService, LiffLoginResponse } from '../services/liffApi';
import { logger } from '../utils/logger';
import { config } from '../config/env';

// Get API base URL from environment variable
const API_BASE_URL = config.apiBaseUrl;

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

  // Extract clinic_id from JWT token payload
  const getClinicIdFromToken = (token: string): number | null => {
    try {
      // Decode JWT to get clinic_id (token already contains it from backend)
      const parts = token.split('.');
      if (parts.length < 2 || !parts[1]) {
        return null;
      }
      const payload = JSON.parse(atob(parts[1]));
      return payload.clinic_id ? parseInt(payload.clinic_id, 10) : null;
    } catch (e) {
      logger.error('Failed to decode JWT token:', e);
      return null;
    }
  };

  // Get clinic_id with fallback: URL first, then JWT token
  const getClinicId = (token?: string | null): number | null => {
    // Try URL first
    const urlClinicId = getClinicIdFromUrl();
    if (urlClinicId) return urlClinicId;

    // Fallback to JWT token if provided
    if (token) {
      const tokenClinicId = getClinicIdFromToken(token);
      if (tokenClinicId) return tokenClinicId;
    }

    // Try localStorage token as last resort
    // Optimize: avoid decoding the same token twice if provided token matches localStorage token
    const storedToken = localStorage.getItem('liff_jwt_token');
    if (storedToken && storedToken !== token) {
      const storedClinicId = getClinicIdFromToken(storedToken);
      if (storedClinicId) return storedClinicId;
    }

    return null;
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
            logger.log('JWT token validated - user is authenticated');
            setIsAuthenticated(true);
            setIsFirstTime(false);
            // Try URL first, then JWT token as fallback
            const clinicIdValue = getClinicId(token);
            if (clinicIdValue) {
              setClinicId(clinicIdValue);
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

        // Try URL first, then JWT token as fallback
        const storedToken = localStorage.getItem('liff_jwt_token');
        const clinicId = getClinicId(storedToken);
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
          logger.error('LINE authentication failed:', err);
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

  // Listen for authentication refresh events
  useEffect(() => {
    const handleAuthRefresh = () => {
      logger.log('Auth refresh event received');
      // Trigger re-run of main authentication logic
      window.location.reload();
    };

    window.addEventListener('auth-refresh', handleAuthRefresh);
    return () => window.removeEventListener('auth-refresh', handleAuthRefresh);
  }, []);

  const authenticate = async (lineUserId: string, displayName: string, accessToken: string) => {
    const performAuthentication = async (userId: string, dispName: string, token: string) => {
      try {
        setIsLoading(true);
        setError(null);

        // Try URL first, then JWT token as fallback
        const storedToken = localStorage.getItem('liff_jwt_token');
        const clinicId = getClinicId(storedToken);
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
        logger.error('LINE authentication failed:', err);
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
    logger.log('Auth refresh event received');
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
          // Try URL first, then JWT token as fallback
          const clinicIdValue = getClinicId(token);
          if (clinicIdValue) {
            setClinicId(clinicIdValue);
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
