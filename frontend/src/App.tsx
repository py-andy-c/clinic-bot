import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { UnsavedChangesProvider } from './contexts/UnsavedChangesContext';
import { ModalProvider } from './contexts/ModalContext';
import { SettingsProvider } from './contexts/SettingsContext';
import ErrorBoundary from './components/ErrorBoundary';
import { LoadingSpinner } from './components/shared';
import i18n from './i18n';
// Lazy load page components for code splitting
const LandingPage = lazy(() => import('./pages/LandingPage'));
const FreeTrialPage = lazy(() => import('./pages/FreeTrialPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SystemAdminLayout = lazy(() => import('./components/SystemAdminLayout'));
const ClinicLayout = lazy(() => import('./components/ClinicLayout'));
const SystemClinicsPage = lazy(() => import('./pages/SystemClinicsPage'));
const MembersPage = lazy(() => import('./pages/MembersPage'));
const PatientsPage = lazy(() => import('./pages/PatientsPage'));
const PatientDetailPage = lazy(() => import('./pages/PatientDetailPage'));
const LineUsersPage = lazy(() => import('./pages/LineUsersPage'));
const AutoAssignedAppointmentsPage = lazy(() => import('./pages/AutoAssignedAppointmentsPage'));
const SettingsLayout = lazy(() => import('./components/SettingsLayout'));
const SettingsIndexPage = lazy(() => import('./pages/settings/SettingsIndexPage'));
const SettingsServiceItemsPage = lazy(() => import('./pages/settings/SettingsServiceItemsPage'));
const SettingsAppointmentsPage = lazy(() => import('./pages/settings/SettingsAppointmentsPage'));
const SettingsClinicInfoPage = lazy(() => import('./pages/settings/SettingsClinicInfoPage'));
const SettingsRemindersPage = lazy(() => import('./pages/settings/SettingsRemindersPage'));
const SettingsChatPage = lazy(() => import('./pages/settings/SettingsChatPage'));
const SettingsReceiptsPage = lazy(() => import('./pages/settings/SettingsReceiptsPage'));
const AvailabilityPage = lazy(() => import('./pages/AvailabilityPage'));
const ClinicDashboardPage = lazy(() => import('./pages/ClinicDashboardPage'));
const AccountingDashboardPage = lazy(() => import('./pages/AccountingDashboardPage'));
const ClinicSignupPage = lazy(() => import('./pages/ClinicSignupPage'));
const MemberSignupPage = lazy(() => import('./pages/MemberSignupPage'));
const NameConfirmationPage = lazy(() => import('./pages/NameConfirmationPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const LiffApp = lazy(() => import('./liff/LiffApp'));

const AppRoutes: React.FC = () => {
  const { isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSpinner size="xl" fullScreen />;
  }

  return (
    <Suspense fallback={<LoadingSpinner size="xl" fullScreen />}>
      <Routes>
        {/* Public landing page and marketing pages */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/free-trial" element={<FreeTrialPage />} />
        <Route path="/contact" element={<ContactPage />} />

        {/* LIFF routes */}
        <Route path="/liff/*" element={<ModalProvider><LiffApp /></ModalProvider>} />

        {/* Public signup routes */}
        <Route path="/signup/clinic" element={<ClinicSignupPage />} />
        <Route path="/signup/member" element={<MemberSignupPage />} />
        <Route path="/signup/confirm-name" element={<NameConfirmationPage />} />

        {/* Admin routes */}
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin/*" element={<AdminRoutes />} />
      </Routes>
    </Suspense>
  );
};

const AdminRoutes: React.FC = () => {
  const { isAuthenticated, isSystemAdmin, isClinicUser, user } = useAuth();

  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  // System Admin Routes
  if (isSystemAdmin) {
    return (
      <SystemAdminLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/admin/system/clinics" replace />} />
          <Route path="system/clinics" element={<SystemClinicsPage />} />
          <Route path="system/clinics/:id" element={<SystemClinicsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/admin/system/clinics" replace />} />
        </Routes>
      </SystemAdminLayout>
    );
  }

  // Clinic User Routes (Admin, Practitioner, or Read-only)
  if (isClinicUser) {
    // Determine default route based on user role
    const getDefaultRoute = () => {
      if (user?.roles?.includes('practitioner')) {
        return '/admin/calendar'; // Calendar for practitioners
      }
      return '/admin/clinic/members'; // Members page for admins and read-only users
    };

    return (
      <ClinicLayout>
        <Routes>
          <Route path="/" element={<Navigate to={getDefaultRoute()} replace />} />
          <Route path="clinic/members" element={<MembersPage />} />
          <Route path="clinic/patients" element={<PatientsPage />} />
          <Route path="clinic/patients/:id" element={<PatientDetailPage />} />
          <Route path="clinic/line-users" element={<LineUsersPage />} />
          <Route path="clinic/pending-review-appointments" element={<AutoAssignedAppointmentsPage />} />
          <Route path="clinic/settings" element={
            <SettingsProvider>
              <SettingsLayout />
            </SettingsProvider>
          }>
            <Route index element={<SettingsIndexPage />} />
            <Route path="service-items" element={<SettingsServiceItemsPage />} />
            <Route path="appointments" element={<SettingsAppointmentsPage />} />
            <Route path="clinic-info" element={<SettingsClinicInfoPage />} />
            <Route path="reminders" element={<SettingsRemindersPage />} />
            <Route path="chat" element={<SettingsChatPage />} />
            <Route path="receipts" element={<SettingsReceiptsPage />} />
          </Route>
          <Route path="clinic/dashboard" element={<ClinicDashboardPage />} />
          <Route path="clinic/accounting" element={<AccountingDashboardPage />} />
          <Route path="calendar" element={<AvailabilityPage />} />
          <Route path="profile" element={<ProfilePage />} />
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
          onClick={() => window.location.href = '/admin/login'}
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
      <I18nextProvider i18n={i18n}>
        <AuthProvider>
          <ModalProvider>
            <UnsavedChangesProvider>
              <AppRoutes />
            </UnsavedChangesProvider>
          </ModalProvider>
        </AuthProvider>
      </I18nextProvider>
    </ErrorBoundary>
  );
};

export default App;
