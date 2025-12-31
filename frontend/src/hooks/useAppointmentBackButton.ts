import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppointmentStore } from '../stores/appointmentStore';
import { preserveQueryParams } from '../utils/urlUtils';
import { LiffNavigationState } from '../types/liffNavigation';
import { logger } from '../utils/logger';

/**
 * Type definition for appointment flow history state.
 * This ensures type safety when working with history.state.
 */
interface AppointmentFlowState {
  step: number;
  appointmentFlow: true;
}

/**
 * Step constants for clarity and maintainability.
 */
const FIRST_STEP = 1;
const SUCCESS_STEP = 7;

/**
 * Hook to manage native back button behavior during appointment flow.
 * 
 * When in appointment flow (mode=book):
 * - Back button goes to previous step if step > FIRST_STEP and step < SUCCESS_STEP
 * - Back button goes to home if step === FIRST_STEP or step === SUCCESS_STEP (success page)
 * 
 * Uses browser history API to intercept back navigation.
 * 
 * Important notes:
 * - SUCCESS_STEP (7) is the success page after appointment creation. Going back
 *   from step 7 should return to home, not to the confirmation step.
 * - This hook uses window.history.replaceState/pushState which don't change
 *   the URL, so they don't conflict with React Router. React Router navigation
 *   is only used when navigating to home (using navigate with replace: true).
 * - Steps are not reflected in the URL intentionally - this is a design choice
 *   for the multi-step flow. Users cannot bookmark or share step-specific URLs.
 * - Forward navigation through browser history is not explicitly handled, as
 *   it's not expected behavior in a multi-step form flow.
 */
export const useAppointmentBackButton = (isInAppointmentFlow: boolean) => {
  const navigate = useNavigate();
  const { step, setStep } = useAppointmentStore();
  const previousStepRef = useRef<number>(step);
  const isHandlingBackRef = useRef(false);
  const historyInitializedRef = useRef(false);

  /**
   * Navigate to home and reset appointment flow history state.
   * This is extracted to avoid duplication and ensure consistent behavior.
   * Uses replace: true to clear history when navigating to home.
   */
  const navigateToHome = useCallback(() => {
    historyInitializedRef.current = false;
    // Navigate to home and clear history using replace
    const newUrl = preserveQueryParams('/liff', { mode: 'home' });
    // Use replace: true to replace current history entry in React Router
    navigate(newUrl, { replace: true });
    // Also replace browser history state to ensure consistency
    const homeState: LiffNavigationState = { mode: 'home', liffNavigation: true };
    window.history.replaceState(homeState, '', newUrl);
  }, [navigate]);

  // Initialize history when entering appointment flow
  // Only depend on isInAppointmentFlow to avoid re-initialization when step changes
  useEffect(() => {
    if (!isInAppointmentFlow) {
      historyInitializedRef.current = false;
      return;
    }

    // Push initial history entry when first entering appointment flow
    // Capture the current step value at initialization time to avoid dependency issues
    if (!historyInitializedRef.current) {
      const currentStep = useAppointmentStore.getState().step;
      const state: AppointmentFlowState = { step: currentStep, appointmentFlow: true };
      window.history.pushState(state, '', window.location.href);
      historyInitializedRef.current = true;
      previousStepRef.current = currentStep;
    }
  }, [isInAppointmentFlow]);

  // Track step changes and push history entries
  useEffect(() => {
    if (!isInAppointmentFlow || !historyInitializedRef.current) return;

    // Only push history if step actually changed (not initial render)
    // The check against previousStepRef prevents race conditions from rapid step changes.
    // React batches state updates, but this provides an additional safeguard.
    if (step !== previousStepRef.current) {
      // Push a new history entry for this step
      // Update previousStepRef synchronously before the history push to prevent race conditions
      previousStepRef.current = step;
      const state: AppointmentFlowState = { step, appointmentFlow: true };
      window.history.pushState(state, '', window.location.href);
    }
  }, [step, isInAppointmentFlow]);

  // Handle back button clicks via popstate
  useEffect(() => {
    if (!isInAppointmentFlow) return;

    const handlePopState = (event: PopStateEvent) => {
      // If we're already handling a back action, ignore to prevent race conditions
      if (isHandlingBackRef.current) {
        return;
      }

      try {
        // Check if the popped state is from appointment flow
        const state = event.state as AppointmentFlowState | null;
        // Use getState() to get the latest step value, as the hook's step might be stale
        // in the event handler closure. We check currentStep (not state.step) because:
        // - When on Step 7 and clicking back, event.state contains Step 6 (the previous state)
        // - But we want to check the CURRENT step (7) to decide to go home, not the popped state
        const currentStep = useAppointmentStore.getState().step;

        if (state?.appointmentFlow) {
          isHandlingBackRef.current = true;

          // Check if we should navigate to previous step or home
          // Steps 2-6: go to previous step
          // Step 1 or Step 7 (success): go to home
          if (currentStep > FIRST_STEP && currentStep < SUCCESS_STEP) {
            // Go to previous step (steps 2-6)
            let previousStep = currentStep - 1;
            const state = useAppointmentStore.getState();
            const flowType = state.flowType;
            const appointmentType = state.appointmentType;
            
            // Handle skipping practitioner step based on flow type
            if (flowType === 'flow1') {
              // Flow 1: Step 2 is practitioner
              if (previousStep === 2 && appointmentType?.allow_patient_practitioner_selection === false) {
                previousStep = 1; // Skip step 2, go directly to step 1
              }
            } else if (flowType === 'flow2') {
              // Flow 2: Step 3 is practitioner
              if (previousStep === 3 && appointmentType?.allow_patient_practitioner_selection === false) {
                previousStep = 2; // Skip step 3, go directly to step 2
              }
            }
            
            setStep(previousStep);
            // Replace the current state (which was just popped) with the previous step state.
            // This maintains the history stack correctly without adding unnecessary entries.
            // Using replaceState instead of pushState here is critical:
            // - pushState would add a new entry, potentially causing infinite loops
            // - replaceState replaces the current entry, maintaining proper history stack
            const newState: AppointmentFlowState = { step: previousStep, appointmentFlow: true };
            window.history.replaceState(newState, '', window.location.href);
            previousStepRef.current = previousStep;
            isHandlingBackRef.current = false;
          } else {
            // On step 1 or step 7 (success page), go to home
            // Reset history state when leaving appointment flow to ensure clean state
            // when re-entering the appointment flow later
            navigateToHome();
            isHandlingBackRef.current = false;
          }
        } else {
          // Not an appointment flow state (user went back beyond appointment flow)
          // Reset history state and navigate to home
          navigateToHome();
        }
      } catch (error) {
        // Handle any errors gracefully - reset flag and navigate to home as fallback
        logger.error('Error handling back navigation:', error);
        historyInitializedRef.current = false;
        isHandlingBackRef.current = false;
        try {
          navigateToHome();
        } catch (navError) {
          logger.error('Failed to navigate to home:', navError);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isInAppointmentFlow, navigate, setStep, navigateToHome]);
};

