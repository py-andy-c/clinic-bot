import moment from 'moment-timezone';
import { View, Views } from 'react-big-calendar';

/**
 * Time slot configuration for calendar grid
 */
export interface TimeSlot {
  hour: number;
  minute: number;
  time: string;
}

/**
 * Generate time slots for calendar grid (8 AM to 10 PM, 15-minute intervals)
 */
export const generateTimeSlots = (): TimeSlot[] => {
  const slots: TimeSlot[] = [];
  for (let hour = 8; hour <= 22; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      slots.push({
        hour,
        minute,
        time: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
      });
    }
  }
  return slots;
};

/**
 * Get current time in Taiwan timezone
 */
export const getCurrentTaiwanTime = () => {
  return moment().tz('Asia/Taipei');
};

/**
 * Calculate current time indicator position for calendar grid
 */
export const calculateCurrentTimeIndicatorPosition = (
  currentDate: Date,
  view: View
): React.CSSProperties => {
  const now = getCurrentTaiwanTime();
  const today = moment(currentDate).tz('Asia/Taipei').startOf('day');

  if (!now.isSame(today, 'day')) {
    return { display: 'none' };
  }

  const hours = now.hour();
  const minutes = now.minute();

  // Only show indicator between 8 AM and 10 PM
  if (hours < 8 || hours > 22) {
    return { display: 'none' };
  }

  // Calculate position: (hours from 8 AM * 60 + minutes) / 15 * 20px per slot
  const minutesFrom8AM = (hours - 8) * 60 + minutes;
  const pixelsFromTop = (minutesFrom8AM / 15) * 20;

  return {
    top: `${pixelsFromTop}px`,
    left: view === Views.DAY ? '28px' : '0',
    right: view === Views.DAY ? '0' : 'auto',
    width: view === Views.DAY ? 'auto' : '100%',
  };
};

/**
 * Convert hour and minute to Date object in Taiwan timezone
 */
export const createTimeSlotDate = (currentDate: Date, hour: number, minute: number): Date => {
  return moment(currentDate).tz('Asia/Taipei')
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0)
    .toDate();
};

/**
 * Calculate event position in calendar grid
 */
export const calculateEventPosition = (start: Date): React.CSSProperties => {
  const top = (start.getHours() - 8) * 80 + (start.getMinutes() / 15) * 20;
  return { top: `${top}px` };
};

/**
 * Calculate event height in calendar grid
 */
export const calculateEventHeight = (start: Date, end: Date): React.CSSProperties => {
  const duration = (end.getTime() - start.getTime()) / (1000 * 60); // minutes
  const height = Math.max((duration / 15) * 20, 20);
  return { height: `${height}px` };
};