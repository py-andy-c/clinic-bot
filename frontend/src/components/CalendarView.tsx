import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { logger } from '../utils/logger';
import { LoadingSpinner, ErrorMessage } from './shared';
import { useModal } from '../contexts/ModalContext';
import { Calendar, momentLocalizer, View, Views } from 'react-big-calendar';
import moment from 'moment-timezone';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { apiService } from '../services/api';
import { ApiCalendarEvent } from '../types';
import { getErrorMessage } from '../types/api';
import { 
  transformToCalendarEvents, 
  CalendarEvent 
} from '../utils/calendarDataAdapter';
import { getPractitionerColor } from '../utils/practitionerColors';
import { CustomToolbar, CustomEventComponent, CustomDateHeader, CustomDayHeader, CustomWeekdayHeader } from './CalendarComponents';
import {
  EventModal,
  ExceptionModal,
  ConflictModal,
  CancellationNoteModal,
  CancellationPreviewModal,
  DeleteConfirmationModal,
  EditAppointmentModal,
  CreateAppointmentModal,
} from './calendar';
import {
  getDateString,
  formatAppointmentTime,
  getDateRange,
  formatTimeString,
  getScrollToTime,
} from '../utils/calendarUtils';

// Configure moment for Taiwan timezone
moment.locale('zh-tw');
const localizer = momentLocalizer(moment);

// Set default timezone for moment
moment.tz.setDefault('Asia/Taipei');

interface CalendarViewProps {
  userId: number;
  additionalPractitionerIds?: number[];
  practitioners?: { id: number; full_name: string }[]; // Practitioner names for display
  onSelectEvent?: (event: CalendarEvent) => void;
  onNavigate?: (date: Date) => void;
  onAddExceptionHandlerReady?: (handler: () => void, view: View) => void;
  onCreateAppointment?: (patientId?: number) => void; // Callback to open create appointment modal
  preSelectedPatientId?: number; // Pre-selected patient ID from query parameter
}

const CalendarView: React.FC<CalendarViewProps> = ({ 
  userId, 
  additionalPractitionerIds = [],
  practitioners = [],
  onSelectEvent, 
  onNavigate,
  onAddExceptionHandlerReady,
  preSelectedPatientId
}) => {
  const { alert } = useModal();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<View>(Views.DAY);
  const [allEvents, setAllEvents] = useState<ApiCalendarEvent[]>([]);
  const [defaultSchedule, setDefaultSchedule] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalState, setModalState] = useState<{
    type: 'event' | 'exception' | 'conflict' | 'delete_confirmation' | 'cancellation_note' | 'cancellation_preview' | 'edit_appointment' | 'create_appointment' | null;
    data: any;
  }>({ type: null, data: null });
  const [createModalKey, setCreateModalKey] = useState(0);
  const [exceptionData, setExceptionData] = useState({
    date: '',
    startTime: '',
    endTime: ''
  });
  const [cancellationNote, setCancellationNote] = useState('');
  const [cancellationPreviewMessage, setCancellationPreviewMessage] = useState('');
  const [cancellationPreviewLoading, setCancellationPreviewLoading] = useState(false);
  const [editErrorMessage, setEditErrorMessage] = useState<string | null>(null);
  const [availablePractitioners, setAvailablePractitioners] = useState<{ id: number; full_name: string }[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<{ id: number; name: string; duration_minutes: number }[]>([]);
  const [isFullDay, setIsFullDay] = useState(false);
  const scrollYRef = useRef(0);

  // Helper function to check if user can edit an event
  const canEditEvent = useCallback((event: CalendarEvent | null): boolean => {
    if (!event) return false;
    const eventPractitionerId = event.resource.practitioner_id || userId;
    return eventPractitionerId === userId;
  }, [userId]);

  // Lock body scroll when modal is open (prevents background scrolling on mobile)
  useEffect(() => {
    let wasModalOpen = modalState.type !== null;

    if (wasModalOpen) {
      // Save current scroll position using ref to avoid closure issues
      scrollYRef.current = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollYRef.current}px`;
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
    }

    return () => {
      if (wasModalOpen) {
        // Restore scroll position
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollYRef.current);
      }
    };
  }, [modalState.type]);



  // Transform events for React Big Calendar
  const calendarEvents = useMemo(() => {
    const events = [...allEvents];
    
    // Availability background events removed - no longer showing default schedule as gray boxes
    
    return transformToCalendarEvents(events);
  }, [allEvents, defaultSchedule, currentDate, view]);

  // Check for mobile view
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // Set scroll position to 9 AM for day view
  const scrollToTime = useMemo(() => getScrollToTime(currentDate), [currentDate]);

  // Fetch practitioners for edit appointment
  const fetchPractitioners = async () => {
    try {
      const response = await apiService.getPractitioners();
      setAvailablePractitioners(response);
    } catch (err) {
      logger.error('Failed to fetch practitioners:', err);
    }
  };

  // Fetch appointment types for edit appointment
  const fetchAppointmentTypes = async () => {
    try {
      const settings = await apiService.getClinicSettings();
      setAppointmentTypes(settings.appointment_types || []);
    } catch (err) {
      logger.error('Failed to fetch appointment types:', err);
    }
  };

  useEffect(() => {
    fetchCalendarData();
    fetchDefaultSchedule();
    fetchPractitioners();
    fetchAppointmentTypes();
  }, [userId, additionalPractitionerIds, currentDate, view]);

  // Fetch default schedule
  const fetchDefaultSchedule = async () => {
    if (!userId) return;

    try {
      const schedule = await apiService.getPractitionerDefaultSchedule(userId);
      setDefaultSchedule(schedule);
    } catch (err) {
      logger.error('Failed to fetch default schedule:', err);
    }
  };

  // Fetch all events for the visible date range
  const fetchCalendarData = async () => {
    if (!userId) return;

    // Monthly view is just for navigation - don't fetch events
    if (view === Views.MONTH) {
      setAllEvents([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { start, end } = getDateRange(currentDate, 'day');
      const events: ApiCalendarEvent[] = [];

      // Collect all practitioner IDs to fetch (primary + additional)
      const allPractitionerIds = [userId, ...additionalPractitionerIds];

      // Fetch events for each day in the range (only for daily view)
      const current = moment(start);
      const endMoment = moment(end);

      while (current.isSameOrBefore(endMoment, 'day')) {
        const dateStr = current.format('YYYY-MM-DD');
        
        // Fetch events for all practitioners in parallel
        const fetchPromises = allPractitionerIds.map(async (practitionerId) => {
          try {
            const data: any = await apiService.getDailyCalendar(practitionerId, dateStr);
            
            if (data.events) {
              // Find practitioner name
              const practitioner = practitioners.find(p => p.id === practitionerId);
              const practitionerName = practitioner?.full_name || '';
              
              // Add date and practitioner ID to each event for proper display and color-coding
              return data.events.map((event: any) => ({
                ...event,
                date: dateStr,
                practitioner_id: practitionerId, // Add practitioner ID for color-coding
                practitioner_name: practitionerName, // Add practitioner name for display
                is_primary: practitionerId === userId // Mark primary practitioner's events
              }));
            }
            return [];
          } catch (err) {
            logger.warn(`Failed to fetch events for practitioner ${practitionerId} on ${dateStr}:`, err);
            return [];
          }
        });

        const results = await Promise.all(fetchPromises);
        // Flatten and add all events
        events.push(...results.flat());
        
        current.add(1, 'day');
      }

      setAllEvents(events);

    } catch (err) {
      setError('無法載入月曆資料');
      logger.error('Fetch calendar data error:', err);
    } finally {
      setLoading(false);
    }
  };


  // Event styling based on document requirements and practitioner
  const eventStyleGetter = useCallback((event: CalendarEvent) => {
    const practitionerId = event.resource.practitioner_id || userId;
    const isPrimary = practitionerId === userId;
    
    // Get color for this practitioner using shared utility
    const allPractitionerIds = [userId, ...additionalPractitionerIds];
    const practitionerColor = getPractitionerColor(practitionerId, userId, allPractitionerIds);
    
    let style: any = {
      borderRadius: '6px',
      color: 'white',
      border: 'none',
      display: 'block'
    };

    // Style based on event type and practitioner
    if (event.resource.type === 'appointment') {
      if (isPrimary) {
        // Primary practitioner: blue
        style = {
          ...style,
          backgroundColor: '#3B82F6',
          opacity: 1
        };
      } else if (practitionerColor) {
        // Other practitioners: use assigned color
        style = {
          ...style,
          backgroundColor: practitionerColor,
          opacity: 0.9
        };
      } else {
        // Fallback: blue
        style = {
          ...style,
          backgroundColor: '#3B82F6',
          opacity: 1
        };
      }
    } else if (event.resource.type === 'availability_exception') {
      // Exceptions: light gray for primary, slightly different for others
      if (isPrimary) {
        style = {
          ...style,
          backgroundColor: '#E5E7EB',
          color: '#1F2937',
          opacity: 1
        };
      } else {
        style = {
          ...style,
          backgroundColor: '#D1D5DB',
          color: '#111827',
          opacity: 0.8
        };
      }
    }
    
    return { style };
  }, [userId, additionalPractitionerIds]);

  // Handle event selection
  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    setModalState({ type: 'event', data: event });
    if (onSelectEvent) {
      onSelectEvent(event);
    }
  }, [onSelectEvent]);

  // Handle slot selection - only for monthly view navigation
  const handleSelectSlot = useCallback((slotInfo: any) => {
    // In monthly view, clicking a date should navigate to daily view of that date
    if (view === Views.MONTH) {
      setCurrentDate(slotInfo.start);
      setView(Views.DAY);
      if (onNavigate) {
        onNavigate(slotInfo.start);
      }
    }
    // In daily view, clicking blank space does nothing
  }, [view, onNavigate]);

  // Create a dateHeader component that handles clicks on the date number to navigate to day view
  const DateHeaderWithClick = useCallback(({ date }: any) => {
    const handleClick = () => {
      handleSelectSlot({
        start: date,
        end: moment(date).tz('Asia/Taipei').endOf('day').toDate(),
        slots: [date],
      });
    };
    
    return <CustomDateHeader date={date} onClick={handleClick} />;
  }, [handleSelectSlot]);

  // Handle navigation
  const handleNavigate = useCallback((date: Date) => {
    setCurrentDate(date);
    if (onNavigate) {
      onNavigate(date);
    }
  }, [onNavigate]);


  // Handle adding availability exception via button
  const handleAddException = useCallback(() => {
    // If in month view, switch to day view first
    if (view === Views.MONTH) {
      setView(Views.DAY);
    }
    setExceptionData({
      date: getDateString(currentDate),
      startTime: '',
      endTime: ''
    });
    setIsFullDay(false);
    setModalState({ type: 'exception', data: null });
  }, [view, currentDate]);

  // Expose handler to parent component
  useEffect(() => {
    if (onAddExceptionHandlerReady) {
      onAddExceptionHandlerReady(handleAddException, view);
    }
  }, [view, onAddExceptionHandlerReady, handleAddException]);


  // Create availability exception with conflict checking
  const handleCreateException = async () => {
    if (!exceptionData.date || !exceptionData.startTime || !exceptionData.endTime) {
      await alert('請輸入日期、開始和結束時間');
      return;
    }

    const dateStr = exceptionData.date;
    
    try {
      // Conflict check - get the selected date's events and check for overlaps
      const dailyData = await apiService.getDailyCalendar(userId, dateStr);
      const appointments = dailyData.events.filter((event: any) => event.type === 'appointment');
      
      // Collect all conflicting appointments
      const conflictingAppointments = appointments.filter((appointment: any) => {
        if (!appointment.start_time || !appointment.end_time) return false;
        return appointment.start_time < exceptionData.endTime && appointment.end_time > exceptionData.startTime;
      });

      if (conflictingAppointments.length > 0) {
        // Show conflict modal with list of conflicting appointments
        setModalState({ type: 'conflict', data: conflictingAppointments });
        return;
      }

      // Create exception (only for primary practitioner)
      await apiService.createAvailabilityException(userId, {
        date: dateStr,
        start_time: exceptionData.startTime,
        end_time: exceptionData.endTime
      });

      // Refresh data
      await fetchCalendarData();
      setModalState({ type: null, data: null });
      setExceptionData({ date: '', startTime: '', endTime: '' });
      setIsFullDay(false);
      await alert('休診時段已建立');
    } catch (error) {
      logger.error('Error creating exception:', error);
      await alert('建立休診時段失敗，請稍後再試');
    }
  };


  // Show delete confirmation for appointments
  const handleDeleteAppointment = async () => {
    if (!modalState.data || !modalState.data.resource.appointment_id) return;
    
    if (!canEditEvent(modalState.data)) {
      await alert('您只能取消自己的預約');
      return;
    }
    
    // Reset cancellation note and show note input modal
    setCancellationNote('');
    setCancellationPreviewMessage('');
    setModalState({ type: 'cancellation_note', data: modalState.data });
  };

  // Handle cancellation note submission and generate preview
  const handleCancellationNoteSubmit = async () => {
    if (!modalState.data) return;

    setCancellationPreviewLoading(true);
    try {
      const response = await apiService.generateCancellationPreview({
        appointment_type: modalState.data.resource.appointment_type_name,
        appointment_time: formatAppointmentTime(modalState.data.start, modalState.data.end),
        therapist_name: modalState.data.resource.practitioner_name,
        patient_name: modalState.data.resource.patient_name,
        ...(cancellationNote.trim() && { note: cancellationNote.trim() }),
      });

      setCancellationPreviewMessage(response.preview_message);
      setModalState({ type: 'cancellation_preview', data: modalState.data });
    } catch (error) {
      logger.error('Error generating cancellation preview:', error);
      await alert('無法產生預覽訊息，請稍後再試');
    } finally {
      setCancellationPreviewLoading(false);
    }
  };

  // Confirm and perform appointment deletion
  const handleConfirmDeleteAppointment = async () => {
    if (!modalState.data || !modalState.data.resource.appointment_id) return;

    if (!canEditEvent(modalState.data)) {
      await alert('您只能取消自己的預約');
      return;
    }

    try {
      await apiService.cancelClinicAppointment(modalState.data.resource.appointment_id, cancellationNote.trim() || undefined);

      // Refresh data
      await fetchCalendarData();
      setModalState({ type: null, data: null });
      setCancellationNote('');
      setCancellationPreviewMessage('');
    } catch (error) {
      logger.error('Error deleting appointment:', error);
      await alert('取消預約失敗，請稍後再試');
    }
  };

  // Show delete confirmation for availability exceptions
  const handleDeleteException = async () => {
    if (!modalState.data || !modalState.data.resource.exception_id) return;
    
    if (!canEditEvent(modalState.data)) {
      await alert('您只能刪除自己的休診時段');
      return;
    }
    
    // Show confirmation modal instead of deleting directly
    setModalState({ type: 'delete_confirmation', data: modalState.data });
  };

  // Confirm and perform exception deletion
  const handleConfirmDeleteException = async () => {
    if (!modalState.data || !modalState.data.resource.exception_id) return;

    if (!canEditEvent(modalState.data)) {
      await alert('您只能刪除自己的休診時段');
      return;
    }

    try {
      await apiService.deleteAvailabilityException(userId, modalState.data.resource.exception_id);
      
      // Refresh data
      await fetchCalendarData();
      setModalState({ type: null, data: null });
    } catch (error) {
      logger.error('Error deleting availability exception:', error);
      await alert('刪除休診時段失敗，請稍後再試');
    }
  };

  // Handle edit appointment button click
  const handleEditAppointment = async () => {
    if (!modalState.data || !modalState.data.resource.appointment_id) return;
    
    if (!canEditEvent(modalState.data)) {
      await alert('您只能編輯自己的預約');
      return;
    }
    
    // Reset error and show edit modal
    setEditErrorMessage(null); // Clear any previous error
    setModalState({ type: 'edit_appointment', data: modalState.data });
  };

  // Type definition for edit appointment form data
  type EditAppointmentFormData = {
    practitioner_id: number | null;
    start_time: string;
    notes?: string;
    notification_note?: string;
  };

  // Handle appointment edit confirmation (called from EditAppointmentModal)
  const handleConfirmEditAppointment = async (formData: EditAppointmentFormData) => {
    if (!modalState.data) return;

    if (!canEditEvent(modalState.data)) {
      // Show error in edit modal
      setEditErrorMessage('您只能編輯自己的預約');
      return;
    }

    try {
      await apiService.editClinicAppointment(
        modalState.data.resource.calendar_event_id,
        {
          practitioner_id: formData.practitioner_id,
          start_time: formData.start_time,
          ...(formData.notes !== undefined ? { notes: formData.notes } : {}),
          ...(formData.notification_note ? { notification_note: formData.notification_note } : {}),
        }
      );

      // Refresh data
      await fetchCalendarData();
      setModalState({ type: null, data: null });
      setEditErrorMessage(null);
      await alert('預約已更新');
    } catch (error) {
      logger.error('Error editing appointment:', error);
      // Extract error message from backend response
      const errorMessage = getErrorMessage(error);
      // Store error message - modal will display it
      setEditErrorMessage(errorMessage);
      throw error; // Re-throw so modal can handle it
    }
  };

  // Handle create appointment button click
  const handleCreateAppointment = useCallback((patientId?: number) => {
    setCreateModalKey(prev => prev + 1); // Force remount to reset state
    // Format current date as YYYY-MM-DD for initial date selection
    const currentDateString = getDateString(currentDate);
    // Use null to explicitly mean "no patient" (button click), undefined means "use prop" (URL-based)
    setModalState({ type: 'create_appointment', data: { patientId: patientId ?? null, initialDate: currentDateString } });
  }, [currentDate]);

  // Expose create appointment handler to parent
  useEffect(() => {
    // Store the handler so parent can call it
    (window as any).__calendarCreateAppointment = handleCreateAppointment;
    return () => {
      delete (window as any).__calendarCreateAppointment;
    };
  }, [handleCreateAppointment]);

  // Open create appointment modal if preSelectedPatientId is provided
  useEffect(() => {
    if (preSelectedPatientId && modalState.type === null) {
      handleCreateAppointment(preSelectedPatientId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preSelectedPatientId]);

  // Handle create appointment confirmation
  const handleConfirmCreateAppointment = async (formData: {
    patient_id: number;
    appointment_type_id: number;
    practitioner_id: number;
    start_time: string;
    notes: string;
  }) => {
    try {
      await apiService.createClinicAppointment(formData);

      // Refresh data
      await fetchCalendarData();
      setModalState({ type: null, data: null });
      await alert('預約已建立');
      
      // Clear query parameter if it exists
      if (window.location.search.includes('createAppointment=')) {
        const url = new URL(window.location.href);
        url.searchParams.delete('createAppointment');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (error) {
      logger.error('Error creating appointment:', error);
      const errorMessage = getErrorMessage(error);
      throw new Error(errorMessage);
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRetry={fetchCalendarData}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Calendar Component */}
      <div className="bg-white md:rounded-lg md:shadow-sm md:border md:border-gray-200 p-0 md:p-6">
        <Calendar
          localizer={localizer}
          events={calendarEvents}
          startAccessor="start"
          endAccessor="end"
          view={view}
          views={[Views.MONTH, Views.DAY]}
          date={currentDate}
          scrollToTime={scrollToTime}
          onNavigate={handleNavigate}
          onView={setView}
          onSelectEvent={handleSelectEvent}
          onSelectSlot={handleSelectSlot}
          selectable={view === Views.MONTH}
          components={{
            toolbar: CustomToolbar,
            event: CustomEventComponent,
            month: {
              dateHeader: DateHeaderWithClick,
              header: CustomWeekdayHeader,
            },
            day: {
              header: CustomDayHeader,
            },
          }}
          formats={{
            monthHeaderFormat: (date: Date) => {
              const taiwanDate = moment(date).tz('Asia/Taipei');
              return taiwanDate.format('YYYY年M月');
            },
            dayHeaderFormat: (date: Date) => {
              const taiwanDate = moment(date).tz('Asia/Taipei');
              const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
              const weekday = weekdayNames[taiwanDate.day()];
              return `${taiwanDate.format('M月D日')} (${weekday})`;
            },
            // Note: weekday column headers in month view are handled by CustomWeekdayHeader component
            // dayRangeHeaderFormat is not needed since we use CustomDayHeader component for day view
            timeGutterFormat: (date: Date) => {
              // Format for time slots in day view: "12 AM" instead of "12:00 AM"
              const taiwanDate = moment(date).tz('Asia/Taipei');
              const hours = taiwanDate.hour();
              const minutes = taiwanDate.minute();
              const period = hours >= 12 ? 'PM' : 'AM';
              const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
              // Only show minutes if they're not zero
              if (minutes === 0) {
                return `${hours12} ${period}`;
              } else {
                return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
              }
            },
          }}
          eventPropGetter={eventStyleGetter}
          // Mobile optimizations
          showMultiDayTimes={!isMobile}
          step={isMobile ? 60 : 30}
          timeslots={isMobile ? 1 : 2}
          // Timezone configuration
          culture="zh-TW"
          // Styling
          style={{ height: isMobile ? 'calc(100vh - 200px)' : 600 }}
          className="calendar-container"
        />
      </div>

      {/* Event Modal */}
      {modalState.type === 'event' && modalState.data && (() => {
        const canEdit = canEditEvent(modalState.data);
        
        return (
          <EventModal
            event={modalState.data}
            onClose={() => setModalState({ type: null, data: null })}
            onDeleteAppointment={
              canEdit && modalState.data.resource.type === 'appointment' 
                ? handleDeleteAppointment 
                : undefined
            }
            onDeleteException={
              canEdit && modalState.data.resource.type === 'availability_exception' 
                ? handleDeleteException 
                : undefined
            }
            onEditAppointment={
              canEdit && modalState.data.resource.type === 'appointment' 
                ? handleEditAppointment 
                : undefined
            }
            formatAppointmentTime={formatAppointmentTime}
          />
        );
      })()}

      {/* Exception Modal */}
      {modalState.type === 'exception' && (
        <ExceptionModal
          exceptionData={exceptionData}
          isFullDay={isFullDay}
          onClose={() => {
            setModalState({ type: null, data: null });
            setIsFullDay(false);
          }}
          onCreate={handleCreateException}
          onExceptionDataChange={setExceptionData}
          onFullDayChange={setIsFullDay}
        />
      )}

      {/* Conflict Warning Modal */}
      {modalState.type === 'conflict' && modalState.data && Array.isArray(modalState.data) && (
        <ConflictModal
          conflictingAppointments={modalState.data}
          onClose={() => setModalState({ type: null, data: null })}
          formatTimeString={formatTimeString}
        />
      )}

      {/* Cancellation Note Input Modal */}
      {modalState.type === 'cancellation_note' && modalState.data && (
        <CancellationNoteModal
          cancellationNote={cancellationNote}
          isLoading={cancellationPreviewLoading}
          onNoteChange={setCancellationNote}
          onBack={() => setModalState({ type: 'event', data: modalState.data })}
          onSubmit={handleCancellationNoteSubmit}
        />
      )}

      {/* Cancellation Preview Modal */}
      {modalState.type === 'cancellation_preview' && modalState.data && (
        <CancellationPreviewModal
          previewMessage={cancellationPreviewMessage}
          onBack={() => setModalState({ type: 'cancellation_note', data: modalState.data })}
          onConfirm={handleConfirmDeleteAppointment}
        />
      )}

      {/* Delete Confirmation Modal */}
      {modalState.type === 'delete_confirmation' && modalState.data && canEditEvent(modalState.data) && (
        <DeleteConfirmationModal
          event={modalState.data}
          onCancel={() => setModalState({ type: 'event', data: modalState.data })}
          onConfirm={modalState.data.resource.type === 'appointment' 
            ? handleConfirmDeleteAppointment 
            : handleConfirmDeleteException}
        />
      )}

      {/* Edit Appointment Modal - handles all steps (form, note, preview) */}
      {modalState.type === 'edit_appointment' && modalState.data && (
        <EditAppointmentModal
          event={modalState.data}
          practitioners={availablePractitioners.length > 0 ? availablePractitioners : practitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            setEditErrorMessage(null); // Clear error when closing
            setModalState({ type: 'event', data: modalState.data });
          }}
          onConfirm={handleConfirmEditAppointment}
          formatAppointmentTime={formatAppointmentTime}
          errorMessage={editErrorMessage}
        />
      )}

      {/* Create Appointment Modal */}
      {modalState.type === 'create_appointment' && modalState.data && (
        <CreateAppointmentModal
          key={`create-${createModalKey}`}
          // null from button click → undefined (no patient), number from URL → use it, undefined → fall back to prop
          preSelectedPatientId={
            modalState.data.patientId === null 
              ? undefined 
              : modalState.data.patientId ?? preSelectedPatientId
          }
          initialDate={modalState.data.initialDate || null}
          practitioners={availablePractitioners.length > 0 ? availablePractitioners : practitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            setModalState({ type: null, data: null });
            // Clear query parameter if it exists
            if (window.location.search.includes('createAppointment=')) {
              const url = new URL(window.location.href);
              url.searchParams.delete('createAppointment');
              window.history.replaceState({}, '', url.toString());
            }
          }}
          onConfirm={handleConfirmCreateAppointment}
        />
      )}
    </div>
  );
};

export default CalendarView;
