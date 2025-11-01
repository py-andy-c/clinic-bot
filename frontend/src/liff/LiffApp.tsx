import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useLiff } from '../hooks/useLiff';
import { useLineAuth } from '../hooks/useLineAuth';
import { useAppointmentStore } from '../stores/appointmentStore';

// Import LIFF components (we'll create these next)
import FirstTimeRegister from './auth/FirstTimeRegister';
import AppointmentFlow from './appointment/AppointmentFlow';
import AppointmentList from './query/AppointmentList';
import PatientManagement from './settings/PatientManagement';

// Loading component
const LoadingSpinner: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
  </div>
);

// Error component
const ErrorMessage: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="min-h-screen flex items-center justify-center p-4">
    <div className="text-center">
      <div className="text-red-500 text-6xl mb-4">⚠️</div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">發生錯誤</h1>
      <p className="text-gray-600 mb-6">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="bg-primary-600 text-white px-6 py-2 rounded-md hover:bg-primary-700"
        >
          重試
        </button>
      )}
    </div>
  </div>
);

// Invalid access component
const InvalidAccess: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center p-4">
    <div className="text-center">
      <div className="text-red-500 text-6xl mb-4">🚫</div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">存取無效</h1>
      <p className="text-gray-600 mb-6">
        請從診所的LINE官方帳號進入此應用程式
      </p>
    </div>
  </div>
);

const LiffApp: React.FC = () => {
  const { isReady, profile, error: liffError } = useLiff();
  const { isAuthenticated, isFirstTime, isLoading: authLoading, clinicId, error: authError } = useLineAuth(profile);
  const [searchParams] = useSearchParams();

  // Extract mode from URL parameters
  const mode = searchParams.get('mode') || 'book';

  // Set clinic ID in the appointment store
  React.useEffect(() => {
    if (clinicId) {
      useAppointmentStore.getState().setClinicId(clinicId);
    }
  }, [clinicId]);

  // Show loading while LIFF initializes
  if (!isReady) {
    return <LoadingSpinner />;
  }

  // Show LIFF error
  if (liffError) {
    return <ErrorMessage message={liffError} onRetry={() => window.location.reload()} />;
  }

  // Show auth loading
  if (authLoading) {
    return <LoadingSpinner />;
  }

  // Show auth error
  if (authError) {
    return <ErrorMessage message={authError} />;
  }

  // Check if clinic ID is provided
  if (!clinicId) {
    return <InvalidAccess />;
  }

  // First-time user: show registration
  if (isFirstTime) {
    return <FirstTimeRegister />;
  }

  // Authenticated user: route based on mode
  switch (mode) {
    case 'book':
      return <AppointmentFlow />;
    case 'query':
      return <AppointmentList />;
    case 'settings':
      return <PatientManagement />;
    default:
      // Default to booking
      return <Navigate to="?mode=book" replace />;
  }
};

export default LiffApp;
