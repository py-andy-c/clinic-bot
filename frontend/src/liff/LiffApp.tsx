import { FC, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiff } from '../hooks/useLiff';
import { useLineAuth } from '../hooks/useLineAuth';
import { useAppointmentStore } from '../stores/appointmentStore';
import { LoadingSpinner, ErrorMessage, InvalidAccess } from './components/StatusComponents';

type AppMode = 'book' | 'query' | 'settings';
const VALID_MODES: AppMode[] = ['book', 'query', 'settings'];
const DEFAULT_MODE: AppMode = 'book';

const MODE_COMPONENTS: Record<AppMode, FC> = {
  book: AppointmentFlow,
  query: AppointmentList,
  settings: PatientManagement,
};

import FirstTimeRegister from './auth/FirstTimeRegister';
import AppointmentFlow from './appointment/AppointmentFlow';
import AppointmentList from './query/AppointmentList';
import PatientManagement from './settings/PatientManagement';

const LiffApp: FC = () => {
  const { isReady, profile, accessToken, error: liffError } = useLiff();
  const { isFirstTime, isLoading: authLoading, clinicId, error: authError, refreshAuth } = useLineAuth(profile, accessToken);
  const [searchParams] = useSearchParams();
  const setClinicId = useAppointmentStore(state => state.setClinicId);

  const rawMode = searchParams.get('mode');
  const mode: AppMode = rawMode && VALID_MODES.includes(rawMode as AppMode)
    ? (rawMode as AppMode)
    : DEFAULT_MODE;

  useEffect(() => {
    if (clinicId) {
      setClinicId(clinicId);
    }
  }, [clinicId, setClinicId]);

  if (!isReady || authLoading) return <LoadingSpinner />;

  if (liffError) {
    return <ErrorMessage message={liffError} onRetry={() => window.location.reload()} />;
  }

  if (authError) {
    return <ErrorMessage message={authError} onRetry={refreshAuth} />;
  }

  if (!clinicId) return <InvalidAccess />;

  if (isFirstTime) return <FirstTimeRegister />;

  const ModeComponent = MODE_COMPONENTS[mode];
  return <ModeComponent />;
};

export default LiffApp;
