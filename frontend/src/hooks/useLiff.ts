import { useEffect, useState } from 'react';
import liff from '@line/liff';

interface LiffProfile {
  userId: string;
  displayName: string;
  pictureUrl: string | undefined;
  statusMessage: string | undefined;
}

interface UseLiffReturn {
  isReady: boolean;
  profile: LiffProfile | null;
  liff: typeof liff;
  error: string | null;
}

export const useLiff = (): UseLiffReturn => {
  const [isReady, setIsReady] = useState(false);
  const [profile, setProfile] = useState<LiffProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initLiff = async () => {
      try {
        // Get LIFF ID from environment variables
        const liffId = import.meta.env.VITE_LIFF_ID;

        if (!liffId) {
          throw new Error('VITE_LIFF_ID environment variable is not set');
        }

        // Initialize LIFF
        await liff.init({ liffId });

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

        setIsReady(true);
      } catch (err) {
        console.error('LIFF initialization failed:', err);
        setError(err instanceof Error ? err.message : 'LIFF initialization failed');
      }
    };

    initLiff();
  }, []);

  return { isReady, profile, liff, error };
};
