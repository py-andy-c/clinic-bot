/**
 * Calendar view types - local definitions to avoid react-big-calendar dependencies
 */

export type CalendarView = 'month' | 'week' | 'day';

export const CalendarViews = {
  MONTH: 'month' as const,
  WEEK: 'week' as const,
  DAY: 'day' as const,
} as const;

export type CalendarViewsType = typeof CalendarViews;