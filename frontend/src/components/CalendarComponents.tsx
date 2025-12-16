import React from 'react';
import moment from 'moment-timezone';
import { View, NavigateAction, Views } from 'react-big-calendar';
import { CalendarEvent, formatEventTimeRange } from '../utils/calendarDataAdapter';
import { getWeekdayNames } from '../utils/calendarUtils';
import { useIsMobile } from '../hooks/useIsMobile';

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

// Format date/month display for the left section (where 今天 button used to be)
const formatDateMonthDisplay = (date: Date, view: string) => {
  const taiwanDate = moment(date).tz('Asia/Taipei');
  const weekdayNames = getWeekdayNames();
  
  if (view === 'day') {
    // Day view: "11/27(四)" format
    const weekday = weekdayNames[taiwanDate.day()];
    return `${taiwanDate.format('M/D')}(${weekday})`;
  } else {
    // Week and Month view: "2025年11月" format
    return taiwanDate.format('YYYY年M月');
  }
};

// Custom Toolbar Component
export const CustomToolbar = React.memo((toolbar: ToolbarProps) => {
  const isMobile = useIsMobile();
  
  const handleToday = () => {
    // Navigate to today using React Big Calendar's built-in TODAY action
    toolbar.onNavigate('TODAY');
  };

  // Format date/month display for left section - memoize to avoid recreating moment objects
  const dateMonthDisplay = React.useMemo(
    () => formatDateMonthDisplay(toolbar.date, toolbar.view),
    [toolbar.date, toolbar.view]
  );

  // View mode options for the switcher
  const viewModes: Array<{ view: View; label: string }> = [
    { view: 'month', label: '月' },
    { view: 'week', label: '週' },
    { view: 'day', label: '日' },
  ];

  return (
    <div className={`flex justify-between items-center ${isMobile ? 'mb-2' : 'mb-4'}`}>
      <div className="flex items-center space-x-2 pl-4 md:pl-0">
        {/* Hide navigation arrows on mobile */}
        {!isMobile && (
          <button
            onClick={() => toolbar.onNavigate('PREV')}
            className="p-2 hover:bg-gray-100 rounded-md text-2xl font-bold"
          >
            ‹
          </button>
        )}
        {!isMobile && (
          <button
            onClick={() => toolbar.onNavigate('NEXT')}
            className="p-2 hover:bg-gray-100 rounded-md text-2xl font-bold"
          >
            ›
          </button>
        )}
        {/* Date/Month display - shown on both mobile and desktop */}
        <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold text-gray-900`}>
          {dateMonthDisplay}
        </h2>
      </div>
      <div className="flex items-center space-x-3 pr-4 md:pr-0">
        <button
          onClick={handleToday}
          className={`${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-md border border-gray-300`}
        >
          今天
        </button>
        <div className="flex space-x-0 rounded-md border border-gray-300 bg-gray-50 p-0.5">
          {viewModes.map(({ view, label }) => {
            const isActive = toolbar.view === view;
            return (
              <button
                key={view}
                onClick={() => toolbar.onView(view)}
                className={`${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} rounded-md font-semibold transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
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
  const isMobile = useIsMobile();
  const taiwanDate = moment(date).tz('Asia/Taipei');
  const weekdayNames = getWeekdayNames();
  const weekday = weekdayNames[taiwanDate.day()];
  
  // Hide on mobile - date is already shown in navigation bar
  if (isMobile) {
    return null;
  }
  
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
export const CustomEventComponent = ({ event, view }: { event: CalendarEvent; view?: View }) => {
  const timeStr = formatEventTimeRange(event.start, event.end);
  const practitionerName = event.resource.event_practitioner_name || event.resource.practitioner_name;
  const showPractitionerName = practitionerName && !event.resource.is_primary;
  const isAutoAssigned = event.resource.is_auto_assigned === true;
  const clinicNotes = event.resource.clinic_notes || '';
  
  // Determine character limit based on view
  // Daily view: 150 chars, Weekly view: 80 chars, Monthly view: 40 chars
  const charLimit = view === Views.DAY ? 150 : view === Views.WEEK ? 80 : 40;
  const shouldTruncate = clinicNotes.length > charLimit;
  const displayNotes = shouldTruncate ? clinicNotes.substring(0, charLimit) + '...' : clinicNotes;
  
  // Build tooltip with practitioner name if available
  // Order: Patient - Appointment Type, then Time, then Clinic Notes
  const tooltipParts: string[] = [];
  if (showPractitionerName) {
    tooltipParts.push(practitionerName);
  }
  if (event.title) {
    tooltipParts.push(event.title);
  }
  tooltipParts.push(timeStr);
  if (clinicNotes) {
    tooltipParts.push(clinicNotes);
  }
  const tooltipText = tooltipParts.join(' - ');

  return (
    <div 
      className="flex items-center space-x-1"
      title={tooltipText}
    >
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="text-xs leading-tight">
          {event.title && (
            <div className="font-medium whitespace-nowrap overflow-hidden text-ellipsis">
              {event.title}
            </div>
          )}
          {clinicNotes && (
            <div className="whitespace-nowrap overflow-hidden text-ellipsis">
              {displayNotes}
            </div>
          )}
          {isAutoAssigned && (
            <span className="text-white/80" title="系統自動指派">*</span>
          )}
        </div>
      </div>
    </div>
  );
};
