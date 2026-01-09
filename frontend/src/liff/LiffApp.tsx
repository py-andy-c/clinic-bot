import { FC, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { logger } from '../utils/logger';
import { useLiff } from '../hooks/useLiff';
import { useLineAuth } from '../hooks/useLineAuth';
import { useAppointmentStore } from '../stores/appointmentStore';
import { liffApiService } from '../services/liffApi';
import { LiffNavigationState } from '../types/liffNavigation';
import { LoadingSpinner, ErrorMessage, InvalidAccess } from './components/StatusComponents';
import LiffHome from './home/LiffHome';
import AppointmentFlow from './appointment/AppointmentFlow';
import AppointmentList from './query/AppointmentList';
import PatientManagement from './settings/PatientManagement';
import NotificationsFlow from './notifications/NotificationsFlow';
import RescheduleFlow from './appointment/RescheduleFlow';

type AppMode = 'home' | 'book' | 'query' | 'settings' | 'notifications' | 'reschedule';
const VALID_MODES: AppMode[] = ['home', 'book', 'query', 'settings', 'notifications', 'reschedule'];
const DEFAULT_MODE: AppMode = 'home';

const MODE_COMPONENTS: Record<AppMode, FC> = {
  home: LiffHome,
  book: AppointmentFlow,
  query: AppointmentList,
  settings: PatientManagement,
  notifications: NotificationsFlow,
  reschedule: RescheduleFlow,
};

const LiffApp: FC = () => {
  const { isReady, profile, accessToken, liff, error: liffError } = useLiff();
  const { isLoading: authLoading, clinicId, error: authError, refreshAuth } = useLineAuth(profile, accessToken, liff);
  const [searchParams] = useSearchParams();
  const setClinicId = useAppointmentStore(state => state.setClinicId);
  const setClinicInfo = useAppointmentStore(state => state.setClinicInfo);
  const setAppointmentNotesInstructions = useAppointmentStore(state => state.setAppointmentNotesInstructions);
  const setPageInstructions = useAppointmentStore(state => state.setPageInstructions);

  const rawMode = searchParams.get('mode');
  const mode: AppMode = rawMode && VALID_MODES.includes(rawMode as AppMode)
    ? (rawMode as AppMode)
    : DEFAULT_MODE;

  useEffect(() => {
    if (clinicId) {
      setClinicId(clinicId);
    }
  }, [clinicId, setClinicId]);

  // Fetch clinic information when clinicId is available and authentication is complete
  useEffect(() => {
    const fetchClinicInfo = async () => {
      // Only fetch if we have clinicId and authentication is complete
      if (clinicId && isReady && !authLoading) {
        try {
          const clinicInfo = await liffApiService.getClinicInfo();
          setClinicInfo(
            clinicInfo.clinic_name,
            clinicInfo.display_name,
            clinicInfo.address,
            clinicInfo.phone_number,
            clinicInfo.require_birthday || false,
            clinicInfo.require_gender || false,
            clinicInfo.minimum_cancellation_hours_before || 24,
            clinicInfo.restrict_to_assigned_practitioners || false
          );
          setAppointmentNotesInstructions(clinicInfo.appointment_notes_instructions || null);
          setPageInstructions(
            clinicInfo.query_page_instructions || null,
            clinicInfo.settings_page_instructions || null,
            clinicInfo.notifications_page_instructions || null
          );
        } catch (error) {
          // Silently fail - this is not critical for app functionality
          // The error is logged but not shown to user to avoid noise
          logger.log('Failed to fetch clinic info (non-critical):', error);
        }
      }
    };

    fetchClinicInfo();
  }, [clinicId, isReady, authLoading, setClinicInfo, setAppointmentNotesInstructions, setPageInstructions]);

  // Clear history when user exits LIFF app
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Clear history state when user exits/closes the app
      const homeState: LiffNavigationState = { mode: 'home', liffNavigation: true };
      window.history.replaceState(homeState, '', window.location.href);
    };

    // Handle browser close/refresh
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  if (!isReady || authLoading) return <LoadingSpinner />;

  if (liffError) {
    return <ErrorMessage message={liffError} onRetry={() => window.location.reload()} />;
  }

  if (authError) {
    return <ErrorMessage message={authError} onRetry={refreshAuth} />;
  }

  if (!clinicId) return <InvalidAccess />;

  const ModeComponent = MODE_COMPONENTS[mode];
  return <ModeComponent />;
};

export default LiffApp;
