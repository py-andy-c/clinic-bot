import { useEffect, useState } from 'react';
import { liffApiService, LiffLoginResponse } from '../services/liffApi';

interface UseLineAuthReturn {
  isAuthenticated: boolean;
  isFirstTime: boolean;
  isLoading: boolean;
  clinicId: number | null;
  displayName: string;
  error: string | null;
  authenticate: (lineUserId: string, displayName: string) => Promise<void>;
  logout: () => void;
}

export const useLineAuth = (lineProfile: { userId: string; displayName: string } | null): UseLineAuthReturn => {
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

  // Check if user is already authenticated (has valid JWT token)
  useEffect(() => {
    const checkExistingAuth = () => {
      const token = localStorage.getItem('liff_jwt_token');
      if (token) {
        // For now, assume token is valid if it exists
        // In production, you might want to validate the token
        setIsAuthenticated(true);
        setIsFirstTime(false); // If they have a token, they've been here before
        const urlClinicId = getClinicIdFromUrl();
        if (urlClinicId) {
          setClinicId(urlClinicId);
        }
      }
      setIsLoading(false);
    };

    checkExistingAuth();
  }, []);

  const authenticate = async (lineUserId: string, displayName: string) => {
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
    if (lineProfile && !isAuthenticated && !isLoading) {
      authenticate(lineProfile.userId, lineProfile.displayName);
    }
  }, [lineProfile, isAuthenticated, isLoading]);

  const logout = () => {
    localStorage.removeItem('liff_jwt_token');
    setIsAuthenticated(false);
    setIsFirstTime(false);
    setClinicId(null);
    setDisplayName('');
    setError(null);
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
  };
};
