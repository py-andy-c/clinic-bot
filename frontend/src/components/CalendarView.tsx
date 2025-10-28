import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { MonthlyCalendarData, DailyCalendarData, CalendarEventItem } from '../types';

interface CalendarViewProps {
  userId: number;
}

const CalendarView: React.FC<CalendarViewProps> = ({ userId }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'monthly' | 'daily'>('monthly');
  const [monthlyData, setMonthlyData] = useState<MonthlyCalendarData | null>(null);
  const [dailyData, setDailyData] = useState<DailyCalendarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate month string in YYYY-MM format
  const getMonthString = (date: Date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  };

  // Generate date string in YYYY-MM-DD format
  const getDateString = (date: Date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (viewMode === 'monthly') {
      fetchMonthlyData();
    } else {
      fetchDailyData();
    }
  }, [userId, currentDate, viewMode]);

  const fetchMonthlyData = async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setError(null);
      const monthStr = getMonthString(currentDate);
      const data = await apiService.getMonthlyCalendar(userId, monthStr);
      setMonthlyData(data);
    } catch (err) {
      setError('無法載入月曆資料');
      console.error('Fetch monthly calendar error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDailyData = async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setError(null);
      const dateStr = getDateString(currentDate);
      const data = await apiService.getDailyCalendar(userId, dateStr);
      setDailyData(data);
    } catch (err) {
      setError('無法載入每日資料');
      console.error('Fetch daily calendar error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleDayClick = (date: string) => {
    const clickedDate = new Date(date);
    setCurrentDate(clickedDate);
    setViewMode('daily');
  };

  const handleBackToMonthly = () => {
    setViewMode('monthly');
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday, 6 = Saturday

    const days = [];

    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const appointmentCount = monthlyData?.days.find(d => d.date === dateStr)?.appointment_count || 0;
      days.push({ day, date: dateStr, appointmentCount });
    }

    return days;
  };

  const formatTime = (timeStr: string) => {
    return timeStr.substring(0, 5); // HH:MM format
  };

  const isOutsideHours = (event: CalendarEventItem, defaultSchedule: any[]) => {
    if (!event.start_time || !event.end_time) return false;

    // Check if the event time overlaps with any default schedule interval
    return !defaultSchedule.some(interval => {
      const intervalStart = interval.start_time;
      const intervalEnd = interval.end_time;
      const eventStart = event.start_time!;
      const eventEnd = event.end_time!;

      return eventStart >= intervalStart && eventEnd <= intervalEnd;
    });
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
          onClick={viewMode === 'monthly' ? fetchMonthlyData : fetchDailyData}
          className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
        >
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            {viewMode === 'monthly'
              ? `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月`
              : `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月${currentDate.getDate()}日`
            }
          </h2>
        </div>
        <div className="flex space-x-2">
          {viewMode === 'daily' && (
            <button
              onClick={handleBackToMonthly}
              className="btn-secondary"
            >
              月曆檢視
            </button>
          )}
          <div className="flex space-x-1">
            <button
              onClick={() => setViewMode('monthly')}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                viewMode === 'monthly'
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              月
            </button>
            <button
              onClick={() => setViewMode('daily')}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                viewMode === 'daily'
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              日
            </button>
          </div>
        </div>
      </div>

      {/* Monthly View */}
      {viewMode === 'monthly' && monthlyData && (
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={handlePreviousMonth}
              className="p-2 hover:bg-gray-100 rounded-md"
            >
              ‹
            </button>
            <h3 className="text-lg font-medium text-gray-900">
              {currentDate.getFullYear()}年{currentDate.getMonth() + 1}月
            </h3>
            <button
              onClick={handleNextMonth}
              className="p-2 hover:bg-gray-100 rounded-md"
            >
              ›
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['日', '一', '二', '三', '四', '五', '六'].map(day => (
              <div key={day} className="p-2 text-center text-sm font-medium text-gray-500">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {getDaysInMonth(currentDate).map((dayData, index) => (
              <div
                key={index}
                className={`min-h-[80px] p-2 border border-gray-200 rounded-md ${
                  dayData ? 'hover:bg-gray-50 cursor-pointer' : ''
                }`}
                onClick={() => dayData && handleDayClick(dayData.date)}
              >
                {dayData && (
                  <>
                    <div className="text-sm font-medium text-gray-900 mb-1">
                      {dayData.day}
                    </div>
                    {dayData.appointmentCount > 0 && (
                      <div className="flex justify-center">
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-primary-100 text-primary-800 text-xs font-medium rounded-full">
                          {dayData.appointmentCount}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily View */}
      {viewMode === 'daily' && dailyData && (
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => setCurrentDate(new Date(currentDate.getTime() - 24 * 60 * 60 * 1000))}
              className="p-2 hover:bg-gray-100 rounded-md"
            >
              ‹
            </button>
            <h3 className="text-lg font-medium text-gray-900">
              {currentDate.getFullYear()}年{currentDate.getMonth() + 1}月{currentDate.getDate()}日
            </h3>
            <button
              onClick={() => setCurrentDate(new Date(currentDate.getTime() + 24 * 60 * 60 * 1000))}
              className="p-2 hover:bg-gray-100 rounded-md"
            >
              ›
            </button>
          </div>

          {/* Time slots */}
          <div className="space-y-1">
            {/* Default availability slots */}
            {dailyData.default_schedule.map((interval, index) => (
              <div key={`default-${index}`} className="flex items-center p-3 bg-green-50 border border-green-200 rounded-md">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                    <span className="font-medium text-green-800">
                      {formatTime(interval.start_time)} - {formatTime(interval.end_time)}
                    </span>
                    <span className="text-sm text-green-600">預設時段</span>
                  </div>
                </div>
              </div>
            ))}

            {/* Events */}
            {dailyData.events.map((event) => (
              <div
                key={`${event.event_type}-${event.calendar_event_id}`}
                className={`flex items-center p-3 border rounded-md ${
                  event.event_type === 'appointment'
                    ? isOutsideHours(event, dailyData.default_schedule)
                      ? 'bg-orange-50 border-orange-200'
                      : 'bg-blue-50 border-blue-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <div className={`w-4 h-4 rounded-full ${
                      event.event_type === 'appointment'
                        ? isOutsideHours(event, dailyData.default_schedule)
                          ? 'bg-orange-500'
                          : 'bg-blue-500'
                        : 'bg-red-500'
                    }`}></div>
                    <div>
                      <div className="font-medium text-gray-900">
                        {event.start_time && event.end_time
                          ? `${formatTime(event.start_time)} - ${formatTime(event.end_time)}`
                          : '全天'
                        }
                      </div>
                      <div className="text-sm text-gray-600">
                        {event.title}
                        {event.event_type === 'appointment' && isOutsideHours(event, dailyData.default_schedule) && (
                          <span className="ml-2 text-orange-600">超出工作時間</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {event.event_type === 'appointment' && (
                  <button className="text-gray-400 hover:text-gray-600">
                    ✏️
                  </button>
                )}
              </div>
            ))}

            {/* Non-working hours */}
            {dailyData.default_schedule.length === 0 && dailyData.events.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                本日無排定時段
              </div>
            )}
          </div>

          {/* Add exception button */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <button className="btn-primary w-full">
              + 新增例外時段
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarView;
