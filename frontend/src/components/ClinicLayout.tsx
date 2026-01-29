import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';
import { useModal } from '../contexts/ModalContext';
import { useClinicSettings, useMembers, usePractitionerStatus, useBatchPractitionerStatus } from '../hooks/queries';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '../utils/logger';
import ClinicSwitcher from './ClinicSwitcher';

interface ClinicLayoutProps {
  children: React.ReactNode;
}

// Global Warnings Component
const GlobalWarnings: React.FC = () => {
  const { user, isClinicAdmin, hasRole, isLoading } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [warnings, setWarnings] = useState<{
    clinicWarnings: { hasAppointmentTypes: boolean };
    practitionerWarnings: { hasAppointmentTypes: boolean; hasAvailability: boolean };
    adminWarnings: Array<{ id: number; full_name: string; hasAppointmentTypes: boolean; hasAvailability: boolean }>;
  }>({
    clinicWarnings: { hasAppointmentTypes: true },
    practitionerWarnings: { hasAppointmentTypes: true, hasAvailability: true },
    adminWarnings: []
  });
  const [loading, setLoading] = useState(true);
  const previousPathnameRef = useRef<string | null>(null);

  // Use shared fetch functions for cache key consistency
  const { data: clinicSettingsData, error: clinicSettingsError } = useClinicSettings();

  const { data: membersData, error: membersError } = useMembers();

  // Use React Query for practitioner status to enable caching and request deduplication
  const { data: practitionerStatusData, error: practitionerStatusError } = usePractitionerStatus(user?.user_id);

  // Compute practitioner IDs from members data
  const practitionerIds = useMemo(() => {
    if (!isClinicAdmin || !membersData) return [];
    const practitionerMembers = membersData.filter(
      member => member.roles.includes('practitioner') && member.is_active
    );
    return practitionerMembers.map(m => m.id).sort((a, b) => a - b); // Sort for stable cache key
  }, [isClinicAdmin, membersData]);

  // Use React Query for batch practitioner status to enable caching and request deduplication
  const { data: batchPractitionerStatusData, error: batchPractitionerStatusError } = useBatchPractitionerStatus(practitionerIds);

  // Compute warnings from fetched data
  useEffect(() => {
    if (isLoading || !user?.user_id) {
      setLoading(true);
      return;
    }

    // Check for errors - if critical data failed to load, show defaults
    const hasErrors = (isClinicAdmin && (clinicSettingsError || membersError)) ||
      (hasRole && hasRole('practitioner') && practitionerStatusError) ||
      (isClinicAdmin && batchPractitionerStatusError);

    if (hasErrors) {
      // Log errors but continue with defaults to avoid breaking the UI
      logger.warn('Some warning data failed to load, using defaults', {
        clinicSettingsError,
        membersError,
        practitionerStatusError,
        batchPractitionerStatusError
      });
    }

    try {
      // Fetch clinic warnings if user is admin
      let clinicWarnings = { hasAppointmentTypes: true };
      if (isClinicAdmin && clinicSettingsData) {
        clinicWarnings = {
          hasAppointmentTypes: clinicSettingsData.appointment_types.length > 0
        };
      }

      // Fetch practitioner's own warnings if they are a practitioner
      let practitionerWarnings = { hasAppointmentTypes: true, hasAvailability: true };
      if (hasRole && hasRole('practitioner') && practitionerStatusData) {
        practitionerWarnings = {
          hasAppointmentTypes: practitionerStatusData.has_appointment_types,
          hasAvailability: practitionerStatusData.has_availability
        };
      }

      // Fetch admin warnings if user is admin - use batch endpoint
      let adminWarnings: Array<{ id: number; full_name: string; hasAppointmentTypes: boolean; hasAvailability: boolean }> = [];
      if (isClinicAdmin && membersData && batchPractitionerStatusData) {
        const practitionerMembers = membersData.filter(
          member => member.roles.includes('practitioner') && member.is_active
        );

        if (practitionerMembers.length > 0 && batchPractitionerStatusData.results.length > 0) {
          // Create a map for quick lookup
          const statusMap = new Map(
            batchPractitionerStatusData.results.map(result => [result.user_id, result])
          );

          // Build admin warnings from batch response
          for (const member of practitionerMembers) {
            const status = statusMap.get(member.id);
            if (status && (!status.has_appointment_types || !status.has_availability)) {
              adminWarnings.push({
                id: member.id,
                full_name: member.full_name,
                hasAppointmentTypes: status.has_appointment_types,
                hasAvailability: status.has_availability
              });
            }
          }
        }
      }

      setWarnings({
        clinicWarnings,
        practitionerWarnings,
        adminWarnings
      });
    } catch (err: any) {
      // Silently handle network/CORS errors during auth recovery
      // These are expected when returning to tab after being in background
      const isNetworkError = err?.code === 'ERR_NETWORK' ||
        err?.message?.includes('Network Error') ||
        err?.message?.includes('Load failed') ||
        err?.message?.includes('CORS');

      if (!isNetworkError) {
        // Only log non-network errors (actual API failures)
        logger.error('Error computing warnings:', err);
      }
    } finally {
      setLoading(false);
    }
  }, [isLoading, user, isClinicAdmin, hasRole, clinicSettingsData, membersData, practitionerStatusData, batchPractitionerStatusData]);

  // Refresh warnings when navigating away from settings/profile pages
  // Invalidate React Query cache when navigating away from settings
  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    const currentPathname = location.pathname;

    // Settings pages that might affect warnings
    const isSettingsPage = (path: string) => path.startsWith('/admin/clinic/settings') || path === '/admin/profile';

    // Only refresh if navigating away from settings pages
    if (previousPathname && isSettingsPage(previousPathname) && !isSettingsPage(currentPathname)) {
      const activeClinicId = user?.active_clinic_id;

      // Invalidate cache to ensure fresh data after settings changes
      queryClient.invalidateQueries({ queryKey: ['settings', 'clinic', activeClinicId] });
      queryClient.invalidateQueries({ queryKey: ['members', activeClinicId] });

      // Also invalidate practitioner status caches
      queryClient.invalidateQueries({ queryKey: ['practitioner-status'] });
      queryClient.invalidateQueries({ queryKey: ['batch-practitioner-status'] });
    }

    // Update previous pathname for next navigation
    previousPathnameRef.current = currentPathname;
  }, [location.pathname, user, isClinicAdmin, hasRole, queryClient]);

  const hasAnyWarnings = !warnings.clinicWarnings.hasAppointmentTypes ||
    !warnings.practitionerWarnings.hasAppointmentTypes ||
    !warnings.practitionerWarnings.hasAvailability ||
    warnings.adminWarnings.length > 0;

  if (loading || !hasAnyWarnings) {
    return null;
  }

  return (
    <div className="relative z-40 bg-amber-50 border-b border-amber-200 py-3">
      <div className="max-w-7xl mx-auto sm:px-6 lg:px-8">
        <div className="px-4 py-0 sm:px-0">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <span className="text-amber-600 text-lg">⚠️</span>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-amber-800">設定提醒</h3>
                <div className="mt-2 space-y-2">
                  {/* Clinic warnings */}
                  {!warnings.clinicWarnings.hasAppointmentTypes && isClinicAdmin && (
                    <div className="text-sm text-amber-700">
                      <strong>診所的預約功能未啟用：</strong>請前往{' '}
                      <Link to="/admin/clinic/settings" className="text-amber-800 underline hover:text-amber-900">
                        診所設定頁面
                      </Link>
                      {' '}設定診所提供的服務項目
                    </div>
                  )}

                  {/* Practitioner warnings */}
                  {(!warnings.practitionerWarnings.hasAppointmentTypes || !warnings.practitionerWarnings.hasAvailability) && (
                    <div className="text-sm text-amber-700">
                      <strong>您個人的預約功能未啟用：</strong>
                      {!warnings.practitionerWarnings.hasAppointmentTypes && !warnings.practitionerWarnings.hasAvailability && '未設定個人的預約類型和診療時段'}
                      {!warnings.practitionerWarnings.hasAppointmentTypes && warnings.practitionerWarnings.hasAvailability && '未設定個人的預約類型'}
                      {warnings.practitionerWarnings.hasAppointmentTypes && !warnings.practitionerWarnings.hasAvailability && '未設定診療時段'}
                      ，請前往{' '}
                      <Link to="/admin/profile" className="text-amber-800 underline hover:text-amber-900">
                        個人設定頁面
                      </Link>
                      {' '}設定
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
                            {!practitioner.hasAppointmentTypes && !practitioner.hasAvailability && '未設定個人的預約類型和診療時段'}
                            {!practitioner.hasAppointmentTypes && practitioner.hasAvailability && '未設定個人的預約類型'}
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
      </div>
    </div>
  );
};

const ClinicLayout: React.FC<ClinicLayoutProps> = ({ children }) => {
  const {
    user,
    logout,
    switchClinic,
    availableClinics,
    isSwitchingClinic,
    isClinicAdmin,
    hasRole
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const { hasUnsavedChanges } = useUnsavedChanges();
  const { confirm } = useModal();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [openDropdowns, setOpenDropdowns] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      logger.error('Logout failed:', error);
    }
  };

  const handleNavigation = useCallback(async (href: string) => {
    if (hasUnsavedChanges && (location.pathname === '/admin/profile' || location.pathname.startsWith('/admin/clinic/settings'))) {
      const confirmed = await confirm('您有未儲存的變更，確定要離開嗎？', '確認離開');
      if (!confirmed) {
        return;
      }
    }
    navigate(href);
    setOpenDropdowns([]);
  }, [hasUnsavedChanges, location.pathname, navigate, confirm]);

  const navigationGroups = useMemo(() => [
    {
      name: '預約管理',
      icon: '📅',
      items: [
        { name: '行事曆', href: '/admin/calendar', icon: '📅', show: true },
        { name: '待審核預約', href: '/admin/clinic/pending-review-appointments', icon: '📋', show: isClinicAdmin || (hasRole && hasRole('practitioner')) },
      ]
    },
    {
      name: '病患管理',
      icon: '👥',
      items: [
        { name: '病患列表', href: '/admin/clinic/patients', icon: '👥', show: true },
        { name: 'LINE 使用者', href: '/admin/clinic/line-users', icon: '🤖', show: true },
      ]
    },
    {
      name: '診所管理',
      icon: '🏥',
      items: [
        { name: '儀表板', href: '/admin/clinic/dashboard', icon: '📊', show: true },
        { name: '診所設定', href: '/admin/clinic/settings', icon: '⚙️', show: true },
        { name: '診所成員', href: '/admin/clinic/members', icon: '👥', show: true },
      ]
    },
    {
      name: '個人設定',
      icon: '👤',
      href: '/admin/profile',
      show: true,
    }
  ], [isClinicAdmin]);

  const isActive = (href: string) => {
    return location.pathname === href;
  };

  const isGroupActive = (group: typeof navigationGroups[0]) => {
    if (group.href) {
      return isActive(group.href);
    }
    if ('items' in group) {
      return group.items.some(item => isActive(item.href));
    }
    return false;
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(target);
      const isOutsideMobileMenu = mobileMenuRef.current && !mobileMenuRef.current.contains(target);

      // Only close if clicking outside both desktop dropdowns and mobile menu
      if (isOutsideDropdown && (!isMobileMenuOpen || isOutsideMobileMenu)) {
        setOpenDropdowns([]);
      }
    };

    if (openDropdowns.length > 0) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return undefined;
  }, [openDropdowns]);


  return (
    <div className="min-h-screen bg-white">
      {/* Top Navigation */}
      <nav className="relative z-50 bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              {/* Logo */}
              <div className="flex-shrink-0 flex items-center">
                <div className="flex items-center space-x-2">
                  <span className="text-2xl">🏥</span>
                  <span className="text-xl font-bold text-gray-900">診所小幫手</span>
                </div>
              </div>

              {/* Desktop Navigation - Only show on lg screens and up */}
              <div className="hidden lg:ml-6 lg:flex lg:items-center lg:space-x-4" ref={dropdownRef}>
                {navigationGroups.map((group) => {
                  if (group.href) {
                    // Single item (個人設定)
                    return (
                      <button
                        key={group.name}
                        onClick={() => handleNavigation(group.href!)}
                        className={`${isActive(group.href)
                          ? 'border-primary-500 text-gray-900'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                          } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium whitespace-nowrap`}
                      >
                        <span className="mr-2">{group.icon}</span>
                        {group.name}
                      </button>
                    );
                  } else if ('items' in group) {
                    // Group with dropdown
                    const isOpen = openDropdowns.includes(group.name);
                    const groupIsActive = isGroupActive(group);
                    const visibleItems = group.items.filter(item => item.show);

                    if (visibleItems.length === 0) return null;

                    return (
                      <div key={group.name} className="relative">
                        <button
                          onClick={() => setOpenDropdowns(prev =>
                            prev.includes(group.name)
                              ? []
                              : [group.name]
                          )}
                          className={`${groupIsActive
                            ? 'border-primary-500 text-gray-900'
                            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                            } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium whitespace-nowrap`}
                        >
                          <span className="mr-2">{group.icon}</span>
                          {group.name}
                          <svg
                            className={`ml-1 h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {isOpen && (
                          <div className="absolute left-0 top-full mt-1 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
                            <div className="py-1">
                              {visibleItems.map((item) => (
                                <button
                                  key={item.name}
                                  onClick={() => {
                                    handleNavigation(item.href);
                                    setOpenDropdowns([]);
                                  }}
                                  className={`${isActive(item.href)
                                    ? 'bg-primary-50 text-primary-700'
                                    : 'text-gray-700 hover:bg-gray-50'
                                    } block w-full text-left px-4 py-2 text-sm whitespace-nowrap`}
                                >
                                  <span className="mr-2">{item.icon}</span>
                                  {item.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>

            {/* User Menu - Only show on lg screens and up */}
            <div className="hidden lg:ml-6 lg:flex lg:items-center">
              <div className="ml-3 relative">
                <div className="flex items-center space-x-4">
                  {/* Clinic Switcher */}
                  {user && user.user_type === 'clinic_user' && (
                    <ClinicSwitcher
                      currentClinicId={user.active_clinic_id}
                      availableClinics={availableClinics}
                      onSwitch={switchClinic}
                      isSwitching={isSwitchingClinic}
                    />
                  )}

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

            {/* Mobile menu button - Show on md and below */}
            <div className="lg:hidden flex items-center">
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

        {/* Mobile menu - Show on md and below */}
        {isMobileMenuOpen && (
          <div
            className="lg:hidden"
            ref={mobileMenuRef}
          >
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white border-t border-gray-200">
              {navigationGroups.map((group) => {
                if (group.href) {
                  // Single item (個人設定)
                  return (
                    <button
                      key={group.name}
                      onClick={() => {
                        handleNavigation(group.href!);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`${isActive(group.href)
                        ? 'bg-primary-50 border-primary-500 text-primary-700'
                        : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                        } block pl-3 pr-4 py-2 border-l-4 text-base font-medium w-full text-left`}
                    >
                      <span className="mr-2">{group.icon}</span>
                      {group.name}
                    </button>
                  );
                } else if ('items' in group) {
                  // Group with items
                  const visibleItems = group.items.filter(item => item.show);
                  if (visibleItems.length === 0) return null;

                  const groupIsOpen = openDropdowns.includes(group.name);

                  return (
                    <div key={group.name}>
                      <button
                        onClick={() => setOpenDropdowns(prev =>
                          prev.includes(group.name)
                            ? prev.filter(n => n !== group.name)
                            : [...prev, group.name]
                        )}
                        className={`${isGroupActive(group)
                          ? 'bg-primary-50 border-primary-500 text-primary-700'
                          : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                          } flex items-center justify-between pl-3 pr-4 py-2 border-l-4 text-base font-medium w-full text-left`}
                      >
                        <span>
                          <span className="mr-2">{group.icon}</span>
                          {group.name}
                        </span>
                        <svg
                          className={`h-5 w-5 transition-transform ${groupIsOpen ? 'rotate-180' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {groupIsOpen && (
                        <div className="pl-6 space-y-1">
                          {visibleItems.map((item) => (
                            <button
                              key={item.name}
                              onClick={() => {
                                handleNavigation(item.href);
                                setIsMobileMenuOpen(false);
                                // Keep dropdowns open for better UX when returning
                              }}
                              className={`${isActive(item.href)
                                ? 'text-primary-700 font-medium'
                                : 'text-gray-600'
                                } block w-full text-left px-4 py-2 text-sm hover:bg-gray-50`}
                            >
                              <span className="mr-2">{item.icon}</span>
                              {item.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })}
            </div>
            <div className="pt-4 pb-3 border-t border-gray-200">
              <div className="flex items-center px-5">
                <div className="text-base font-medium text-gray-800">{user?.full_name}</div>
              </div>
              {/* Clinic Switcher for Mobile */}
              {user && user.user_type === 'clinic_user' && (
                <div className="mt-3 px-5">
                  <ClinicSwitcher
                    currentClinicId={user.active_clinic_id}
                    availableClinics={availableClinics}
                    onSwitch={switchClinic}
                    isSwitching={isSwitchingClinic}
                  />
                </div>
              )}
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
      <main className="max-w-7xl mx-auto py-2 md:py-6 sm:px-6 lg:px-8 pt-16">
        <div className="px-4 py-2 md:py-6 sm:px-0 md:max-w-4xl md:mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default ClinicLayout;
