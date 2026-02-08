import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDebouncedSearch } from '../utils/searchUtils';
import { useIsMobile } from '../hooks/useIsMobile';
import { ActionableCard, LoadingSpinner, ErrorMessage, SearchInput, PaginationControls } from '../components/shared';
import { PatientCreationModal } from '../components/PatientCreationModal';
import { PatientCreationSuccessModal } from '../components/PatientCreationSuccessModal';
import { CreateAppointmentModal } from '../components/calendar/CreateAppointmentModal';
import { useModal } from '../contexts/ModalContext';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import { extractAppointmentDateTime } from '../utils/timezoneUtils';
import { EMPTY_ARRAY } from '../utils/constants';
import { Patient, Practitioner } from '../types';
import { usePatients, usePractitioners, useClinicSettings } from '../hooks/queries';
import { useHighlightRow } from '../hooks/useHighlightRow';
import { useCreateAppointmentOptimistic } from '../hooks/queries/useAvailabilitySlots';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../hooks/useAuth';

// Component to handle profile picture with fallback on error
const ProfilePictureWithFallback: React.FC<{
  src: string | null | undefined;
  alt: string;
  size: 'small' | 'medium';
}> = ({ src, alt, size }) => {
  const [imageError, setImageError] = React.useState(false);

  // Reset error state when src changes
  React.useEffect(() => {
    setImageError(false);
  }, [src]);

  if (!src || imageError) {
    const containerClass = size === 'small' ? 'w-6 h-6' : 'w-8 h-8';
    const iconClass = size === 'small' ? 'w-4 h-4' : 'w-5 h-5';
    return (
      <div className={`${containerClass} rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0`}>
        <svg className={`${iconClass} text-gray-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </div>
    );
  }

  const imageClass = size === 'small' ? 'w-6 h-6' : 'w-8 h-8';
  return (
    <img
      src={src}
      alt={alt}
      className={`${imageClass} rounded-full object-cover flex-shrink-0`}
      onError={() => setImageError(true)}
    />
  );
};

const PatientsPage: React.FC = () => {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Patient creation modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [createdPatientId, setCreatedPatientId] = useState<number | null>(null);
  const [createdPatientName, setCreatedPatientName] = useState<string>('');
  const [createdPatientPhone, setCreatedPatientPhone] = useState<string | null>(null);
  const [createdPatientBirthday, setCreatedPatientBirthday] = useState<string | null>(null);

  // Appointment creation modal state
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);
  const [selectedPatientIdForAppointment, setSelectedPatientIdForAppointment] = useState<number | undefined>(undefined);
  const [selectedPatientNameForAppointment, setSelectedPatientNameForAppointment] = useState<string | undefined>(undefined);

  // Check if user can create patients (admin or practitioner)
  const canCreatePatient = useMemo(() => {
    if (!user?.roles) return false;
    return user.roles.includes('admin') || user.roles.includes('practitioner');
  }, [user?.roles]);

  // Get pagination state from URL with validation
  const currentPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  // Default page size increased from 10 to 25 for better UX (fewer pagination clicks)
  const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get('pageSize') || '25', 10) || 25));

  // Server-side search functionality (declare before useCallback)
  const [searchInput, setSearchInput] = useState<string>('');
  const [isComposing, setIsComposing] = useState(false);
  const debouncedSearchQuery = useDebouncedSearch(searchInput, 400, isComposing);

  // Practitioner filter
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | undefined>(() => {
    const practitionerIdParam = searchParams.get('practitioner_id');
    return practitionerIdParam ? parseInt(practitionerIdParam, 10) : undefined;
  });


  const { data: patientsData, isLoading: loading, error, refetch } = usePatients(
    currentPage,
    pageSize,
    debouncedSearchQuery || undefined,
    selectedPractitionerId || undefined
  );

  // Keep previous data visible during loading to prevent flicker
  const [previousPatientsData, setPreviousPatientsData] = useState<{
    patients: Patient[];
    total: number;
    page: number;
    page_size: number;
  } | null>(null);

  // Update previous data when new data arrives (not during loading)
  useEffect(() => {
    if (!loading && patientsData) {
      setPreviousPatientsData(patientsData);
    }
  }, [loading, patientsData]);

  // Use previous data if currently loading, otherwise use current data
  const displayData = loading && previousPatientsData ? previousPatientsData : patientsData;
  const patients = displayData?.patients || [];
  const totalPatients = displayData?.total || 0;
  const totalPages = Math.ceil(totalPatients / pageSize);

  // Validate currentPage doesn't exceed totalPages and reset if needed
  // This runs after we have totalPages from the API response
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      // Page exceeds total, reset to page 1
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.set('page', '1');
      setSearchParams(newSearchParams, { replace: true });
    }
  }, [currentPage, totalPages, searchParams, setSearchParams]);

  // Use validated page for display (clamp to valid range)
  const validatedPage = Math.max(1, Math.min(currentPage, totalPages || 1));

  // Fetch clinic settings to check if birthday column should be shown
  const { data: clinicSettings } = useClinicSettings();

  // Birthday column removed - no longer shown in patient list
  const hasHandledQueryRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { alert } = useModal();

  // Fetch practitioners for appointment modal and filter dropdown
  const { data: practitionersData } = usePractitioners();

  // Optimistic update hook for appointment creation
  const createAppointmentMutation = useCreateAppointmentOptimistic();

  const practitioners = practitionersData || EMPTY_ARRAY;
  const appointmentTypes = clinicSettings?.appointment_types || EMPTY_ARRAY;

  // Memoize PageHeader to prevent re-renders when only data changes
  // Must be called before any conditional returns to follow Rules of Hooks
  const pageHeader = useMemo(() => (
    <PageHeader
      title="病患管理"
      action={
        canCreatePatient && !searchInput.trim() ? (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="btn btn-primary whitespace-nowrap flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新增病患
          </button>
        ) : undefined
      }
    />
  ), [canCreatePatient, searchInput]);

  // Focus preservation is now handled inside SearchInput component
  // No need for additional focus logic here

  // Reset to page 1 when search query or practitioner filter changes
  const prevSearchQueryRef = useRef<string>('');
  const prevPractitionerIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const searchChanged = prevSearchQueryRef.current !== debouncedSearchQuery;
    const practitionerChanged = prevPractitionerIdRef.current !== selectedPractitionerId;

    if ((searchChanged || practitionerChanged) && currentPage !== 1) {
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.set('page', '1');
      if (selectedPractitionerId !== undefined) {
        newSearchParams.set('practitioner_id', selectedPractitionerId.toString());
      } else {
        newSearchParams.delete('practitioner_id');
      }
      setSearchParams(newSearchParams, { replace: true });
    }

    prevSearchQueryRef.current = debouncedSearchQuery;
    prevPractitionerIdRef.current = selectedPractitionerId;
  }, [debouncedSearchQuery, selectedPractitionerId, currentPage, searchParams, setSearchParams]);

  // Handle page change
  const handlePageChange = useCallback((page: number) => {
    // Validate page is within bounds
    const validPage = Math.max(1, Math.min(page, totalPages));
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set('page', validPage.toString());
    setSearchParams(newSearchParams, { replace: true });
    // Scroll to top when page changes
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [searchParams, setSearchParams, totalPages]);


  // Get patient ID to highlight from query parameter
  // NOTE: This only searches within the current page's results.
  // If the patient is on a different page, it won't be found.
  // Server-side search (Phase 3) would allow finding and navigating to the correct page.
  const patientNameFromQuery = searchParams.get('patientName');
  const targetPatientId = useMemo(() => {
    if (!patientNameFromQuery || patients.length === 0) return null;
    const term = patientNameFromQuery.toLowerCase();
    const matchingPatients = patients.filter((p: Patient) =>
      p.full_name.toLowerCase().includes(term) ||
      (p.phone_number && p.phone_number.includes(term))
    );
    const firstPatient = matchingPatients[0];
    return firstPatient ? firstPatient.id.toString() : null;
  }, [patientNameFromQuery, patients]);

  // Use highlight hook for navigation from Line Users page
  const highlightedPatientId = useHighlightRow(targetPatientId, 'data-patient-id');

  // Handle patient creation success
  const handlePatientCreated = useCallback((
    patientId: number,
    patientName: string,
    phoneNumber: string | null,
    birthday: string | null
  ) => {
    setCreatedPatientId(patientId);
    setCreatedPatientName(patientName);
    setCreatedPatientPhone(phoneNumber);
    setCreatedPatientBirthday(birthday);
    setIsCreateModalOpen(false);
    setIsSuccessModalOpen(true);
    // Refetch patients list to show new patient
    refetch();
  }, [refetch]);

  // Handle success modal close
  const handleSuccessModalClose = useCallback(() => {
    setIsSuccessModalOpen(false);
    setCreatedPatientId(null);
    setCreatedPatientName('');
    setCreatedPatientPhone(null);
    setCreatedPatientBirthday(null);
  }, []);

  // Handle navigation from Line Users page
  useEffect(() => {
    if (patientNameFromQuery && patients.length > 0 && !hasHandledQueryRef.current) {
      // Mark as handled
      hasHandledQueryRef.current = true;

      // Auto-fill search with patient name
      setSearchInput(patientNameFromQuery);

      // Remove query parameter after handling
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('patientName');
      setSearchParams(newSearchParams, { replace: true });
    }

    // Reset ref when patientName query is removed
    if (!patientNameFromQuery) {
      hasHandledQueryRef.current = false;
    }
  }, [patientNameFromQuery, patients, searchParams, setSearchParams]);

  // Only show full-page loading on initial load (when we have no previous data)
  // During search/deletion, keep previous data visible
  if (loading && !previousPatientsData) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <>
        {pageHeader}
        <ErrorMessage message={error?.message || 'Unable to load patients'} onRetry={refetch} />
      </>
    );
  }

  return (
    <>
      {/* Header */}
      {pageHeader}

      <div className="space-y-8">
        {/* Patients List */}
        <div className="bg-white md:rounded-lg md:shadow-md p-0 md:p-6">
          <div className="space-y-4">
            {/* Search Bar and Filters */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <SearchInput
                  ref={searchInputRef}
                  value={searchInput}
                  onChange={setSearchInput}
                  onCompositionStart={() => { setIsComposing(true); }}
                  onCompositionEnd={() => { setIsComposing(false); }}
                  placeholder="搜尋病患姓名、電話或LINE使用者名稱..."
                />
              </div>
              <div className="sm:w-48">
                <select
                  value={selectedPractitionerId || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedPractitionerId(value ? parseInt(value, 10) : undefined);
                  }}
                  aria-label="負責人員"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="" disabled hidden>負責人員</option>
                  <option value="">全部</option>
                  {practitioners.map((practitioner: Practitioner) => (
                    <option key={practitioner.id} value={practitioner.id}>
                      {practitioner.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!loading && totalPatients === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">尚未有病患註冊</p>
              </div>
            ) : !loading && patients.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">
                  {searchInput.trim()
                    ? '找不到符合搜尋條件的病患'
                    : '目前頁面沒有病患'}
                </p>
              </div>
            ) : (
              <>
                {isMobile ? (
                  <div className="space-y-4">
                    {patients.map((patient: Patient) => (
                      <ActionableCard
                        key={patient.id}
                        title={
                          <div className="flex items-center gap-2">
                            <span>{patient.full_name}</span>
                            {patient.is_deleted && (
                              <span
                                className="text-amber-500 text-sm"
                                title="此病患已自行刪除帳號。病患無法自行預約，但診所仍可查看、編輯此病患資料，並為其安排預約。"
                              >
                                ⚠️
                              </span>
                            )}
                          </div>
                        }
                        leading={
                          <ProfilePictureWithFallback
                            src={patient.line_user_picture_url}
                            alt={patient.line_user_display_name || patient.full_name}
                            size="medium"
                          />
                        }
                        metadata={[
                          {
                            icon: (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                              </svg>
                            ),
                            label: patient.phone_number || '未設定電話'
                          },
                          ...(patient.line_user_display_name ? [
                            {
                              icon: (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                              ),
                              label: (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const lineUserId = patient.line_user_id;
                                    if (lineUserId) {
                                      navigate(`/admin/clinic/line-users?lineUserId=${encodeURIComponent(lineUserId)}`);
                                    }
                                  }}
                                  className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left"
                                >
                                  {patient.line_user_display_name}
                                </button>
                              )
                            }
                          ] : [])
                        ]}
                        actions={[
                          {
                            label: '查看',
                            onClick: () => navigate(`/admin/clinic/patients/${patient.id}`),
                            variant: 'secondary'
                          },
                          {
                            label: '預約',
                            onClick: () => {
                              setSelectedPatientIdForAppointment(patient.id);
                              setSelectedPatientNameForAppointment(patient.full_name);
                              setIsAppointmentModalOpen(true);
                            },
                            variant: 'primary'
                          }
                        ]}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="overflow-x-auto relative">
                    <table className="w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 z-10 bg-gray-50" style={{ minWidth: '80px' }}>
                            病患姓名
                          </th>
                          <th className="px-2 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '90px' }}>
                            手機號碼
                          </th>
                          <th className="px-2 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '100px' }}>
                            LINE 使用者
                          </th>
                          <th className="px-2 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ minWidth: '150px' }}>
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {patients.map((patient: Patient) => (
                          <tr
                            key={patient.id}
                            data-patient-id={patient.id}
                            className={`group hover:bg-gray-50 transition-colors ${highlightedPatientId === patient.id.toString() ? 'bg-blue-50' : ''
                              }`}
                          >
                            <td className={`px-2 py-2 md:px-6 md:py-4 sticky left-0 z-10 transition-colors ${highlightedPatientId === patient.id.toString()
                              ? 'bg-blue-50 group-hover:bg-blue-50'
                              : 'bg-white group-hover:bg-gray-50'
                              }`} style={{ minWidth: '80px' }}>
                              <div className="flex items-center gap-1 md:gap-2">
                                <span className="text-sm font-medium text-gray-900 truncate max-w-[60px] md:max-w-none">
                                  {patient.full_name}
                                </span>
                                {patient.is_deleted && (
                                  <span
                                    className="text-amber-500 flex-shrink-0"
                                    title="此病患已自行刪除帳號。病患無法自行預約，但診所仍可查看、編輯此病患資料，並為其安排預約。"
                                  >
                                    ⚠️
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2 md:px-6 md:py-4 whitespace-nowrap text-sm text-gray-500" style={{ minWidth: '90px' }}>
                              {patient.phone_number || '-'}
                            </td>
                            <td className="px-2 py-2 md:px-6 md:py-4 text-sm" style={{ minWidth: '100px' }}>
                              {patient.line_user_id ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const lineUserId = patient.line_user_id;
                                    if (lineUserId) {
                                      navigate(`/admin/clinic/line-users?lineUserId=${encodeURIComponent(lineUserId)}`);
                                    }
                                  }}
                                  className="flex items-center gap-1 md:gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
                                >
                                  <ProfilePictureWithFallback
                                    src={patient.line_user_picture_url}
                                    alt={patient.line_user_display_name || 'LINE user'}
                                    size="small"
                                  />
                                  <span className="truncate max-w-[100px] md:max-w-none">{patient.line_user_display_name || '未設定名稱'}</span>
                                </button>
                              ) : (
                                <span className="text-sm text-gray-500">-</span>
                              )}
                            </td>
                            <td className="px-2 py-2 md:px-6 md:py-4 whitespace-nowrap text-sm text-center space-x-2" style={{ minWidth: '150px' }}>
                              <button
                                onClick={() => navigate(`/admin/clinic/patients/${patient.id}`)}
                                className="px-2 py-1 text-blue-600 hover:bg-blue-50 rounded-md font-medium transition-colors"
                              >
                                查看
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedPatientIdForAppointment(patient.id);
                                  setSelectedPatientNameForAppointment(patient.full_name);
                                  setIsAppointmentModalOpen(true);
                                }}
                                className="px-2 py-1 text-teal-600 hover:bg-teal-50 rounded-md font-medium transition-colors"
                              >
                                預約
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {totalPages > 1 && (
                  <div className="mt-2 pt-2 md:mt-4 md:pt-4 border-t border-gray-200">
                    <PaginationControls
                      currentPage={validatedPage}
                      totalPages={totalPages}
                      totalItems={totalPatients}
                      pageSize={pageSize}
                      onPageChange={handlePageChange}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Patient Creation Modal */}
      {canCreatePatient && (
        <PatientCreationModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={handlePatientCreated}
        />
      )}

      {/* Success Modal */}
      {createdPatientId && (
        <PatientCreationSuccessModal
          isOpen={isSuccessModalOpen}
          onClose={handleSuccessModalClose}
          patientId={createdPatientId}
          patientName={createdPatientName}
          phoneNumber={createdPatientPhone}
          birthday={createdPatientBirthday}
          onCreateAppointment={() => {
            // Close success modal and open appointment modal with the newly created patient
            setIsSuccessModalOpen(false);
            setSelectedPatientIdForAppointment(createdPatientId);
            setSelectedPatientNameForAppointment(createdPatientName);
            setIsAppointmentModalOpen(true);
          }}
        />
      )}

      {/* Create Appointment Modal */}
      {isAppointmentModalOpen && (
        <CreateAppointmentModal
          {...(selectedPatientIdForAppointment !== undefined && { preSelectedPatientId: selectedPatientIdForAppointment })}
          {...(selectedPatientNameForAppointment !== undefined && { preSelectedPatientName: selectedPatientNameForAppointment })}
          initialDate={null}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            setIsAppointmentModalOpen(false);
            setSelectedPatientIdForAppointment(undefined);
            setSelectedPatientNameForAppointment(undefined);
          }}
          onConfirm={async (formData) => {
            try {
              const { date, startTime } = extractAppointmentDateTime(formData.start_time);
              await createAppointmentMutation.mutateAsync({
                practitionerId: formData.practitioner_id,
                appointmentTypeId: formData.appointment_type_id,
                date,
                startTime,
                patientId: formData.patient_id,
                ...(formData.selected_resource_ids && { selectedResourceIds: formData.selected_resource_ids }),
                ...(formData.clinic_notes && { clinicNotes: formData.clinic_notes }),
              });
              setIsAppointmentModalOpen(false);
              setSelectedPatientIdForAppointment(undefined);
              setSelectedPatientNameForAppointment(undefined);
              await alert('預約已建立');
              // Refetch patients list in case any data changed
              refetch();
            } catch (error) {
              logger.error('Error creating appointment:', error);
              const errorMessage = getErrorMessage(error);
              throw new Error(errorMessage);
            }
          }}
        />
      )}
    </>
  );
};

export default PatientsPage;
