import { useEffect, useState, useRef } from 'react';
import liff from '@line/liff';
import { logger } from '../utils/logger';

interface LiffProfile {
  userId: string;
  displayName: string;
  pictureUrl: string | undefined;
  statusMessage: string | undefined;
}

interface UseLiffReturn {
  isReady: boolean;
  profile: LiffProfile | null;
  accessToken: string | null;
  liff: typeof liff;
  error: string | null;
}

// Global flag to track if LIFF has been initialized (shared across all hook instances)
let liffInitialized = false;

export const useLiff = (): UseLiffReturn => {
  const [isReady, setIsReady] = useState(false);
  const [profile, setProfile] = useState<LiffProfile | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initAttemptedRef = useRef(false);

  useEffect(() => {
    // Prevent multiple initialization attempts in the same component instance
    if (initAttemptedRef.current) {
      return;
    }
    initAttemptedRef.current = true;

    const initLiff = async () => {
      try {
        // Get LIFF ID from environment variables
        const liffId = import.meta.env.VITE_LIFF_ID;

        if (!liffId) {
          throw new Error('VITE_LIFF_ID environment variable is not set');
        }

        // Check if LIFF is already initialized globally to prevent multiple init calls
        // This can happen in React StrictMode or during hot reload
        if (liffInitialized) {
          // LIFF is already initialized, just get the current state
          try {
            if (liff.isLoggedIn()) {
              const userProfile = await liff.getProfile();
              setProfile({
                userId: userProfile.userId,
                displayName: userProfile.displayName,
                pictureUrl: userProfile.pictureUrl,
                statusMessage: userProfile.statusMessage,
              });
              const token = liff.getAccessToken();
              setAccessToken(token);
              setIsReady(true);
            }
          } catch (err) {
            // If we can't get profile, LIFF might not be fully initialized
            // Try to initialize anyway
            logger.log('LIFF appears initialized but profile fetch failed, re-initializing');
            liffInitialized = false;
          }
          
          if (liffInitialized) {
            return;
          }
        }

        // Initialize LIFF
        await liff.init({ liffId });
        liffInitialized = true;

        // Check if user is logged in
        if (!liff.isLoggedIn()) {
          // Redirect to LINE login
          liff.login();
          return;
        }

        // Get user profile
        const userProfile = await liff.getProfile();
        setProfile({
          userId: userProfile.userId,
          displayName: userProfile.displayName,
          pictureUrl: userProfile.pictureUrl,
          statusMessage: userProfile.statusMessage,
        });

        // Get LIFF access token
        const token = liff.getAccessToken();
        setAccessToken(token);

        setIsReady(true);
      } catch (err) {
        logger.error('LIFF initialization failed:', err);
        setError(err instanceof Error ? err.message : 'LIFF initialization failed');
      }
    };

    initLiff();
  }, []);

  return { isReady, profile, accessToken, liff, error };
};
