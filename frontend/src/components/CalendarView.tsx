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
    type: 'event' | 'exception' | 'conflict' | null;
    data: any;
  }>({ type: null, data: null });
  const [exceptionData, setExceptionData] = useState({
    startTime: '',
    endTime: ''
  });


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
    return `${dateStr} ${startMoment.format('HH:mm')} - ${endMoment.format('HH:mm')}`;
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
    const isOutsideHours = event.resource.isOutsideHours;
    
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
        backgroundColor: isOutsideHours ? '#F59E0B' : '#3B82F6', // Orange for outside hours, blue for normal
        opacity: isOutsideHours ? 0.7 : 1
      };
    } else if (event.resource.type === 'availability_exception') {
      style = {
        ...style,
        backgroundColor: '#EF4444', // Red for exceptions
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
      startTime: '',
      endTime: ''
    });
    setModalState({ type: 'exception', data: null });
  }, [view]);

  // Expose handler to parent component
  useEffect(() => {
    if (onAddExceptionHandlerReady) {
      onAddExceptionHandlerReady(handleAddException, view);
    }
  }, [view, onAddExceptionHandlerReady, handleAddException]);


  // Create availability exception with conflict checking
  const handleCreateException = async () => {
    if (!exceptionData.startTime || !exceptionData.endTime) {
      alert('請輸入開始和結束時間');
      return;
    }

    const dateStr = getDateString(currentDate);
    
    try {
      // Simple conflict check - get today's events and check for overlaps
      const dailyData = await apiService.getDailyCalendar(userId, dateStr);
      const appointments = dailyData.events.filter((event: any) => event.type === 'appointment');
      
      const hasConflict = appointments.some((appointment: any) => {
        if (!appointment.start_time || !appointment.end_time) return false;
        return appointment.start_time < exceptionData.endTime && appointment.end_time > exceptionData.startTime;
      });

      if (hasConflict) {
        setModalState({ type: 'conflict', data: '此休診時段與現有預約衝突，預約將標記為「超出診療時段」' });
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
      setExceptionData({ startTime: '', endTime: '' });
      alert('休診時段已建立');
    } catch (error) {
      console.error('Error creating exception:', error);
      alert('建立休診時段失敗，請稍後再試');
    }
  };

  // Confirm exception creation despite conflicts
  const handleConfirmExceptionWithConflicts = async () => {
    const dateStr = getDateString(currentDate);
    
    try {
      await apiService.createAvailabilityException(userId, {
        date: dateStr,
        start_time: exceptionData.startTime,
        end_time: exceptionData.endTime
      });

      // Refresh data
      await fetchCalendarData();
      setModalState({ type: null, data: null });
      setExceptionData({ startTime: '', endTime: '' });
      alert('休診時段已建立（有衝突的預約將標記為超出診療時段）');
    } catch (error) {
      console.error('Error creating exception:', error);
      alert('建立休診時段失敗，請稍後再試');
    }
  };

  // Delete appointment
  const handleDeleteAppointment = async () => {
    if (!modalState.data || !modalState.data.resource.appointment_id) return;

    try {
      await apiService.cancelClinicAppointment(modalState.data.resource.appointment_id);
      
      // Refresh data
      await fetchCalendarData();
      setModalState({ type: null, data: null });
      alert('預約已取消，已通知患者');
    } catch (error) {
      console.error('Error deleting appointment:', error);
      alert('取消預約失敗，請稍後再試');
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
      <div className="card">
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
              dateHeader: CustomDateHeader,
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
                  {modalState.data.resource.isOutsideHours && (
                    <p className="text-orange-600"><strong>狀態:</strong> 超出診療時段</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-4">事件詳情</h3>
                <div className="space-y-2">
                  <p><strong>標題:</strong> {modalState.data.title}</p>
                  <p><strong>時間:</strong> {moment(modalState.data.start).format('HH:mm')} - {moment(modalState.data.end).format('HH:mm')}</p>
                  <p><strong>類型:</strong> 例外時段</p>
                </div>
              </>
            )}
            <div className="flex justify-end space-x-2 mt-6">
              {modalState.data.resource.type === 'appointment' && (
                <button 
                  onClick={handleDeleteAppointment}
                  className="btn-secondary"
                >
                  刪除預約
                </button>
              )}
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

      {/* Exception Modal */}
      {modalState.type === 'exception' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">新增休診時段</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  開始時間
                </label>
                <input
                  type="time"
                  className="input"
                  value={exceptionData.startTime}
                  onChange={(e) => setExceptionData(prev => ({ ...prev, startTime: e.target.value }))}
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
                  onChange={(e) => setExceptionData(prev => ({ ...prev, endTime: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button 
                onClick={() => setModalState({ type: null, data: null })}
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
      {modalState.type === 'conflict' && modalState.data && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-orange-800">衝突警告</h3>
            </div>
            <p className="text-gray-700 mb-4">{modalState.data}</p>
            <div className="flex justify-end space-x-2">
              <button 
                onClick={() => setModalState({ type: null, data: null })}
                className="btn-secondary"
              >
                取消
              </button>
              <button 
                onClick={handleConfirmExceptionWithConflicts}
                className="btn-primary"
              >
                確認建立
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarView;
