import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import { useModalQueue } from '../contexts/ModalQueueContext';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { EditAppointmentModal } from '../components/calendar/EditAppointmentModal';
import { useAutoAssignedAppointments, AutoAssignedAppointment } from '../hooks/queries';
import { BaseModal } from '../components/shared/BaseModal';
import moment from 'moment-timezone';
import { CalendarEvent } from '../utils/calendarDataAdapter';
import { formatAppointmentDateTime, formatAppointmentTimeRange } from '../utils/calendarUtils';
import { appointmentToCalendarEvent } from '../components/patient/appointmentUtils';
import { invalidateAvailabilityAfterAppointmentChange } from '../utils/reactQueryInvalidation';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateCalendarEventsForAppointment } from '../hooks/queries/useCalendarEvents';
import { shouldPromptForAssignment } from '../hooks/usePractitionerAssignmentPrompt';
import { PractitionerAssignmentPromptModal } from '../components/PractitionerAssignmentPromptModal';
import { PractitionerAssignmentConfirmationModal } from '../components/PractitionerAssignmentConfirmationModal';
import { extractAppointmentDateTime } from '../utils/timezoneUtils';
import { getErrorMessage } from '../types/api';
import { AppointmentType } from '../types';


const AutoAssignedAppointmentsPage: React.FC = () => {
  const { user, isClinicAdmin, isAuthenticated, hasRole } = useAuth();
  const { alert } = useModal();
  const { enqueueModal, showNext } = useModalQueue();
  const queryClient = useQueryClient();
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

  // Only clinic admins and practitioners can access this page
  const canAccessPage = isClinicAdmin || (hasRole && hasRole('practitioner'));
  if (!canAccessPage) {
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
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 0 016.32-2.906l-.78.625A7 7 0 1115.709 14l.624-.78A8 8 0 0010 18zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">無權限</h3>
              <div className="mt-2 text-sm text-red-700">
                <p>只有診所管理員和治療師可以查看和管理待審核預約。</p>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const { data: appointmentsData, isLoading: loading, error, refetch } = useAutoAssignedAppointments();

  // Handle error messages (React Query doesn't provide defaultErrorMessage)
  const errorMessage = error ? '無法載入待審核預約列表' : null;

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
      
      // Get booking restriction type
      const restrictionType = bookingSettings.booking_restriction_type || 'minimum_hours_required';
      setBookingRestrictionType(restrictionType);
      
      if (restrictionType === 'minimum_hours_required') {
        const hoursValue = bookingSettings.minimum_booking_hours_ahead;
        // Convert to number if it's a string, or use default
        const hours = typeof hoursValue === 'string' 
          ? parseInt(hoursValue, 10) 
          : (typeof hoursValue === 'number' ? hoursValue : 24);
        
        // Ensure we have a valid number
        const finalHours = (!isNaN(hours) && hours > 0) ? hours : 24;
        setMinimumBookingHoursAhead(finalHours);
        setDeadlineTimeDayBefore(null);
      } else if (restrictionType === 'deadline_time_day_before') {
        const deadlineTime = bookingSettings.deadline_time_day_before || '08:00';
        const onSameDay = bookingSettings.deadline_on_same_day || false;
        setDeadlineTimeDayBefore(deadlineTime);
        setDeadlineOnSameDay(onSameDay);
        setMinimumBookingHoursAhead(null);
      }
    } catch (err) {
      logger.error('Failed to fetch clinic settings:', err);
      // Set defaults on error
      setBookingRestrictionType('minimum_hours_required');
      setMinimumBookingHoursAhead(24);
      setDeadlineTimeDayBefore(null);
      setDeadlineOnSameDay(false);
    } finally {
      setIsLoadingSettings(false);
    }
  }, [minimumBookingHoursAhead, bookingRestrictionType, isLoadingSettings]);

  // Fetch clinic settings when appointments data is loaded
  React.useEffect(() => {
    if (appointmentsData && appointmentsData.appointments.length > 0) {
      fetchClinicSettings();
    }
  }, [appointmentsData, fetchClinicSettings]);

  // Also fetch when info modal opens if not already loaded
  React.useEffect(() => {
    if (isInfoModalOpen) {
      fetchClinicSettings();
    }
  }, [isInfoModalOpen, fetchClinicSettings]);

  const appointments = appointmentsData?.appointments || [];

  const handleAppointmentClick = async (appointment: AutoAssignedAppointment) => {
    try {
      setSelectedAppointment(appointment);

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

      setCalendarEvent(event);
      setIsEditModalOpen(true);
    } catch (err) {
      logger.error('Failed to open modal:', err);
      alert('無法開啟視窗', '錯誤');
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
        confirm_time_selection?: boolean;
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

      // Add confirm_time_selection flag for time confirmation appointments
      if (selectedAppointment.pending_time_confirmation) {
        updateData.confirm_time_selection = true;
      }

      // Don't close modal here - let EditAppointmentModal handle closing via onComplete
      // This allows assignment check to happen before modal closes
      await apiService.editClinicAppointment(selectedAppointment.appointment_id, updateData);

      // Invalidate React Query cache for both old and new dates
      try {
        const oldDate = moment(selectedAppointment.start_time).format('YYYY-MM-DD');
        const { date: newDate } = extractAppointmentDateTime(formData.start_time);
        const practitionerId = formData.practitioner_id ?? selectedAppointment.practitioner_id;
        const appointmentTypeId = formData.appointment_type_id ?? selectedAppointment.appointment_type_id;
        const clinicId = user?.active_clinic_id;
        const patientId = selectedAppointment.patient_id;

        if (practitionerId && appointmentTypeId && clinicId && patientId) {
          const datesToInvalidate = [oldDate];
          if (newDate !== oldDate) {
            datesToInvalidate.push(newDate);
          }
          invalidateAvailabilityAfterAppointmentChange(queryClient, practitionerId, appointmentTypeId, datesToInvalidate, clinicId, patientId);
        }

        // Also invalidate calendar events to update the calendar page
        invalidateCalendarEventsForAppointment(queryClient, clinicId);
      } catch (cacheError) {
        logger.warn('Failed to invalidate cache after appointment edit:', cacheError);
        // Continue with success flow - cache inconsistency is not critical for user experience
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

  if (errorMessage) {
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
        <ErrorMessage message={errorMessage} />
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
            {appointments.map((appointment) => {
              const isTimeConfirmation = appointment.pending_time_confirmation;

              return (
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

                      {/* Unified appointment details display */}
                      <>
                        <div className="mt-2 flex items-center text-sm text-gray-500">
                          <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          {formatDateTime(appointment.start_time)}
                          {isTimeConfirmation && (
                            <span className="ml-2 text-xs text-gray-500">
                              (暫定)
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center text-sm text-gray-500">
                          <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          {isTimeConfirmation ? (
                            // Time confirmation: practitioner assignment is confirmed, show name only
                            appointment.practitioner_name
                          ) : (
                            // Practitioner assignment pending: show temporary assignment
                            <>目前指派給: {appointment.practitioner_name}</>
                          )}
                        </div>
                        {formatAutoAssignmentTime(appointment.start_time) && (
                          <div className="mt-1 flex items-center text-sm text-amber-600">
                            <svg className="flex-shrink-0 mr-1.5 h-4 w-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {isTimeConfirmation ? '將在' : '將在'} {formatAutoAssignmentTime(appointment.start_time)}
                          </div>
                        )}
                      </>

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
              );
            })}
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

            // Show appropriate confirmation alert based on appointment type
            const alertMessage = selectedAppointment.pending_time_confirmation
              ? '預約時段已確認'
              : '預約已重新指派';
            await alert(alertMessage, '成功');

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
          isTimeConfirmation={selectedAppointment.pending_time_confirmation || false}
          alternativeSlots={selectedAppointment.alternative_time_slots || null}
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
              <div className="text-sm text-gray-700 space-y-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">整體機制</h4>
                  <p className="mb-2">病患可以：</p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li>預約時不指定治療師（系統自動指派）</li>
                    <li>選擇多個偏好時段（若服務項目允許，最多 10 個）</li>
                  </ul>
                  <p>系統會先指派臨時治療師和時間，設為待確認狀態。</p>
                </div>

                <div>
                  <h4 className="font-medium text-gray-900 mb-2">確認流程</h4>
                  <p className="mb-2">診所人員可以：</p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li>確認或修改治療師指派</li>
                    <li>確認或修改時間</li>
                  </ul>
                  <p>確認後會立即發送 LINE 通知給病患。</p>
                </div>

                <div>
                  <h4 className="font-medium text-gray-900 mb-2">自動確認機制</h4>
                  <p className="mb-2">根據診所的「預約限制」設定，若未及時確認，系統會自動確認：</p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li><strong>小時限制模式</strong>（預設）：預約前 X 小時自動確認（預設24小時）</li>
                    <li><strong>截止時間模式</strong>：在指定時間點自動確認（例如前一天上午 8:00）</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-medium text-gray-900 mb-2">權限說明</h4>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li><strong>診所管理員</strong>：可以查看和確認所有待確認預約</li>
                    <li><strong>治療師</strong>：可以查看和確認需要他們確認的多時段預約</li>
                  </ul>
                </div>
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

