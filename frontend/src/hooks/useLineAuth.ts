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

export const useLineAuth = (lineProfile: { userId: string; displayName: string; pictureUrl?: string | undefined } | null, liffAccessToken: string | null, liff?: { init: (config: { liffId: string }) => Promise<void>; login: () => void; logout: () => void; getProfile: () => Promise<{ userId: string; displayName: string; pictureUrl?: string; statusMessage?: string }>; getAccessToken: () => string | null; isLoggedIn: () => boolean; isInClient: () => boolean; [key: string]: unknown }): UseLineAuthReturn => {
  const { t } = useTranslation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [clinicId, setClinicId] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Extract clinic identifier from URL parameters (liff_id or clinic_token)
  const getClinicIdentifierFromUrl = (): { type: 'liff_id' | 'token', value: string } | null => {
    const params = new URLSearchParams(window.location.search);
    const liffId = params.get('liff_id');
    const token = params.get('clinic_token');

    if (liffId) return { type: 'liff_id', value: liffId };
    if (token) return { type: 'token', value: token };
    return null;
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

  // Extract liff_id from JWT token payload
  const getLiffIdFromToken = (token: string): string | null => {
    try {
      const parts = token.split('.');
      if (parts.length < 2 || !parts[1]) {
        return null;
      }
      const payload = JSON.parse(atob(parts[1]));
      return payload.liff_id || null;
    } catch (e) {
      logger.error('Failed to decode JWT token:', e);
      return null;
    }
  };


  // Get clinic identifier from URL (liff_id or clinic_token)
  const getClinicIdentifier = (): { type: 'liff_id' | 'token', value: string } | null => {
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
    liff?: typeof import('@line/liff') | null,
    checkCancelled?: () => boolean
  ): Promise<void> => {
    if (checkCancelled?.()) return;

        setIsLoading(true);
        setError(null);

    // Get clinic identifier from URL (liff_id or clinic_token)
    const identifier = getClinicIdentifier();
    if (!identifier) {
      logger.error('Missing clinic identifier in URL - invalid LIFF access', {
        url: window.location.href,
        searchParams: Object.fromEntries(new URLSearchParams(window.location.search))
      });
      throw new Error(t('status.invalidClinicId') || 'Missing clinic identifier in URL');
    }

    // For clinic-specific LIFF apps: get liff_id from getContext() (authoritative source)
    // For shared LIFF app: use clinic_token from URL
    let liffId: string | null = null;
    if (identifier.type === 'liff_id' && liff) {
      try {
        // Use liff.getContext() if available (LINE SDK method)
        const context = (liff as any).getContext?.();
        liffId = context?.liffId || null;
        if (liffId && liffId !== identifier.value) {
          logger.warn(`LIFF ID mismatch: URL has ${identifier.value}, getContext() has ${liffId}. Using getContext() value.`);
        }
        if (!liffId) {
          // Fallback to URL parameter if getContext() not available
          liffId = identifier.value;
        }
      } catch (e) {
        logger.warn('Failed to get LIFF context, using URL parameter:', e);
        liffId = identifier.value;
      }
    }

    const request: { line_user_id: string; display_name: string; [key: string]: unknown } = {
      line_user_id: lineUserId,
      display_name: displayName,
      liff_access_token: accessToken,
    };

    // Add clinic identifier: liff_id for clinic-specific apps, clinic_token for shared LIFF
    if (liffId) {
      request.liff_id = liffId;
    } else if (identifier.type === 'token') {
      request.clinic_token = identifier.value;
    }

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
   * CRITICAL SECURITY: Validate clinic isolation by comparing URL identifier with JWT identifier.
   *
   * This function MUST compare the URL's clinic identifier (liff_id or clinic_token) with the JWT token's
   * identifier to prevent cross-clinic data access when users visit URLs for different clinics while
   * having a cached token.
   *
   * Why this check is critical:
   * - Backend validates the request, but doesn't know what's in the URL
   * - When a cached JWT exists, frontend skips authentication and uses cached token
   * - Without this check, a user with clinic 4 token visiting clinic 2 URL would access clinic 4 data
   * - This is a CRITICAL clinic isolation violation that compromises patient data privacy
   *
   * DO NOT REMOVE THIS CHECK - even if backend validation is added, this frontend check is still
   * necessary because the backend never sees the URL, only the request body.
   *
   * @param token - JWT token from localStorage
   * @param liff - Optional LIFF instance to get authoritative liff_id from getContext()
   * @returns true if URL identifier matches JWT identifier, false otherwise
   */
  const validateClinicIsolation = (token: string, liff?: typeof import('@line/liff') | null): boolean => {
    const tokenLiffId = getLiffIdFromToken(token);
    const tokenClinicToken = getClinicTokenFromToken(token);
    const tokenClinicId = getClinicIdFromToken(token);

    if (!tokenLiffId && !tokenClinicToken) {
      // Old token format (missing both identifiers) - force re-authentication
      logger.warn(
        'Old token format detected (missing liff_id and clinic_token) - forcing re-authentication to get new token format'
      );
      return false;
    }

    if (!tokenClinicId) {
      logger.warn('Missing clinic_id in token - potential security issue');
      return false;
    }

    // Get clinic identifier from URL
    const identifier = getClinicIdentifier();
    if (!identifier) {
      logger.error('Missing clinic identifier in URL - cannot validate clinic isolation');
      return false;
    }

    // Clinic-specific LIFF app: validate liff_id matches
    if (identifier.type === 'liff_id') {
      // Get authoritative liff_id from getContext() if available
      let urlLiffId = identifier.value;
      if (liff) {
        try {
          const context = (liff as any).getContext?.();
          if (context?.liffId) {
            urlLiffId = context.liffId; // Use authoritative source
          }
        } catch (e) {
          logger.warn('Failed to get LIFF context, using URL parameter:', e);
        }
      }

      if (!tokenLiffId) {
        logger.error('Token missing liff_id but URL has liff_id - clinic isolation violation');
        return false;
      }

      if (urlLiffId !== tokenLiffId) {
        logger.error(
          `CRITICAL SECURITY: LIFF ID mismatch! ` +
          `URL/Context liff_id: ${urlLiffId}, ` +
          `JWT liff_id: ${tokenLiffId} ` +
          `This indicates a clinic isolation violation - user may be accessing wrong clinic's data.`
        );
        return false;
      }

      return true;
    }

    // Shared LIFF app: validate clinic_token matches
    if (identifier.type === 'token') {
      const urlClinicToken = identifier.value;

      if (!tokenClinicToken) {
        logger.error('Token missing clinic_token but URL has clinic_token - clinic isolation violation');
        return false;
      }

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
    }

    return false;
  };

  // Shared helper: Handle authentication flow (reusable by useEffect and refreshAuth)
  const handleAuth = useCallback(async (checkCancelled?: () => boolean) => {
    // First check for existing JWT token
    const token = localStorage.getItem('liff_jwt_token');
    if (token) {
      const isValid = await validateExistingToken(token, checkCancelled);
      if (isValid) {
        // CRITICAL SECURITY CHECK: Ensure clinic isolation
        // This check compares URL identifier (liff_id or clinic_token) with JWT identifier to prevent cross-clinic access
        // DO NOT REMOVE - this is the last line of defense against clinic isolation violations
        // See validateClinicIsolation function documentation for why this is critical
        if (!validateClinicIsolation(token, liff)) {
          logger.error(
            'CRITICAL: Clinic isolation validation failed - URL identifier does not match JWT identifier. ' +
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
        await performAuthentication(lineProfile.userId, lineProfile.displayName, liffAccessToken, lineProfile.pictureUrl, liff, checkCancelled);
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
