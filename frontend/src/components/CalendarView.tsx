import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  // Taiwan timezone - declared at the top to avoid hoisting issues
  const taiwanTimezone = 'Asia/Taipei';
  
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


  // Generate date string in YYYY-MM-DD format (Taiwan timezone)
  const getDateString = (date: Date) => {
    const taiwanDate = moment(date).tz(taiwanTimezone);
    return taiwanDate.format('YYYY-MM-DD');
  };

  // Format appointment time with date and weekday
  const formatAppointmentTime = (start: Date, end: Date): string => {
    const startMoment = moment(start).tz(taiwanTimezone);
    const endMoment = moment(end).tz(taiwanTimezone);
    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = weekdayNames[startMoment.day()];
    const dateStr = `${startMoment.format('M/D')} (${weekday})`;
    return `${dateStr} ${startMoment.format('h:mm A')} - ${endMoment.format('h:mm A')}`;
  };

  // Get date range for the current view (Taiwan timezone)
  const getDateRange = (date: Date, view: View) => {
    const start = moment(date).tz(taiwanTimezone);
    const end = moment(date).tz(taiwanTimezone);

    switch (view) {
      case Views.MONTH:
        start.startOf('month');
        end.endOf('month');
        break;
      case Views.DAY:
        start.startOf('day');
        end.endOf('day');
        break;
    }

    return { start: start.toDate(), end: end.toDate() };
  };


  // Transform events for React Big Calendar
  const calendarEvents = useMemo(() => {
    const events = [...allEvents];
    
    // Availability background events removed - no longer showing default schedule as gray boxes
    
    return transformToCalendarEvents(events);
  }, [allEvents, defaultSchedule, currentDate, view]);

  // Check for mobile view
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

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
      console.error('Failed to fetch default schedule:', err);
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

      const { start, end } = getDateRange(currentDate, view);
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
          console.warn(`Failed to fetch events for ${current.format('YYYY-MM-DD')}:`, err);
        }
        
        current.add(1, 'day');
      }

      setAllEvents(events);

    } catch (err) {
      setError('無法載入月曆資料');
      console.error('Fetch calendar data error:', err);
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
        end: moment(date).tz(taiwanTimezone).endOf('day').toDate(),
        slots: [date],
      });
    };
    
    return <CustomDateHeader date={date} onClick={handleClick} />;
  }, [handleSelectSlot, taiwanTimezone]);

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
      console.error('Error creating exception:', error);
      alert('建立休診時段失敗，請稍後再試');
    }
  };

  // Format time from time string (e.g., "09:00" -> "9:00 AM")
  const formatTimeString = (timeStr: string): string => {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    if (parts.length < 2 || !parts[0] || !parts[1]) return timeStr; // Invalid format, return as-is
    const hour = parseInt(parts[0], 10);
    const minutes = parts[1];
    if (isNaN(hour)) return timeStr; // Invalid hour, return as-is
    const period = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${hour12}:${minutes} ${period}`;
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
      console.error('Error generating cancellation preview:', error);
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
      console.error('Error deleting appointment:', error);
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
      console.error('Error deleting availability exception:', error);
      alert('刪除休診時段失敗，請稍後再試');
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-red-800">{error}</p>
        <button
          onClick={fetchCalendarData}
          className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
        >
          重試
        </button>
      </div>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            {modalState.data.resource.type === 'appointment' ? (
              <>
                <h3 className="text-lg font-semibold mb-4">{modalState.data.title}</h3>
                <div className="space-y-2">
                  <p><strong>時間:</strong> {formatAppointmentTime(modalState.data.start, modalState.data.end)}</p>
                  {modalState.data.resource.notes && (
                    <p><strong>備註:</strong> {modalState.data.resource.notes}</p>
                  )}
                  {modalState.data.resource.patient_phone && (
                    <p><strong>電話:</strong> {modalState.data.resource.patient_phone}</p>
                  )}
                  {modalState.data.resource.line_display_name && (
                    <p><strong>LINE:</strong> {modalState.data.resource.line_display_name}</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-4">休診</h3>
                <div className="space-y-2">
                  <p><strong>時間:</strong> {formatAppointmentTime(modalState.data.start, modalState.data.end)}</p>
                </div>
              </>
            )}
            <div className="flex justify-end space-x-2 mt-6">
              <button
                onClick={() => setModalState({ type: null, data: null })}
                className="btn-secondary"
              >
                關閉
              </button>
              {modalState.data.resource.type === 'appointment' && (
                <button
                  onClick={handleDeleteAppointment}
                  className="btn-primary"
                >
                  刪除預約
                </button>
              )}
              {modalState.data.resource.type === 'availability_exception' && (
                <button
                  onClick={handleDeleteException}
                  className="btn-primary"
                >
                  刪除
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Exception Modal */}
      {modalState.type === 'exception' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">新增休診時段</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  日期
                </label>
                <input
                  type="date"
                  className="input"
                  value={exceptionData.date}
                  onChange={(e) => setExceptionData(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="fullDay"
                  checked={isFullDay}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsFullDay(checked);
                    if (checked) {
                      setExceptionData(prev => ({ ...prev, startTime: '00:00', endTime: '23:59' }));
                    }
                  }}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="fullDay" className="ml-2 text-sm font-medium text-gray-700">
                  全天
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  開始時間
                </label>
                <input
                  type="time"
                  className="input"
                  value={exceptionData.startTime}
                  onChange={(e) => {
                    setExceptionData(prev => ({ ...prev, startTime: e.target.value }));
                    if (isFullDay) {
                      setIsFullDay(false);
                    }
                  }}
                  disabled={isFullDay}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  結束時間
                </label>
                <input
                  type="time"
                  className="input"
                  value={exceptionData.endTime}
                  onChange={(e) => {
                    setExceptionData(prev => ({ ...prev, endTime: e.target.value }));
                    if (isFullDay) {
                      setIsFullDay(false);
                    }
                  }}
                  disabled={isFullDay}
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button 
                onClick={() => {
                  setModalState({ type: null, data: null });
                  setIsFullDay(false);
                }}
                className="btn-secondary"
              >
                取消
              </button>
              <button 
                onClick={handleCreateException}
                className="btn-primary"
              >
                儲存休診時段
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conflict Warning Modal */}
      {modalState.type === 'conflict' && modalState.data && Array.isArray(modalState.data) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-red-800">無法建立休診時段</h3>
            </div>
            <p className="text-gray-700 mb-4">
              此休診時段與現有預約衝突，請先刪除以下衝突的預約後再建立休診時段：
            </p>
            <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
              {modalState.data.map((appointment: any, index: number) => (
                <div key={index} className="bg-red-50 border border-red-200 rounded-md p-3">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">
                        {appointment.title || appointment.patient_name || '預約'}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {formatTimeString(appointment.start_time)} - {formatTimeString(appointment.end_time)}
                      </p>
                      {appointment.notes && (
                        <p className="text-sm text-gray-500 mt-1">備註：{appointment.notes}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end space-x-2">
              <button 
                onClick={() => setModalState({ type: null, data: null })}
                className="btn-primary"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancellation Note Input Modal */}
      {modalState.type === 'cancellation_note' && modalState.data && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-blue-800">
                取消預約備註(選填)
              </h3>
            </div>
            <div className="space-y-4 mb-6">
              <textarea
                id="cancellation-note"
                value={cancellationNote}
                onChange={(e) => setCancellationNote(e.target.value)}
                placeholder="例如：臨時休診"
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                maxLength={200}
              />
              <p className="text-sm text-gray-500 mt-1">
                {cancellationNote.length}/200 字元
              </p>
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setModalState({ type: 'event', data: modalState.data })}
                className="btn-secondary"
              >
                返回
              </button>
              <button
                onClick={handleCancellationNoteSubmit}
                disabled={cancellationPreviewLoading}
                className="btn-primary"
              >
                {cancellationPreviewLoading ? '產生預覽中...' : '下一步'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancellation Preview Modal */}
      {modalState.type === 'cancellation_preview' && modalState.data && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-blue-800">
                LINE訊息預覽
              </h3>
            </div>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  病患將收到此LINE訊息
                </label>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="text-sm text-gray-700 whitespace-pre-line">
                    {cancellationPreviewMessage}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setModalState({ type: 'cancellation_note', data: modalState.data })}
                className="btn-secondary"
              >
                返回修改
              </button>
              <button
                onClick={handleConfirmDeleteAppointment}
                className="btn-primary bg-red-600 hover:bg-red-700"
              >
                確認取消預約
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {modalState.type === 'delete_confirmation' && modalState.data && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-red-800">
                {modalState.data.resource.type === 'appointment' 
                  ? '確認取消預約' 
                  : '確認刪除休診時段'}
              </h3>
            </div>
            <div className="space-y-3 mb-4">
              <p className="text-gray-700">
                {modalState.data.resource.type === 'appointment' 
                  ? '您確定要取消此預約嗎？'
                  : '您確定要刪除此休診時段嗎？'}
              </p>
              {modalState.data.resource.type === 'appointment' && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <p className="text-sm text-blue-800">
                    <strong>提醒：</strong>取消預約後，系統將會自動通知患者此預約已被取消。
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end space-x-2">
              <button 
                onClick={() => {
                  // Return to event view
                  setModalState({ type: 'event', data: modalState.data });
                }}
                className="btn-secondary"
              >
                取消
              </button>
              <button 
                onClick={modalState.data.resource.type === 'appointment' 
                  ? handleConfirmDeleteAppointment 
                  : handleConfirmDeleteException}
                className="btn-primary bg-red-600 hover:bg-red-700"
              >
                {modalState.data.resource.type === 'appointment' 
                  ? '確認取消'
                  : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarView;
