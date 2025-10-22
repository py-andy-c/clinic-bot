import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import SystemAdminLayout from './components/SystemAdminLayout';
import ClinicLayout from './components/ClinicLayout';
import SystemDashboardPage from './pages/SystemDashboardPage';
import SystemClinicsPage from './pages/SystemClinicsPage';
import ClinicDashboardPage from './pages/ClinicDashboardPage';
import MembersPage from './pages/MembersPage';
import PatientsPage from './pages/PatientsPage';
import SettingsPage from './pages/SettingsPage';
import ClinicSignupPage from './pages/ClinicSignupPage';
import MemberSignupPage from './pages/MemberSignupPage';

const AppRoutes: React.FC = () => {
  const { isAuthenticated, isLoading, isSystemAdmin, isClinicAdmin, isPractitioner, user } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // Public signup routes (no authentication required)
  if (window.location.pathname.startsWith('/signup/')) {
    return (
      <Routes>
        <Route path="/signup/clinic" element={<ClinicSignupPage />} />
        <Route path="/signup/member" element={<MemberSignupPage />} />
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
          <Route path="/" element={<Navigate to="/system/dashboard" replace />} />
          <Route path="/system/dashboard" element={<SystemDashboardPage />} />
          <Route path="/system/clinics" element={<SystemClinicsPage />} />
          <Route path="/system/clinics/:id" element={<SystemClinicsPage />} />
          <Route path="*" element={<Navigate to="/system/dashboard" replace />} />
        </Routes>
      </SystemAdminLayout>
    );
  }

  // Clinic User Routes (Admin or Practitioner)
  if (isClinicAdmin || isPractitioner) {
    return (
      <ClinicLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/clinic/dashboard" replace />} />
          <Route path="/clinic/dashboard" element={<ClinicDashboardPage />} />
          <Route path="/clinic/members" element={<MembersPage />} />
          <Route path="/clinic/patients" element={<PatientsPage />} />
          <Route path="/clinic/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/clinic/dashboard" replace />} />
        </Routes>
      </ClinicLayout>
    );
  }

  // Fallback: unauthorized user
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h1>
        <p className="text-gray-600 mb-4">You don't have permission to access this application.</p>
        <button
          onClick={() => window.location.href = '/auth/google/login'}
          className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700"
        >
          Return to Login
        </button>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
};

export default App;
