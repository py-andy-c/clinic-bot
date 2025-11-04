import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { UnsavedChangesProvider } from './contexts/UnsavedChangesContext';
import { ModalProvider } from './contexts/ModalContext';
import ErrorBoundary from './components/ErrorBoundary';
import { logger } from './utils/logger';
// Lazy load page components for code splitting
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SystemAdminLayout = lazy(() => import('./components/SystemAdminLayout'));
const ClinicLayout = lazy(() => import('./components/ClinicLayout'));
const SystemClinicsPage = lazy(() => import('./pages/SystemClinicsPage'));
const MembersPage = lazy(() => import('./pages/MembersPage'));
const PatientsPage = lazy(() => import('./pages/PatientsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AvailabilityPage = lazy(() => import('./pages/AvailabilityPage'));
const ClinicSignupPage = lazy(() => import('./pages/ClinicSignupPage'));
const MemberSignupPage = lazy(() => import('./pages/MemberSignupPage'));
const NameConfirmationPage = lazy(() => import('./pages/NameConfirmationPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const LiffApp = lazy(() => import('./liff/LiffApp'));

const AppRoutes: React.FC = () => {
  const { isAuthenticated, isLoading, isSystemAdmin, isClinicUser, user } = useAuth();

  // Debug logging
  logger.log('AppRoutes - Auth State:', {
    isAuthenticated,
    isLoading,
    isSystemAdmin,
    isClinicUser,
    user_type: user?.user_type,
    hasRoles: !!user?.roles
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    }>
      <Routes>
        {/* LIFF routes */}
        <Route path="/liff/*" element={<ModalProvider><LiffApp /></ModalProvider>} />

        {/* Public signup routes */}
        <Route path="/signup/clinic" element={<ClinicSignupPage />} />
        <Route path="/signup/member" element={<MemberSignupPage />} />
        <Route path="/signup/confirm-name" element={<NameConfirmationPage />} />

        {/* Login route */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected routes */}
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </Suspense>
  );
};

const ProtectedRoutes: React.FC = () => {
  const { isAuthenticated, isSystemAdmin, isClinicUser, user } = useAuth();

  // Debug: Log when ProtectedRoutes renders
  logger.log('DEBUG: ProtectedRoutes render', {
    isAuthenticated,
    isSystemAdmin,
    isClinicUser,
    hasUser: !!user,
    userEmail: user?.email,
    timestamp: new Date().toISOString()
  });

  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    logger.log('DEBUG: ProtectedRoutes - not authenticated, redirecting to login', {
      timestamp: new Date().toISOString()
    });
    return <Navigate to="/login" replace />;
  }

  // System Admin Routes
  if (isSystemAdmin) {
    return (
      <SystemAdminLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/system/clinics" replace />} />
          <Route path="/system/clinics" element={<SystemClinicsPage />} />
          <Route path="/system/clinics/:id" element={<SystemClinicsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/system/clinics" replace />} />
        </Routes>
      </SystemAdminLayout>
    );
  }

  // Clinic User Routes (Admin, Practitioner, or Read-only)
  if (isClinicUser) {
    // Determine default route based on user role
    const getDefaultRoute = () => {
      if (user?.roles?.includes('practitioner')) {
        return '/calendar'; // Calendar for practitioners
      }
      return '/clinic/members'; // Members page for admins and read-only users
    };

    return (
      <ClinicLayout>
        <Routes>
          <Route path="/" element={<Navigate to={getDefaultRoute()} replace />} />
          <Route path="/clinic/members" element={<MembersPage />} />
          <Route path="/clinic/patients" element={<PatientsPage />} />
          <Route path="/clinic/settings" element={<SettingsPage />} />
          <Route path="/calendar" element={<AvailabilityPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to={getDefaultRoute()} replace />} />
        </Routes>
      </ClinicLayout>
    );
  }

  // Fallback: unauthorized user
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">存取被拒絕</h1>
        <p className="text-gray-600 mb-4">您沒有權限存取此應用程式。</p>
        <button
          onClick={() => window.location.href = '/login'}
          className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700"
        >
          返回登入
        </button>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ModalProvider>
          <UnsavedChangesProvider>
            <AppRoutes />
          </UnsavedChangesProvider>
        </ModalProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;
