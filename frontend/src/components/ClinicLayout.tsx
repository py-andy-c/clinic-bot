import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';
import { apiService } from '../services/api';

interface ClinicLayoutProps {
  children: React.ReactNode;
}

// Global Warnings Component
const GlobalWarnings: React.FC = () => {
  const { user, isClinicAdmin, hasRole } = useAuth();
  const [warnings, setWarnings] = useState<{
    practitionerWarnings: { hasAppointmentTypes: boolean; hasAvailability: boolean };
    adminWarnings: Array<{ id: number; full_name: string; hasAppointmentTypes: boolean; hasAvailability: boolean }>;
  }>({
    practitionerWarnings: { hasAppointmentTypes: true, hasAvailability: true },
    adminWarnings: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWarnings();
  }, [user, isClinicAdmin]);

  const fetchWarnings = async () => {
    if (!user?.user_id) return;

    try {
      setLoading(true);

      // Fetch practitioner's own warnings if they are a practitioner
      let practitionerWarnings = { hasAppointmentTypes: true, hasAvailability: true };
      if (hasRole && hasRole('practitioner')) {
        const status = await apiService.getPractitionerStatus(user.user_id);
        practitionerWarnings = {
          hasAppointmentTypes: status.has_appointment_types,
          hasAvailability: status.has_availability
        };
      }

      // Fetch admin warnings if user is admin
      let adminWarnings: Array<{ id: number; full_name: string; hasAppointmentTypes: boolean; hasAvailability: boolean }> = [];
      if (isClinicAdmin) {
        const members = await apiService.getMembers();
        for (const member of members) {
          if (member.roles.includes('practitioner') && member.is_active) {
            try {
              const status = await apiService.getPractitionerStatus(member.id);
              if (!status.has_appointment_types || !status.has_availability) {
                adminWarnings.push({
                  id: member.id,
                  full_name: member.full_name,
                  hasAppointmentTypes: status.has_appointment_types,
                  hasAvailability: status.has_availability
                });
              }
            } catch (err) {
              // Continue with other practitioners
            }
          }
        }
      }

      setWarnings({
        practitionerWarnings,
        adminWarnings
      });
    } catch (err) {
      console.error('Error fetching warnings:', err);
    } finally {
      setLoading(false);
    }
  };

  const hasAnyWarnings = !warnings.practitionerWarnings.hasAppointmentTypes ||
                         !warnings.practitionerWarnings.hasAvailability ||
                         warnings.adminWarnings.length > 0;

  if (loading || !hasAnyWarnings) {
    return null;
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <span className="text-amber-600 text-lg">⚠️</span>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-amber-800">設定提醒</h3>
            <div className="mt-2 space-y-2">
              {/* Practitioner warnings */}
              {(!warnings.practitionerWarnings.hasAppointmentTypes || !warnings.practitionerWarnings.hasAvailability) && (
                <div className="text-sm text-amber-700">
                  <strong>您的預約功能未啟用：</strong>
                  <ul className="mt-1 ml-4 list-disc">
                    <li>
                      {!warnings.practitionerWarnings.hasAppointmentTypes && !warnings.practitionerWarnings.hasAvailability && '未設定預約類型和診療時段'}
                      {!warnings.practitionerWarnings.hasAppointmentTypes && warnings.practitionerWarnings.hasAvailability && '未設定預約類型'}
                      {warnings.practitionerWarnings.hasAppointmentTypes && !warnings.practitionerWarnings.hasAvailability && '未設定診療時段'}
                    </li>
                  </ul>
                  <p className="mt-2">
                    <a href="/profile" className="text-amber-800 underline hover:text-amber-900">
                      前往個人設定頁面設定
                    </a>
                  </p>
                </div>
              )}

              {/* Admin warnings */}
              {warnings.adminWarnings.length > 0 && (
                <div className="text-sm text-amber-700">
                  <strong>以下治療師的預約功能未啟用：</strong>
                  <ul className="mt-1 ml-4 list-disc">
                    {warnings.adminWarnings.map(practitioner => (
                      <li key={practitioner.id}>
                        {practitioner.full_name}：
                        {!practitioner.hasAppointmentTypes && !practitioner.hasAvailability && '未設定預約類型和診療時段'}
                        {!practitioner.hasAppointmentTypes && practitioner.hasAvailability && '未設定預約類型'}
                        {practitioner.hasAppointmentTypes && !practitioner.hasAvailability && '未設定診療時段'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ClinicLayout: React.FC<ClinicLayoutProps> = ({ children }) => {
  const { user, logout, isClinicAdmin, isPractitioner, isReadOnlyUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { hasUnsavedChanges } = useUnsavedChanges();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleNavigation = (href: string) => {
    if (hasUnsavedChanges && location.pathname === '/profile') {
      const confirmed = window.confirm('您有未儲存的變更，確定要離開嗎？');
      if (!confirmed) {
        return;
      }
    }
    navigate(href);
  };

  const navigation = [
    { name: '行事曆', href: '/clinic/availability', icon: '📅', show: isPractitioner },
    { name: '團隊成員', href: '/clinic/members', icon: '👥', show: true }, // All clinic members can view
    { name: '病患管理', href: '/clinic/patients', icon: '👥', show: true },
    { name: '診所設定', href: '/clinic/settings', icon: '⚙️', show: true }, // All clinic members can view settings
    { name: '個人設定', href: '/profile', icon: '👤', show: true }, // All users can access profile
  ].filter(item => item.show);

  const isActive = (href: string) => {
    return location.pathname === href;
  };

  const getUserRoleDisplay = () => {
    if (isClinicAdmin && isPractitioner) {
      return '管理員 & 治療師';
    } else if (isClinicAdmin) {
      return '診所管理員';
    } else if (isPractitioner) {
      return '治療師';
    } else if (isReadOnlyUser) {
      return '一般成員';
    }
    return '使用者';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              {/* Logo */}
              <div className="flex-shrink-0 flex items-center">
                <div className="flex items-center space-x-2">
                  <span className="text-2xl">🏥</span>
                  <span className="text-xl font-bold text-gray-900">Clinic Bot</span>
                  <span className="text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                    {getUserRoleDisplay()}
                  </span>
                </div>
              </div>

              {/* Desktop Navigation */}
              <div className="hidden md:ml-6 md:flex md:space-x-8">
                {navigation.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => handleNavigation(item.href)}
                    className={`${
                      isActive(item.href)
                        ? 'border-primary-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                  >
                    <span className="mr-2">{item.icon}</span>
                    {item.name}
                  </button>
                ))}
              </div>
            </div>

            {/* User Menu */}
            <div className="hidden md:ml-6 md:flex md:items-center">
              <div className="ml-3 relative">
                <div className="flex items-center space-x-4">
                  <div className="text-sm text-gray-700">
                    <div className="font-medium">{user?.full_name}</div>
                    <div className="text-xs text-gray-500">{user?.email}</div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="bg-white p-1 rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                    title="登出"
                  >
                    <span className="sr-only">登出</span>
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden flex items-center">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="bg-white inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
              >
                <span className="sr-only">開啟主選單</span>
                {isMobileMenuOpen ? (
                  <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white border-t border-gray-200">
              {navigation.map((item) => (
                <button
                  key={item.name}
                  onClick={() => {
                    handleNavigation(item.href);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`${
                    isActive(item.href)
                      ? 'bg-primary-50 border-primary-500 text-primary-700'
                      : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                  } block pl-3 pr-4 py-2 border-l-4 text-base font-medium w-full text-left`}
                >
                  <span className="mr-2">{item.icon}</span>
                  {item.name}
                </button>
              ))}
            </div>
            <div className="pt-4 pb-3 border-t border-gray-200">
              <div className="flex items-center px-5">
                <div className="text-base font-medium text-gray-800">{user?.full_name}</div>
                <div className="text-sm text-gray-500 ml-2">({getUserRoleDisplay()})</div>
              </div>
              <div className="mt-3 space-y-1 px-2">
                <button
                  onClick={handleLogout}
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 w-full text-left"
                >
                  登出
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Global Warnings */}
      <GlobalWarnings />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {children}
        </div>
      </main>
    </div>
  );
};

export default ClinicLayout;
