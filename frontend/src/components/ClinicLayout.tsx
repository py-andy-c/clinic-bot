import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';
import { useModal } from '../contexts/ModalContext';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import ClinicSwitcher from './ClinicSwitcher';

interface ClinicLayoutProps {
  children: React.ReactNode;
}

// Global Warnings Component
const GlobalWarnings: React.FC = () => {
  const { user, isClinicAdmin, hasRole, isLoading } = useAuth();
  const location = useLocation();
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
  const handleFocusRef = useRef<() => void>();

  // Cache warnings data to avoid redundant API calls when switching tabs
  // Key: `${user.user_id}-${isClinicAdmin}-${hasRole('practitioner')}`
  const cachedWarningsRef = useRef<Map<string, { data: typeof warnings; timestamp: number }>>(new Map());
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  const fetchWarnings = useCallback(async () => {
    if (!user?.user_id) return;

    // Create cache key based on user context
    const cacheKey = `${user.user_id}-${isClinicAdmin}-${hasRole && hasRole('practitioner')}`;

    // Check cache first
    const cached = cachedWarningsRef.current.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      // Use cached data - no API call needed
      setWarnings(cached.data);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch clinic warnings if user is admin
      let clinicWarnings = { hasAppointmentTypes: true };
      if (isClinicAdmin) {
        try {
          const clinicSettings = await apiService.getClinicSettings();
          clinicWarnings = {
            hasAppointmentTypes: clinicSettings.appointment_types.length > 0
          };
        } catch (err) {
          logger.error('Error fetching clinic settings:', err);
        }
      }

      // Fetch practitioner's own warnings if they are a practitioner
      let practitionerWarnings = { hasAppointmentTypes: true, hasAvailability: true };
      if (hasRole && hasRole('practitioner')) {
        const status = await apiService.getPractitionerStatus(user.user_id);
        practitionerWarnings = {
          hasAppointmentTypes: status.has_appointment_types,
          hasAvailability: status.has_availability
        };
      }

      // Fetch admin warnings if user is admin - use batch endpoint
      let adminWarnings: Array<{ id: number; full_name: string; hasAppointmentTypes: boolean; hasAvailability: boolean }> = [];
      if (isClinicAdmin) {
        const members = await apiService.getMembers();
        const practitionerMembers = members.filter(
          member => member.roles.includes('practitioner') && member.is_active
        );

        if (practitionerMembers.length > 0) {
          try {
            // Use batch endpoint to fetch all practitioner statuses in one call
            const practitionerIds = practitionerMembers.map(m => m.id);
            const batchStatus = await apiService.getBatchPractitionerStatus(practitionerIds);

            // Create a map for quick lookup
            const statusMap = new Map(
              batchStatus.results.map(result => [result.user_id, result])
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
          } catch (err) {
            logger.error('Error fetching batch practitioner status:', err);
            // Fallback: continue without admin warnings rather than failing completely
          }
        }
      }

      const warningsData = {
        clinicWarnings,
        practitionerWarnings,
        adminWarnings
      };

      // Cache the data
      cachedWarningsRef.current.set(cacheKey, {
        data: warningsData,
        timestamp: Date.now()
      });

      // Clean up old cache entries (older than TTL)
      const now = Date.now();
      for (const [key, value] of cachedWarningsRef.current.entries()) {
        if (now - value.timestamp >= CACHE_TTL) {
          cachedWarningsRef.current.delete(key);
        }
      }

      setWarnings(warningsData);
    } catch (err: any) {
      // Silently handle network/CORS errors during auth recovery
      // These are expected when returning to tab after being in background
      const isNetworkError = err?.code === 'ERR_NETWORK' || 
                            err?.message?.includes('Network Error') ||
                            err?.message?.includes('Load failed') ||
                            err?.message?.includes('CORS');
      
      if (!isNetworkError) {
        // Only log non-network errors (actual API failures)
        logger.error('Error fetching warnings:', err);
      }
    } finally {
      setLoading(false);
    }
  }, [user, isClinicAdmin, hasRole]);

  // Initial fetch on mount - wait for auth to complete before fetching
  useEffect(() => {
    // Wait for auth to complete before fetching data
    if (!isLoading && user) {
      fetchWarnings();
    }
  }, [isLoading, user, fetchWarnings]);

  // Refresh warnings when navigating away from settings/profile pages
  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    const currentPathname = location.pathname;

    // Settings pages that might affect warnings
    const settingsPages = ['/admin/clinic/settings', '/admin/profile'];

    // Only refresh if navigating away from settings pages
    if (previousPathname && settingsPages.includes(previousPathname) && !settingsPages.includes(currentPathname)) {
      // Invalidate cache to ensure fresh data after settings changes
      if (user?.user_id) {
        const cacheKey = `${user.user_id}-${isClinicAdmin}-${hasRole && hasRole('practitioner')}`;
        cachedWarningsRef.current.delete(cacheKey);
      }
      fetchWarnings();
    }

    // Update previous pathname for next navigation
    previousPathnameRef.current = currentPathname;
  }, [location.pathname, fetchWarnings, user, isClinicAdmin, hasRole]);

  // Refresh warnings when window regains focus (e.g., user returns to tab after saving settings)
  // Update ref with latest fetchWarnings function whenever it changes
  useEffect(() => {
    handleFocusRef.current = fetchWarnings;
  }, [fetchWarnings]);

  // Set up stable event listener that always calls the latest fetchWarnings via ref
  useEffect(() => {
    const handleFocus = () => {
      handleFocusRef.current?.();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, []); // Empty deps - stable handler that reads from ref

  const hasAnyWarnings = !warnings.clinicWarnings.hasAppointmentTypes ||
                         !warnings.practitionerWarnings.hasAppointmentTypes ||
                         !warnings.practitionerWarnings.hasAvailability ||
                         warnings.adminWarnings.length > 0;

  if (loading || !hasAnyWarnings) {
    return null;
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 py-3">
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
    isClinicAdmin
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { hasUnsavedChanges } = useUnsavedChanges();
  const { confirm } = useModal();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      logger.error('Logout failed:', error);
    }
  };

  const handleNavigation = useCallback(async (href: string) => {
    if (hasUnsavedChanges && (location.pathname === '/admin/profile' || location.pathname === '/admin/clinic/settings')) {
      const confirmed = await confirm('您有未儲存的變更，確定要離開嗎？', '確認離開');
      if (!confirmed) {
        return;
      }
    }
    navigate(href);
  }, [hasUnsavedChanges, location.pathname, navigate, confirm]);

  const navigationGroups = useMemo(() => [
    {
      name: '預約管理',
      icon: '📅',
      items: [
        { name: '行事曆', href: '/admin/calendar', icon: '📅', show: true },
        { name: '自動指派預約', href: '/admin/clinic/auto-assigned-appointments', icon: '📋', show: isClinicAdmin },
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
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    };

    if (openDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return undefined;
  }, [openDropdown]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
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

              {/* Desktop Navigation */}
              <div className="hidden md:ml-6 md:flex md:items-center md:space-x-4" ref={dropdownRef}>
                {navigationGroups.map((group) => {
                  if (group.href) {
                    // Single item (個人設定)
                    return (
                      <button
                        key={group.name}
                        onClick={() => handleNavigation(group.href!)}
                        className={`${
                          isActive(group.href)
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
                    const isOpen = openDropdown === group.name;
                    const groupIsActive = isGroupActive(group);
                    const visibleItems = group.items.filter(item => item.show);
                    
                    if (visibleItems.length === 0) return null;

                    return (
                      <div key={group.name} className="relative">
                        <button
                          onClick={() => setOpenDropdown(isOpen ? null : group.name)}
                          className={`${
                            groupIsActive
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
                                    setOpenDropdown(null);
                                  }}
                                  className={`${
                                    isActive(item.href)
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

            {/* User Menu */}
            <div className="hidden md:ml-6 md:flex md:items-center">
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
                      className={`${
                        isActive(group.href)
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
                  
                  const groupIsOpen = openDropdown === group.name;
                  
                  return (
                    <div key={group.name}>
                      <button
                        onClick={() => setOpenDropdown(groupIsOpen ? null : group.name)}
                        className={`${
                          isGroupActive(group)
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
                                setOpenDropdown(null);
                              }}
                              className={`${
                                isActive(item.href)
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
      <main className="max-w-7xl mx-auto py-2 md:py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-2 md:py-6 sm:px-0">
          {children}
        </div>
      </main>
    </div>
  );
};

export default ClinicLayout;
