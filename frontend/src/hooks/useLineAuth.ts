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

export const useLineAuth = (lineProfile: { userId: string; displayName: string; pictureUrl?: string | undefined } | null, liffAccessToken: string | null): UseLineAuthReturn => {
  const { t } = useTranslation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [clinicId, setClinicId] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Extract clinic identifier from URL parameters (clinic_token only)
  const getClinicIdentifierFromUrl = (): { type: 'token', value: string } | null => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('clinic_token');

    if (token) return { type: 'token', value: token };
    return null;  // No clinic_id fallback - clinic_token is required
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

  // Extract clinic_token from JWT token payload
  const getClinicTokenFromToken = (token: string): string | null => {
    try {
      const parts = token.split('.');
      if (parts.length < 2 || !parts[1]) {
        return null;
      }
      const payload = JSON.parse(atob(parts[1]));
      return payload.clinic_token || null;
    } catch (e) {
      logger.error('Failed to decode JWT token:', e);
      return null;
    }
  };

  // Extract clinic_token from URL parameters
  const getClinicTokenFromUrl = (): string | null => {
    const params = new URLSearchParams(window.location.search);
    return params.get('clinic_token');
  };

  // Get clinic identifier from URL (clinic_token only)
  const getClinicIdentifier = (): { type: 'token', value: string } | null => {
    return getClinicIdentifierFromUrl();
  };

  // Get clinic_id from JWT token (clinic_id is no longer in URL)
  const getClinicId = (token?: string | null): number | null => {
    // Get from JWT token if provided
    if (token) {
      const tokenClinicId = getClinicIdFromToken(token);
      if (tokenClinicId) return tokenClinicId;
    }

    // Try localStorage token as fallback
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
    pictureUrl?: string | undefined,
    checkCancelled?: () => boolean
  ): Promise<void> => {
    if (checkCancelled?.()) return;

        setIsLoading(true);
        setError(null);

    // Get clinic_token from URL (required)
    const identifier = getClinicIdentifier();
    if (!identifier || identifier.type !== 'token') {
      logger.error('Missing clinic_token in URL - invalid LIFF access', {
        url: window.location.href,
        searchParams: Object.fromEntries(new URLSearchParams(window.location.search))
      });
      throw new Error(t('status.invalidClinicId') || 'Missing clinic identifier in URL');
    }

    const request: any = {
      line_user_id: lineUserId,
      display_name: displayName,
      liff_access_token: accessToken,
      clinic_token: identifier.value,  // Always use token
    };
    
    if (pictureUrl) {
      request.picture_url = pictureUrl;
    }

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

  /**
   * CRITICAL SECURITY: Validate clinic isolation by comparing URL clinic_token with JWT clinic_token.
   * 
   * This function MUST compare the URL's clinic_token with the JWT token's clinic_token to prevent
   * cross-clinic data access when users visit URLs for different clinics while having a cached token.
   * 
   * Why this check is critical:
   * - Backend validates the request (clinic_token), but doesn't know what's in the URL
   * - When a cached JWT exists, frontend skips authentication and uses cached token
   * - Without this check, a user with clinic 4 token visiting clinic 2 URL would access clinic 4 data
   * - This is a CRITICAL clinic isolation violation that compromises patient data privacy
   * 
   * DO NOT REMOVE THIS CHECK - even if backend validation is added, this frontend check is still
   * necessary because the backend never sees the URL, only the request body.
   * 
   * @param token - JWT token from localStorage
   * @returns true if URL clinic_token matches JWT clinic_token, false otherwise
   */
  const validateClinicIsolation = (token: string): boolean => {
    // Extract clinic_token from JWT
    const tokenClinicToken = getClinicTokenFromToken(token);
    const tokenClinicId = getClinicIdFromToken(token);
    
    if (!tokenClinicToken) {
      // Old token format (missing clinic_token) - force re-authentication
      logger.warn(
        'Old token format detected (missing clinic_token) - forcing re-authentication to get new token format'
      );
      return false;
    }
    
    if (!tokenClinicId) {
      logger.warn('Missing clinic_id in token - potential security issue');
      return false;
    }

    // Get clinic_token from URL
    const urlClinicToken = getClinicTokenFromUrl();
    
    if (!urlClinicToken) {
      // URL has no clinic_token - this shouldn't happen but err on side of caution
      logger.error('Missing clinic_token in URL - cannot validate clinic isolation');
      return false;
    }

    // Compare URL clinic_token with JWT clinic_token
    if (urlClinicToken !== tokenClinicToken) {
      logger.error(
        `CRITICAL SECURITY: Clinic token mismatch! ` +
        `URL token: ${urlClinicToken.substring(0, 20)}..., ` +
        `JWT token: ${tokenClinicToken.substring(0, 20)}... ` +
        `This indicates a clinic isolation violation - user may be accessing wrong clinic's data.`
      );
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
        // This check compares URL clinic_token with JWT clinic_token to prevent cross-clinic access
        // DO NOT REMOVE - this is the last line of defense against clinic isolation violations
        // See validateClinicIsolation function documentation for why this is critical
        if (!validateClinicIsolation(token)) {
          logger.error(
            'CRITICAL: Clinic isolation validation failed - URL clinic_token does not match JWT clinic_token. ' +
            'Clearing token and forcing re-authentication to prevent cross-clinic data access.'
          );
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
        await performAuthentication(lineProfile.userId, lineProfile.displayName, liffAccessToken, lineProfile.pictureUrl, checkCancelled);
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
  // This runs once on mount - clinicId will be set from authentication response
  // Note: We can't extract clinic_id from clinic_token without backend call, so we wait for auth
  useEffect(() => {
    // ClinicId will be set from authentication response, not from URL
    // This prevents showing InvalidAccess prematurely
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty: clinicId comes from auth response

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
