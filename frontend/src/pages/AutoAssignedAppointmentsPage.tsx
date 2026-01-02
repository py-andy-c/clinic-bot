import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import { useModalQueue } from '../contexts/ModalQueueContext';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { EditAppointmentModal } from '../components/calendar/EditAppointmentModal';
import { useAutoAssignedAppointments } from '../hooks/useAppointments';
import { getErrorMessage } from '../types/api';
import { BaseModal } from '../components/shared/BaseModal';
import moment from 'moment-timezone';
import { CalendarEvent } from '../utils/calendarDataAdapter';
import { formatAppointmentDateTime, formatAppointmentTimeRange } from '../utils/calendarUtils';
import { appointmentToCalendarEvent } from '../components/patient/appointmentUtils';
import { invalidateCacheForDate } from '../utils/availabilityCache';
import { invalidateResourceCacheForDate } from '../utils/resourceAvailabilityCache';
import { shouldPromptForAssignment } from '../hooks/usePractitionerAssignmentPrompt';
import { PractitionerAssignmentPromptModal } from '../components/PractitionerAssignmentPromptModal';
import { PractitionerAssignmentConfirmationModal } from '../components/PractitionerAssignmentConfirmationModal';
import { AppointmentType } from '../types';

interface AutoAssignedAppointment {
  appointment_id: number;
  calendar_event_id: number;
  patient_name: string;
  patient_id: number;
  practitioner_id: number;
  practitioner_name: string;
  appointment_type_id: number;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  notes?: string | null;
  originally_auto_assigned: boolean;
  resource_names: string[];
  resource_ids: number[];
}

const AutoAssignedAppointmentsPage: React.FC = () => {
  const { isClinicAdmin, isAuthenticated, isLoading } = useAuth();
  const { alert } = useModal();
  const { enqueueModal, showNext } = useModalQueue();
  const [selectedAppointment, setSelectedAppointment] = useState<AutoAssignedAppointment | null>(null);
  const [practitioners, setPractitioners] = useState<{ id: number; full_name: string }[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [calendarEvent, setCalendarEvent] = useState<CalendarEvent | null>(null);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [minimumBookingHoursAhead, setMinimumBookingHoursAhead] = useState<number | null>(null);
  const [bookingRestrictionType, setBookingRestrictionType] = useState<string | null>(null);
  const [deadlineTimeDayBefore, setDeadlineTimeDayBefore] = useState<string | null>(null);
  const [deadlineOnSameDay, setDeadlineOnSameDay] = useState<boolean>(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  // Store the last confirmed appointment data for assignment check after confirmation modal
  // Use ref instead of state to ensure it's immediately available when onComplete runs
  const lastConfirmedAppointmentDataRef = useRef<{
    practitionerId: number | null;
    patientId: number;
  } | null>(null);

  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Fetch auto-assigned appointments using React Query
  const {
    data: appointmentsData,
    isLoading: loading,
    error: queryError,
    refetch,
  } = useAutoAssignedAppointments(!isLoading && isAuthenticated && isClinicAdmin);

  const error = queryError ? (getErrorMessage(queryError) || '無法載入待審核預約列表') : null;

  // Fetch practitioners and appointment types when modal opens
  React.useEffect(() => {
    if (isEditModalOpen) {
      const fetchData = async () => {
        try {
          const [practitionersData, settings] = await Promise.all([
            apiService.getPractitioners(),
            apiService.getClinicSettings()
          ]);
          setPractitioners(practitionersData);
          setAppointmentTypes(settings.appointment_types);
        } catch (err) {
          logger.error('Failed to fetch practitioners or appointment types:', err);
          alert('無法載入治療師或預約類型資料', '錯誤');
        }
      };
      fetchData();
    }
  }, [isEditModalOpen, alert]);

  // Fetch clinic settings helper function
  const fetchClinicSettings = React.useCallback(async () => {
    if (isLoadingSettings || (minimumBookingHoursAhead !== null && bookingRestrictionType !== null)) {
      return;
    }
    
    setIsLoadingSettings(true);
    try {
      const settings = await apiService.getClinicSettings();
      const bookingSettings = settings.booking_restriction_settings;
      
      if (bookingSettings) {
        setMinimumBookingHoursAhead(Number(bookingSettings.minimum_booking_hours_ahead) ?? null);
        setBookingRestrictionType(bookingSettings.booking_restriction_type ?? null);
        setDeadlineTimeDayBefore(bookingSettings.deadline_time_day_before ?? null);
        setDeadlineOnSameDay(bookingSettings.deadline_on_same_day ?? false);
      }
    } catch (err) {
      logger.error('Failed to fetch clinic settings:', err);
    } finally {
      setIsLoadingSettings(false);
    }
  }, [isLoadingSettings, minimumBookingHoursAhead, bookingRestrictionType]);

  React.useEffect(() => {
    if (isAuthenticated && isClinicAdmin) {
      fetchClinicSettings();
    }
  }, [isAuthenticated, isClinicAdmin, fetchClinicSettings]);

  // If not authenticated, show a message
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">需要登入</h1>
          <p className="text-gray-600">請先登入以查看待審核預約頁面</p>
        </div>
      </div>
    );
  }

  // Only admins can access this page
  if (!isClinicAdmin) {
    return (
      <>
        <div className="mb-2 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 inline-flex items-center gap-2">
            待審核預約
            <button
              onClick={() => setIsInfoModalOpen(true)}
              className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
              aria-label="查看說明"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </button>
          </h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mt-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">無權限</h3>
              <div className="mt-2 text-sm text-red-700">
                <p>只有診所管理員可以查看和管理待審核預約。</p>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const appointments = appointmentsData?.appointments || [];

  const handleAppointmentClick = async (appointment: AutoAssignedAppointment) => {
    try {
      // Ensure practitioners and appointment types are loaded before opening modal
      if (practitioners.length === 0 || appointmentTypes.length === 0) {
        const [practitionersData, settings] = await Promise.all([
          apiService.getPractitioners(),
          apiService.getClinicSettings()
        ]);
        setPractitioners(practitionersData);
        setAppointmentTypes(settings.appointment_types);
      }
      
      // Use shared utility to create CalendarEvent from appointment data
      const event = appointmentToCalendarEvent({
        id: appointment.appointment_id,
        calendar_event_id: appointment.calendar_event_id,
        patient_id: appointment.patient_id,
        patient_name: appointment.patient_name,
        practitioner_id: appointment.practitioner_id,
        practitioner_name: appointment.practitioner_name,
        appointment_type_id: appointment.appointment_type_id,
        appointment_type_name: appointment.appointment_type_name,
        start_time: appointment.start_time,
        end_time: appointment.end_time,
        status: 'confirmed',
        notes: appointment.notes ?? null,
        originally_auto_assigned: appointment.originally_auto_assigned,
        is_auto_assigned: true, // All appointments from this page are currently auto-assigned
        resource_names: appointment.resource_names,
        resource_ids: appointment.resource_ids,
      });
      
      setSelectedAppointment(appointment);
      setCalendarEvent(event);
      setIsEditModalOpen(true);
    } catch (err) {
      logger.error('Failed to open edit modal:', err);
      alert('無法開啟編輯視窗', '錯誤');
    }
  };

  const handleEditConfirm = async (formData: {
    appointment_type_id?: number | null;
    practitioner_id: number | null;
    start_time: string;
    clinic_notes?: string;
    notification_note?: string;
    selected_resource_ids?: number[];
  }) => {
    if (!selectedAppointment) return;

    try {
      // Call update appointment API
      // Build request object conditionally to avoid undefined values (for exactOptionalPropertyTypes)
      const updateData: {
        appointment_type_id?: number | null;
        practitioner_id?: number | null;
        start_time?: string | null;
        clinic_notes?: string;
        notification_note?: string;
        selected_resource_ids?: number[];
      } = {
        practitioner_id: formData.practitioner_id,
        start_time: formData.start_time,
      };
      
      if (formData.appointment_type_id !== undefined) {
        updateData.appointment_type_id = formData.appointment_type_id;
      }
      
      if (formData.clinic_notes !== undefined) {
        updateData.clinic_notes = formData.clinic_notes;
      }
      
      if (formData.notification_note !== undefined) {
        updateData.notification_note = formData.notification_note;
      }
      
      if (formData.selected_resource_ids !== undefined) {
        updateData.selected_resource_ids = formData.selected_resource_ids;
      }
      
      // Don't close modal here - let EditAppointmentModal handle closing via onComplete
      // This allows assignment check to happen before modal closes
      await apiService.editClinicAppointment(selectedAppointment.appointment_id, updateData);

      // Invalidate availability cache for both old and new dates
      const oldDate = moment(selectedAppointment.start_time).format('YYYY-MM-DD');
      const newDate = moment(formData.start_time).format('YYYY-MM-DD');
      const practitionerId = formData.practitioner_id ?? selectedAppointment.practitioner_id;
      const appointmentTypeId = formData.appointment_type_id ?? selectedAppointment.appointment_type_id;
      if (practitionerId && appointmentTypeId) {
        invalidateCacheForDate(practitionerId, appointmentTypeId, oldDate);
        invalidateResourceCacheForDate(practitionerId, appointmentTypeId, oldDate);
        if (newDate !== oldDate) {
          invalidateCacheForDate(practitionerId, appointmentTypeId, newDate);
          invalidateResourceCacheForDate(practitionerId, appointmentTypeId, newDate);
        }
      }

      // Store appointment data for assignment check after confirmation modal
      // Use ref to ensure data is immediately available when onComplete runs
      lastConfirmedAppointmentDataRef.current = {
        practitionerId: formData.practitioner_id,
        patientId: selectedAppointment.patient_id,
      };

      // Don't show alert here - it will be shown in onComplete after modal closes
    } catch (err) {
      logger.error('Failed to update appointment:', err);
      throw err; // Let EditAppointmentModal handle the error display
    }
  };

  const formatDateTime = (dateTimeStr: string) => {
    const momentObj = moment.tz(dateTimeStr, 'Asia/Taipei');
    return formatAppointmentDateTime(momentObj.toDate());
  };

  const formatAutoAssignmentTime = (startTimeStr: string) => {
    if (bookingRestrictionType === null) {
      return null;
    }
    
    const appointmentTime = moment.tz(startTimeStr, 'Asia/Taipei');
    const now = moment.tz('Asia/Taipei');
    let autoAssignmentTime: moment.Moment;
    
    if (bookingRestrictionType === 'deadline_time_day_before') {
      // Deadline time mode: appointment becomes visible at deadline
      // deadlineOnSameDay=false: deadline on day X-1
      // deadlineOnSameDay=true: deadline on day X (same day)
      if (!deadlineTimeDayBefore) {
        return null;
      }
      
      // Parse deadline time (stored as 24-hour format HH:MM)
      const parts = deadlineTimeDayBefore.split(':');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return null;
      }
      const hour = parseInt(parts[0], 10);
      const minute = parseInt(parts[1], 10);
      if (isNaN(hour) || isNaN(minute)) {
        return null;
      }
      
      // Get appointment date (day X)
      const appointmentDate = appointmentTime.clone().startOf('day');
      
      // Determine deadline date based on deadlineOnSameDay setting
      let deadlineDate;
      if (deadlineOnSameDay) {
        // Deadline is on the same day as appointment (date X)
        deadlineDate = appointmentDate.clone();
      } else {
        // Deadline is on the day before (date X-1)
        deadlineDate = appointmentDate.clone().subtract(1, 'day');
      }
      
      autoAssignmentTime = deadlineDate.clone().hour(hour).minute(minute).second(0).millisecond(0);
    } else {
      // Default: minimum_hours_required mode
      if (minimumBookingHoursAhead === null || minimumBookingHoursAhead <= 0) {
        return null;
      }
      autoAssignmentTime = appointmentTime.clone().subtract(minimumBookingHoursAhead, 'hours');
    }
    
    if (autoAssignmentTime.isBefore(now) || autoAssignmentTime.isSame(now)) {
      return '即將自動指派';
    }
    
    const duration = moment.duration(autoAssignmentTime.diff(now));
    const days = Math.floor(duration.asDays());
    const hours = duration.hours();
    const minutes = duration.minutes();
    
    if (days > 0) {
      return `將在 ${days} 天 ${hours} 小時後自動指派`;
    } else if (hours > 0) {
      return `將在 ${hours} 小時 ${minutes} 分鐘後自動指派`;
    } else {
      return `將在 ${minutes} 分鐘後自動指派`;
    }
  };

  if (loading) {
    return (
      <>
        <div className="mb-2 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 inline-flex items-center gap-2">
            待審核預約
            <button
              onClick={() => setIsInfoModalOpen(true)}
              className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
              aria-label="查看說明"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </button>
          </h1>
        </div>
        <div className="flex justify-center items-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="mb-2 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 inline-flex items-center gap-2">
            待審核預約
            <button
              onClick={() => setIsInfoModalOpen(true)}
              className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
              aria-label="查看說明"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </button>
          </h1>
        </div>
        <ErrorMessage message={error} />
      </>
    );
  }

  return (
    <>
      <div className="mb-2 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 inline-flex items-center gap-2">
          待審核預約
          <button
            onClick={() => setIsInfoModalOpen(true)}
            className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
            aria-label="查看說明"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </button>
        </h1>
      </div>

      {appointments.length === 0 ? (
        <div className="bg-white md:rounded-lg md:shadow p-0 md:p-8 text-center">
          <p className="text-gray-500">目前沒有自動指派的預約</p>
        </div>
      ) : (
        <div className="bg-white md:shadow md:overflow-hidden md:rounded-md">
          <ul className="divide-y divide-gray-200">
            {appointments.map((appointment) => (
              <li
                key={appointment.appointment_id}
                onClick={() => handleAppointmentClick(appointment)}
                className="px-2 py-2 md:px-6 md:py-4 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <p className="text-sm font-medium text-gray-900">
                        {appointment.patient_name}
                      </p>
                      <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {appointment.appointment_type_name}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center text-sm text-gray-500">
                      <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {formatDateTime(appointment.start_time)}
                    </div>
                    <div className="mt-1 flex items-center text-sm text-gray-500">
                      <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      目前指派給: {appointment.practitioner_name}
                    </div>
                    {formatAutoAssignmentTime(appointment.start_time) && (
                      <div className="mt-1 flex items-center text-sm text-amber-600">
                        <svg className="flex-shrink-0 mr-1.5 h-4 w-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {formatAutoAssignmentTime(appointment.start_time)}
                      </div>
                    )}
                    {appointment.notes && (
                      <div className="mt-1 text-sm text-gray-500">
                        備註: {appointment.notes}
                      </div>
                    )}
                    {appointment.resource_names && appointment.resource_names.length > 0 && (
                      <div className="mt-1 flex items-center text-sm text-gray-500">
                        <svg className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        資源: {appointment.resource_names.join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="ml-4 flex-shrink-0">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isEditModalOpen && calendarEvent && selectedAppointment && (
        <EditAppointmentModal
          event={calendarEvent}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            // User cancellation → close modal
            // Note: If assignment prompt was shown, onComplete will be called instead
            setIsEditModalOpen(false);
            setSelectedAppointment(null);
            setCalendarEvent(null);
          }}
          onComplete={async () => {
            // Successful completion → close modal and refresh list
            setIsEditModalOpen(false);
            setSelectedAppointment(null);
            setCalendarEvent(null);
            await refetch();
            
            // Show confirmation alert first
            await alert('預約已重新指派', '成功');
            
            // After confirmation alert closes, check for assignment prompt
            const appointmentData = lastConfirmedAppointmentDataRef.current;
            if (appointmentData && appointmentData.practitionerId !== null) {
              try {
                const patient = await apiService.getPatient(appointmentData.patientId);
                const shouldPrompt = shouldPromptForAssignment(patient, appointmentData.practitionerId);
                
                if (shouldPrompt) {
                  const practitionerName = practitioners.find(p => p.id === appointmentData.practitionerId)?.full_name || '';
                  
                  // Get current assigned practitioners to display
                  let currentAssigned: Array<{ id: number; full_name: string }> = [];
                  if (patient.assigned_practitioners && patient.assigned_practitioners.length > 0) {
                    currentAssigned = patient.assigned_practitioners
                      .filter((p) => p.is_active !== false)
                      .map((p) => ({ id: p.id, full_name: p.full_name }));
                  } else if (patient.assigned_practitioner_ids && patient.assigned_practitioner_ids.length > 0) {
                    currentAssigned = patient.assigned_practitioner_ids
                      .map((id) => {
                        const practitioner = practitioners.find(p => p.id === id);
                        return practitioner ? { id: practitioner.id, full_name: practitioner.full_name } : null;
                      })
                      .filter((p): p is { id: number; full_name: string } => p !== null);
                  }
                  
                  // Enqueue the assignment prompt modal
                  enqueueModal<React.ComponentProps<typeof PractitionerAssignmentPromptModal>>({
                    id: 'assignment-prompt',
                    component: PractitionerAssignmentPromptModal,
                    defer: true,
                    props: {
                      practitionerName,
                      currentAssignedPractitioners: currentAssigned,
                      onConfirm: async () => {
                        if (!patient || !appointmentData.practitionerId) return;
                        
                        try {
                          const updatedPatient = await apiService.assignPractitionerToPatient(
                            patient.id,
                            appointmentData.practitionerId
                          );
                          
                          const allAssigned = updatedPatient.assigned_practitioners || [];
                          const activeAssigned = allAssigned
                            .filter((p) => p.is_active !== false)
                            .map((p) => ({ id: p.id, full_name: p.full_name }));
                          
                          // Enqueue confirmation modal
                          enqueueModal<React.ComponentProps<typeof PractitionerAssignmentConfirmationModal>>({
                            id: 'assignment-confirmation',
                            component: PractitionerAssignmentConfirmationModal,
                            defer: true,
                            props: {
                              assignedPractitioners: activeAssigned,
                              excludePractitionerId: appointmentData.practitionerId,
                              onClose: () => {
                                // Assignment confirmation modal already shows success message
                                // No need to do anything else
                              },
                            },
                          });
                          
                          // Show the confirmation modal after the prompt modal closes
                          setTimeout(() => {
                            showNext();
                          }, 250);
                        } catch (err) {
                          logger.error('Failed to add practitioner assignment:', err);
                          const errorMessage = getErrorMessage(err) || '無法將治療師設為負責人員';
                          await alert(errorMessage, '錯誤');
                        }
                      },
                      onCancel: () => {
                        // User declined assignment - nothing to do
                      },
                    },
                  });
                  
                  // Show the assignment prompt modal after a delay to ensure alert is fully closed
                  setTimeout(() => {
                    showNext();
                  }, 250);
                }
              } catch (err) {
                logger.error('Failed to check for assignment prompt:', err);
              } finally {
                // Clear the stored data
                lastConfirmedAppointmentDataRef.current = null;
              }
            } else {
              // Clear the stored data if no assignment check needed
              lastConfirmedAppointmentDataRef.current = null;
            }
          }}
          onConfirm={handleEditConfirm}
          formatAppointmentTime={formatAppointmentTimeRange}
          formSubmitButtonText="下一步"
          saveButtonText="確認指派"
          allowConfirmWithoutChanges={true}
          skipAssignmentCheck={true}
        />
      )}

      {isInfoModalOpen && (
        <BaseModal
          onClose={() => setIsInfoModalOpen(false)}
          aria-label="說明"
        >
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">說明</h3>
              <div className="text-sm text-gray-700 space-y-2">
                <p>如果病患在預約時沒有指定治療師，系統會根據病患的時間選擇，暫時指派一名治療師以保留時段。</p>
                <p>暫時指派的預約不會出現在治療師的行事曆或通知中，但仍會佔用該時段，無法接受其他預約。</p>
                <p>診所管理員可以確認或更改治療師的選擇。若在預約時間前
                  {isLoadingSettings ? (
                    <span className="inline-block w-8 h-4 bg-gray-200 animate-pulse rounded mx-1"></span>
                  ) : minimumBookingHoursAhead !== null && minimumBookingHoursAhead > 0 ? (
                    <span className="font-medium mx-1">{minimumBookingHoursAhead} 小時</span>
                  ) : (
                    <span className="text-gray-500 mx-1">載入中...</span>
                  )}
                  還未人為指派，系統會自動指派給目前暫時指派的治療師。被確認指派的治療師則會收到通知。</p>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsInfoModalOpen(false)}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                >
                  關閉
                </button>
              </div>
            </div>
          </div>
        </BaseModal>
      )}
    </>
  );
};

export default AutoAssignedAppointmentsPage;

