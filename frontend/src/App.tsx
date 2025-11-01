import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { UnsavedChangesProvider } from './contexts/UnsavedChangesContext';
import LoginPage from './pages/LoginPage';
import SystemAdminLayout from './components/SystemAdminLayout';
import ClinicLayout from './components/ClinicLayout';
import SystemClinicsPage from './pages/SystemClinicsPage';
import MembersPage from './pages/MembersPage';
import PatientsPage from './pages/PatientsPage';
import SettingsPage from './pages/SettingsPage';
import AvailabilityPage from './pages/AvailabilityPage';
import ClinicSignupPage from './pages/ClinicSignupPage';
import MemberSignupPage from './pages/MemberSignupPage';
import NameConfirmationPage from './pages/NameConfirmationPage';
import ProfilePage from './pages/ProfilePage';
import LiffApp from './liff/LiffApp';

const AppRoutes: React.FC = () => {
  const { isAuthenticated, isLoading, isSystemAdmin, isClinicUser, user } = useAuth();

  // Debug logging
  console.log('AppRoutes - Auth State:', {
    isAuthenticated,
    isLoading,
    isSystemAdmin,
    isClinicUser,
    user: user ? {
      user_type: user.user_type,
      roles: user.roles,
      email: user.email
    } : null
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // LIFF routes (check for /liff path)
  if (window.location.pathname.startsWith('/liff')) {
    return <LiffApp />;
  }

  // Public signup routes (no authentication required)
  if (window.location.pathname.startsWith('/signup/')) {
    return (
      <Routes>
        <Route path="/signup/clinic" element={<ClinicSignupPage />} />
        <Route path="/signup/member" element={<MemberSignupPage />} />
        <Route path="/signup/confirm-name" element={<NameConfirmationPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // If not authenticated, show login page
  if (!isAuthenticated) {
    return <LoginPage />;
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
        return '/clinic/availability'; // Calendar for practitioners
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
          <Route path="/clinic/availability" element={<AvailabilityPage />} />
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
          onClick={() => window.location.href = '/auth/google/login'}
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
    <AuthProvider>
      <UnsavedChangesProvider>
        <AppRoutes />
      </UnsavedChangesProvider>
    </AuthProvider>
  );
};

export default App;
