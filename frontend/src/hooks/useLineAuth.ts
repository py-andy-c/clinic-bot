import { useEffect, useState, useCallback } from 'react';
import { liffApiService, LiffLoginResponse } from '../services/liffApi';
import { logger } from '../utils/logger';
import { config } from '../config/env';
import i18n from '../i18n';
import { isValidLanguage } from '../utils/languageUtils';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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

  // Shared helper: Validate existing JWT token
  const validateExistingToken = async (token: string, checkCancelled?: () => boolean): Promise<boolean> => {
        try {
          const response = await fetch(`${API_BASE_URL}/liff/patients`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

      if (checkCancelled?.()) return false;

      if (response.ok) {
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
        return true;
          } else {
            // Token invalid, clear it
            localStorage.removeItem('liff_jwt_token');
        return false;
          }
        } catch (error) {
          // API error, clear token
          localStorage.removeItem('liff_jwt_token');
      return false;
        }
  };

  // Shared helper: Authenticate with LINE profile
  const performAuthentication = async (
    lineUserId: string,
    displayName: string,
    accessToken: string,
    checkCancelled?: () => boolean
  ): Promise<void> => {
    if (checkCancelled?.()) return;

        setIsLoading(true);
        setError(null);

    // Try URL first, then JWT token as fallback
    const storedToken = localStorage.getItem('liff_jwt_token');
    const clinicId = getClinicId(storedToken);
        if (!clinicId) {
          throw new Error(t('status.invalidClinicId'));
        }

        const request = {
          line_user_id: lineUserId,
          display_name: displayName,
          liff_access_token: accessToken,
          clinic_id: clinicId,
        };

        const response: LiffLoginResponse = await liffApiService.liffLogin(request);

    if (checkCancelled?.()) return;

          setIsAuthenticated(true);
          setIsFirstTime(response.is_first_time);
          setClinicId(response.clinic_id);
          setDisplayName(response.display_name);

          // Initialize language preference from login response
          if (response.preferred_language && isValidLanguage(response.preferred_language)) {
            i18n.changeLanguage(response.preferred_language);
          } else {
            // Default to Traditional Chinese if no preference or invalid
            i18n.changeLanguage('zh-TW');
          }

    setIsLoading(false);
  };

  // Critical Security: Validate clinic isolation
  const validateClinicIsolation = (token: string): boolean => {
    const urlClinicId = getClinicIdFromUrl();
    const tokenClinicId = getClinicIdFromToken(token);

    if (!urlClinicId || !tokenClinicId) {
      // If either is missing, we can't validate - err on side of caution
      logger.warn('Missing clinic_id in URL or token - potential security issue');
      return false;
    }

    if (urlClinicId !== tokenClinicId) {
      logger.error(`CRITICAL SECURITY: Clinic ID mismatch! URL: ${urlClinicId}, Token: ${tokenClinicId}`);
      return false;
    }

    return true;
  };

  // Shared helper: Handle authentication flow (reusable by useEffect and refreshAuth)
  const handleAuth = useCallback(async (checkCancelled?: () => boolean) => {
    // First check for existing JWT token
    const token = localStorage.getItem('liff_jwt_token');
    if (token) {
      const isValid = await validateExistingToken(token, checkCancelled);
      if (isValid) {
        // CRITICAL SECURITY CHECK: Ensure clinic isolation
        if (!validateClinicIsolation(token)) {
          logger.log('Clinic isolation validation failed - clearing token and re-authenticating');
          localStorage.removeItem('liff_jwt_token');
          setClinicId(null);
          setError(t('status.clinicValidationFailed'));
          setIsAuthenticated(false);
          setIsLoading(false);
          return;
        }
        return; // Authentication successful via token
      }
    }

    // If no valid token and we have LIFF credentials, authenticate
    if (lineProfile && liffAccessToken) {
      if (checkCancelled?.()) return;

      try {
        await performAuthentication(lineProfile.userId, lineProfile.displayName, liffAccessToken, checkCancelled);
      } catch (err) {
        if (checkCancelled?.()) return;
          logger.error('LINE authentication failed:', err);
          setError(err instanceof Error ? err.message : t('status.authFailed'));
          setIsAuthenticated(false);
          setIsLoading(false);
        }
    } else {
      // No existing auth and no LIFF profile yet - wait for LIFF to initialize
      // Keep isLoading true until we have LIFF credentials to authenticate with
      // This prevents showing InvalidAccess briefly before LIFF is ready
      // clinicId is initialized from URL in a separate effect on mount
      if (checkCancelled?.()) return;
      return;
      }
  }, [lineProfile, liffAccessToken]);

  // Initialize clinicId from URL on mount to prevent showing InvalidAccess prematurely
  // This runs once on mount to extract clinic_id from URL before authentication completes
  useEffect(() => {
    const urlClinicId = getClinicIdFromUrl();
    if (urlClinicId && !clinicId) {
      setClinicId(urlClinicId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty: only run once on mount, clinicId check prevents overwriting

  // Consolidated authentication effect - handles all auth logic in one place
  useEffect(() => {
    let cancelled = false;
    const checkCancelled = () => cancelled;

    handleAuth(checkCancelled);

    return () => { cancelled = true; };
  }, [handleAuth]); // handleAuth already depends on lineProfile and liffAccessToken

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
    try {
      await performAuthentication(lineUserId, displayName, accessToken);
      } catch (err) {
        logger.error('LINE authentication failed:', err);
        setError(err instanceof Error ? err.message : t('status.authFailed'));
        setIsAuthenticated(false);
        setIsLoading(false);
      }
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
    
    // Clear error state first
    setError(null);
    setIsLoading(true);

    try {
      // Re-run the full authentication flow
      await handleAuth();
    } catch (err) {
      logger.error('Auth refresh failed:', err);
      setError(err instanceof Error ? err.message : t('status.authFailed'));
          setIsAuthenticated(false);
    setIsLoading(false);
    }
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
