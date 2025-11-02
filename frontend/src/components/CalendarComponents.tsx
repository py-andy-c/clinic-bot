import moment from 'moment-timezone';
import { CalendarEvent } from '../utils/calendarDataAdapter';

// Format date in Traditional Chinese
const formatChineseDate = (date: Date, view: string) => {
  const taiwanDate = moment(date).tz('Asia/Taipei');
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const weekday = weekdayNames[taiwanDate.day()];
  
  if (view === 'month') {
    // Month view: "YYYY年M月"
    return taiwanDate.format('YYYY年M月');
  } else {
    // Day view: "M月D日 (X)"
    return `${taiwanDate.format('M月D日')} (${weekday})`;
  }
};

// Custom Toolbar Component
export const CustomToolbar = (toolbar: any) => {
  const handleToday = () => {
    // Navigate to today using React Big Calendar's built-in TODAY action
    toolbar.onNavigate('TODAY');
  };

  // Format date label in Traditional Chinese
  const formattedLabel = formatChineseDate(toolbar.date, toolbar.view);

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
};

// Custom Weekday Header Component for Month View Column Headers
export const CustomWeekdayHeader = ({ date }: any) => {
  const taiwanDate = moment(date).tz('Asia/Taipei');
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const weekday = weekdayNames[taiwanDate.day()];
  
  return (
    <div className="text-center">
      {weekday}
    </div>
  );
};

// Custom Date Header Component for Month View
export const CustomDateHeader = ({ date }: any) => {
  const taiwanDate = moment(date).tz('Asia/Taipei');
  
  return (
    <div className="text-center">
      <div className="text-sm font-medium text-gray-900">
        {taiwanDate.format('D')}
      </div>
    </div>
  );
};

// Custom Day Header Component for Day View
export const CustomDayHeader = ({ date }: any) => {
  const taiwanDate = moment(date).tz('Asia/Taipei');
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
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

// Custom Event Component
export const CustomEventComponent = ({ event }: { event: CalendarEvent }) => {
  return (
    <div className="flex items-center space-x-1">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">
          {event.title}
        </div>
      </div>
    </div>
  );
};
