import { FC, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { logger } from '../utils/logger';
import { useLiff } from '../hooks/useLiff';
import { useLineAuth } from '../hooks/useLineAuth';
import { useAppointmentStore } from '../stores/appointmentStore';
import { liffApiService } from '../services/liffApi';
import { LoadingSpinner, ErrorMessage, InvalidAccess } from './components/StatusComponents';
import LiffHome from './home/LiffHome';
import AppointmentFlow from './appointment/AppointmentFlow';
import AppointmentList from './query/AppointmentList';
import PatientManagement from './settings/PatientManagement';
import NotificationsFlow from './notifications/NotificationsFlow';

type AppMode = 'home' | 'book' | 'query' | 'settings' | 'notifications';
const VALID_MODES: AppMode[] = ['home', 'book', 'query', 'settings', 'notifications'];
const DEFAULT_MODE: AppMode = 'home';

const MODE_COMPONENTS: Record<AppMode, FC> = {
  home: LiffHome,
  book: AppointmentFlow,
  query: AppointmentList,
  settings: PatientManagement,
  notifications: NotificationsFlow,
};

const LiffApp: FC = () => {
  const { isReady, profile, accessToken, error: liffError } = useLiff();
  const { isLoading: authLoading, clinicId, error: authError, refreshAuth } = useLineAuth(profile, accessToken);
  const [searchParams] = useSearchParams();
  const setClinicId = useAppointmentStore(state => state.setClinicId);
  const setClinicInfo = useAppointmentStore(state => state.setClinicInfo);

  const rawMode = searchParams.get('mode');
  const mode: AppMode = rawMode && VALID_MODES.includes(rawMode as AppMode)
    ? (rawMode as AppMode)
    : DEFAULT_MODE;

  useEffect(() => {
    if (clinicId) {
      setClinicId(clinicId);
    }
  }, [clinicId, setClinicId]);

  // Fetch clinic information when clinicId is available
  useEffect(() => {
    const fetchClinicInfo = async () => {
      if (clinicId) {
        try {
          const clinicInfo = await liffApiService.getClinicInfo();
          setClinicInfo(
            clinicInfo.clinic_name,
            clinicInfo.display_name,
            clinicInfo.address,
            clinicInfo.phone_number
          );
        } catch (error) {
          logger.error('Failed to fetch clinic info:', error);
          // Don't show error to user, just use defaults
        }
      }
    };

    fetchClinicInfo();
  }, [clinicId, setClinicInfo]);

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
