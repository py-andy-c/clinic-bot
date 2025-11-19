import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { preserveQueryParams } from '../utils/urlUtils';
import { logger } from '../utils/logger';
import { LiffNavigationState } from '../types/liffNavigation';

/**
 * Hook to manage native back button behavior for LIFF app modes.
 * 
 * Handles back button behavior for:
 * - query (預約管理): back to home
 * - settings (就診人管理): back to home
 * - notifications (空位提醒): back to home (always, regardless of source)
 * 
 * Note: Appointment flow (book mode) uses useAppointmentBackButton instead.
 * 
 * When navigating to home, history is cleared using replaceState.
 */
export const useLiffBackButton = (mode: 'query' | 'settings' | 'notifications') => {
  const navigate = useNavigate();
  const isHandlingBackRef = useRef(false);
  const historyInitializedRef = useRef(false);

  /**
   * Navigate to home and clear history.
   * Uses replaceState to make home the only entry in history stack.
   * 
   * Note: We use navigate with replace: true AND replaceState because:
   * - navigate() updates React Router's internal state
   * - replaceState() updates the browser history state object
   * Both are needed for proper synchronization.
   */
  const navigateToHome = useCallback(() => {
    historyInitializedRef.current = false;
    const newUrl = preserveQueryParams('/liff', { mode: 'home' });
    // Use replace: true to replace current history entry in React Router
    navigate(newUrl, { replace: true });
    // Also replace browser history state to ensure consistency
    const homeState: LiffNavigationState = { mode: 'home', liffNavigation: true };
    window.history.replaceState(homeState, '', newUrl);
  }, [navigate]);

  // Initialize history when entering this mode
  useEffect(() => {
    if (!historyInitializedRef.current) {
      const state: LiffNavigationState = { mode, liffNavigation: true };
      // Push initial history entry
      window.history.pushState(state, '', window.location.href);
      historyInitializedRef.current = true;
    }
  }, [mode]);

  // Handle back button clicks via popstate
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // If we're already handling a back action, ignore to prevent race conditions
      if (isHandlingBackRef.current) {
        return;
      }

      try {
        isHandlingBackRef.current = true;

        // Check if the popped state is from LIFF navigation
        const state = event.state as LiffNavigationState | null;

        if (state?.liffNavigation) {
          // All modes (query, settings, notifications) should go back to home
          navigateToHome();
        } else {
          // Not a LIFF navigation state (user went back beyond LIFF navigation)
          // Navigate to home and clear history
          navigateToHome();
        }
      } catch (error) {
        // Handle any errors gracefully - reset flag and navigate to home as fallback
        logger.error('Error handling back navigation:', error);
        historyInitializedRef.current = false;
        try {
          navigateToHome();
        } catch (navError) {
          logger.error('Failed to navigate to home:', navError);
        }
      } finally {
        isHandlingBackRef.current = false;
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [mode, navigate, navigateToHome]);
};
