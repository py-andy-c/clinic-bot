import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { logger } from '../utils/logger';
import { LoadingSpinner, ErrorMessage } from './shared';
import { Calendar, momentLocalizer, View, Views } from 'react-big-calendar';
import moment from 'moment-timezone';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { apiService } from '../services/api';
import { ApiCalendarEvent } from '../types';
import { 
  transformToCalendarEvents, 
  CalendarEvent 
} from '../utils/calendarDataAdapter';
import { CustomToolbar, CustomEventComponent, CustomDateHeader, CustomDayHeader, CustomWeekdayHeader } from './CalendarComponents';
import {
  EventModal,
  ExceptionModal,
  ConflictModal,
  CancellationNoteModal,
  CancellationPreviewModal,
  DeleteConfirmationModal,
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
  onSelectEvent?: (event: CalendarEvent) => void;
  onNavigate?: (date: Date) => void;
  onAddExceptionHandlerReady?: (handler: () => void, view: View) => void;
}

const CalendarView: React.FC<CalendarViewProps> = ({ 
  userId, 
  onSelectEvent, 
  onNavigate,
  onAddExceptionHandlerReady
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<View>(Views.DAY);
  const [allEvents, setAllEvents] = useState<ApiCalendarEvent[]>([]);
  const [defaultSchedule, setDefaultSchedule] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalState, setModalState] = useState<{
    type: 'event' | 'exception' | 'conflict' | 'delete_confirmation' | 'cancellation_note' | 'cancellation_preview' | null;
    data: any;
  }>({ type: null, data: null });
  const [exceptionData, setExceptionData] = useState({
    date: '',
    startTime: '',
    endTime: ''
  });
  const [cancellationNote, setCancellationNote] = useState('');
  const [cancellationPreviewMessage, setCancellationPreviewMessage] = useState('');
  const [cancellationPreviewLoading, setCancellationPreviewLoading] = useState(false);
  const [isFullDay, setIsFullDay] = useState(false);
  const scrollYRef = useRef(0);

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

  useEffect(() => {
    fetchCalendarData();
    fetchDefaultSchedule();
  }, [userId, currentDate, view]);

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

      // Fetch events for each day in the range (only for daily view)
      const current = moment(start);
      const endMoment = moment(end);

      while (current.isSameOrBefore(endMoment, 'day')) {
        try {
          const dateStr = current.format('YYYY-MM-DD');
          const data: any = await apiService.getDailyCalendar(userId, dateStr);
          
          if (data.events) {
            // Add date to each event for proper display
            const eventsWithDate = data.events.map((event: any) => ({
              ...event,
              date: dateStr
            }));
            events.push(...eventsWithDate);
          }
        } catch (err) {
          logger.warn(`Failed to fetch events for ${current.format('YYYY-MM-DD')}:`, err);
        }
        
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

  // Event styling based on document requirements
  const eventStyleGetter = (event: CalendarEvent) => {
    let style: any = {
      borderRadius: '6px',
      color: 'white',
      border: 'none',
      display: 'block'
    };

    // Style based on event type
    if (event.resource.type === 'appointment') {
      style = {
        ...style,
        backgroundColor: '#3B82F6', // Blue for appointments
        opacity: 1
      };
    } else if (event.resource.type === 'availability_exception') {
      style = {
        ...style,
        backgroundColor: '#E5E7EB', // Light gray for exceptions
        color: '#1F2937', // Dark gray text for readability
        opacity: 1
      };
    }
    
    return { style };
  };

  // Handle event selection
  const handleSelectEvent = (event: CalendarEvent) => {
    setModalState({ type: 'event', data: event });
    if (onSelectEvent) {
      onSelectEvent(event);
    }
  };

  // Handle slot selection - only for monthly view navigation
  const handleSelectSlot = (slotInfo: any) => {
    // In monthly view, clicking a date should navigate to daily view of that date
    if (view === Views.MONTH) {
      setCurrentDate(slotInfo.start);
      setView(Views.DAY);
      if (onNavigate) {
        onNavigate(slotInfo.start);
      }
    }
    // In daily view, clicking blank space does nothing
  };

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
  const handleNavigate = (date: Date) => {
    setCurrentDate(date);
    if (onNavigate) {
      onNavigate(date);
    }
  };


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
      alert('請輸入日期、開始和結束時間');
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

      // Create exception
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
      alert('休診時段已建立');
    } catch (error) {
      logger.error('Error creating exception:', error);
      alert('建立休診時段失敗，請稍後再試');
    }
  };


  // Show delete confirmation for appointments
  const handleDeleteAppointment = () => {
    if (!modalState.data || !modalState.data.resource.appointment_id) return;
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
      alert('無法產生預覽訊息，請稍後再試');
    } finally {
      setCancellationPreviewLoading(false);
    }
  };

  // Confirm and perform appointment deletion
  const handleConfirmDeleteAppointment = async () => {
    if (!modalState.data || !modalState.data.resource.appointment_id) return;

    try {
      await apiService.cancelClinicAppointment(modalState.data.resource.appointment_id, cancellationNote.trim() || undefined);

      // Refresh data
      await fetchCalendarData();
      setModalState({ type: null, data: null });
      setCancellationNote('');
      setCancellationPreviewMessage('');
    } catch (error) {
      logger.error('Error deleting appointment:', error);
      alert('取消預約失敗，請稍後再試');
    }
  };

  // Show delete confirmation for availability exceptions
  const handleDeleteException = () => {
    if (!modalState.data || !modalState.data.resource.exception_id) return;
    // Show confirmation modal instead of deleting directly
    setModalState({ type: 'delete_confirmation', data: modalState.data });
  };

  // Confirm and perform exception deletion
  const handleConfirmDeleteException = async () => {
    if (!modalState.data || !modalState.data.resource.exception_id) return;

    try {
      await apiService.deleteAvailabilityException(userId, modalState.data.resource.exception_id);
      
      // Refresh data
      await fetchCalendarData();
      setModalState({ type: null, data: null });
    } catch (error) {
      logger.error('Error deleting availability exception:', error);
      alert('刪除休診時段失敗，請稍後再試');
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
      {modalState.type === 'event' && modalState.data && (
        <EventModal
          event={modalState.data}
          onClose={() => setModalState({ type: null, data: null })}
          onDeleteAppointment={modalState.data.resource.type === 'appointment' ? handleDeleteAppointment : undefined}
          onDeleteException={modalState.data.resource.type === 'availability_exception' ? handleDeleteException : undefined}
          formatAppointmentTime={formatAppointmentTime}
        />
      )}

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
      {modalState.type === 'delete_confirmation' && modalState.data && (
        <DeleteConfirmationModal
          event={modalState.data}
          onCancel={() => setModalState({ type: 'event', data: modalState.data })}
          onConfirm={modalState.data.resource.type === 'appointment' 
            ? handleConfirmDeleteAppointment 
            : handleConfirmDeleteException}
        />
      )}
    </div>
  );
};

export default CalendarView;
