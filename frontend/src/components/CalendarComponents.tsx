import React from 'react';
import moment from 'moment-timezone';
import { View, NavigateAction } from 'react-big-calendar';
import { CalendarEvent, formatEventTimeRange } from '../utils/calendarDataAdapter';
import { getWeekdayNames } from '../utils/calendarUtils';

// TypeScript interface for toolbar props - matches react-big-calendar's ToolbarProps signature
// Using a compatible interface since the library's ToolbarProps is generic and not easily imported
interface ToolbarProps {
  date: Date;
  view: View;
  onNavigate: (action: NavigateAction, date?: Date) => void;
  onView: (view: View) => void;
  label?: string;
  messages?: Record<string, string>;
}

// Format date in Traditional Chinese
const formatChineseDate = (date: Date, view: string) => {
  const taiwanDate = moment(date).tz('Asia/Taipei');
  const weekdayNames = getWeekdayNames();
  const weekday = weekdayNames[taiwanDate.day()];
  
  if (view === 'month') {
    // Month view: "YYYY年M月"
    return taiwanDate.format('YYYY年M月');
  } else if (view === 'week') {
    // Week view: "M月D日 (X) - M月D日 (X)" - show the week range
    // Note: startOf('week') uses locale settings, which should be Sunday for zh-tw
    const weekStart = taiwanDate.clone().startOf('week');
    const weekEnd = taiwanDate.clone().endOf('week');
    const startWeekday = weekdayNames[weekStart.day()];
    const endWeekday = weekdayNames[weekEnd.day()];
    return `${weekStart.format('M月D日')} (${startWeekday}) - ${weekEnd.format('M月D日')} (${endWeekday})`;
  } else {
    // Day view: "M月D日 (X)"
    return `${taiwanDate.format('M月D日')} (${weekday})`;
  }
};

// Custom Toolbar Component
export const CustomToolbar = React.memo((toolbar: ToolbarProps) => {
  const handleToday = () => {
    // Navigate to today using React Big Calendar's built-in TODAY action
    toolbar.onNavigate('TODAY');
  };

  // Format date label in Traditional Chinese - memoize to avoid recreating moment objects
  const formattedLabel = React.useMemo(
    () => formatChineseDate(toolbar.date, toolbar.view),
    [toolbar.date, toolbar.view]
  );

  return (
    <div className="flex justify-between items-center mb-4">
      <div className="flex items-center space-x-2">
        <button
          onClick={() => toolbar.onNavigate('PREV')}
          className="p-2 hover:bg-gray-100 rounded-md"
        >
          ‹
        </button>
        <h2 className="text-xl font-semibold text-gray-900">
          {formattedLabel}
        </h2>
        <button
          onClick={() => toolbar.onNavigate('NEXT')}
          className="p-2 hover:bg-gray-100 rounded-md"
        >
          ›
        </button>
        <button
          onClick={handleToday}
          className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md"
        >
          今天
        </button>
      </div>
      <div className="flex space-x-1">
        <button
          onClick={() => toolbar.onView('month')}
          className={`px-3 py-2 rounded-md text-sm font-medium ${
            toolbar.view === 'month'
              ? 'bg-primary-100 text-primary-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          月
        </button>
        <button
          onClick={() => toolbar.onView('week')}
          className={`px-3 py-2 rounded-md text-sm font-medium ${
            toolbar.view === 'week'
              ? 'bg-primary-100 text-primary-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          週
        </button>
        <button
          onClick={() => toolbar.onView('day')}
          className={`px-3 py-2 rounded-md text-sm font-medium ${
            toolbar.view === 'day'
              ? 'bg-primary-100 text-primary-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          日
        </button>
      </div>
    </div>
  );
});

// Custom Weekday Header Component for Month View Column Headers
export const CustomWeekdayHeader = ({ date }: any) => {
  const taiwanDate = moment(date).tz('Asia/Taipei');
  const weekdayNames = getWeekdayNames();
  const weekday = weekdayNames[taiwanDate.day()];
  
  return (
    <div className="text-center">
      {weekday}
    </div>
  );
};

// Custom Date Header Component for Month View
// Accepts optional onClick handler for date navigation
export const CustomDateHeader = ({ date, onClick }: any) => {
  const taiwanDate = moment(date).tz('Asia/Taipei');
  
  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }
  };
  
  return (
    <div className="text-center" onClick={onClick ? handleClick : undefined}>
      <div className={`text-sm font-medium text-gray-900 ${onClick ? 'cursor-pointer hover:text-primary-600 inline-block' : ''}`}>
        {taiwanDate.format('D')}
      </div>
    </div>
  );
};

// Custom Day Header Component for Day View
export const CustomDayHeader = ({ date }: any) => {
  const taiwanDate = moment(date).tz('Asia/Taipei');
  const weekdayNames = getWeekdayNames();
  const weekday = weekdayNames[taiwanDate.day()];
  
  return (
    <div className="text-center">
      <div className="text-sm font-medium text-gray-900">
        {taiwanDate.format('M月D日')}
      </div>
      <div className="text-xs text-gray-500">
        ({weekday})
      </div>
    </div>
  );
};

// Custom Week Header Component for Week View
// Displays weekday and date for each day column in week view
export const CustomWeekHeader = ({ date }: any) => {
  const taiwanDate = moment(date).tz('Asia/Taipei');
  const weekdayNames = getWeekdayNames();
  const weekday = weekdayNames[taiwanDate.day()];
  const isToday = moment().tz('Asia/Taipei').isSame(taiwanDate, 'day');
  
  return (
    <div className="text-center py-2 px-1 min-h-[60px] flex flex-col justify-center">
      <div className={`text-xs font-medium mb-1 ${isToday ? 'text-primary-600 font-semibold' : 'text-gray-500'}`}>
        {weekday}
      </div>
      <div className={`text-sm font-semibold ${isToday ? 'text-primary-700' : 'text-gray-900'}`}>
        {taiwanDate.format('M/D')}
      </div>
    </div>
  );
};

// Custom Event Component
export const CustomEventComponent = ({ event }: { event: CalendarEvent }) => {
  const timeStr = formatEventTimeRange(event.start, event.end);
  const practitionerName = event.resource.event_practitioner_name || event.resource.practitioner_name;
  const showPractitionerName = practitionerName && !event.resource.is_primary;
  const isAutoAssigned = event.resource.is_auto_assigned === true;
  
  // Build tooltip with practitioner name if available
  const tooltipText = showPractitionerName 
    ? `${practitionerName} - ${timeStr} ${event.title || ''}`.trim()
    : `${timeStr} ${event.title || ''}`.trim();

  return (
    <div 
      className="flex items-center space-x-1"
      title={tooltipText}
    >
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="text-xs leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
          <span className="font-medium">{timeStr}</span>
          {event.title && (
            <span className="ml-1">{event.title}</span>
          )}
          {isAutoAssigned && (
            <span className="ml-1 text-white/80" title="系統自動指派">*</span>
          )}
        </div>
      </div>
    </div>
  );
};
