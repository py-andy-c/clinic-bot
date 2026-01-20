import { useQuery, QueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';
import { CalendarEvent, transformToCalendarEvents } from '../../utils/calendarDataAdapter';
import { CalendarView } from '../../types/calendar';
import moment from 'moment-timezone';

interface UseCalendarEventsParams {
  selectedPractitioners: number[];
  selectedResources: number[];
  currentDate: Date;
  view: CalendarView;
}

const getDateRange = (currentDate: Date, view: CalendarView) => {

  if (view === 'day') {
    const dateString = moment(currentDate).tz('Asia/Taipei').format('YYYY-MM-DD');
    return { startDate: dateString, endDate: dateString, dateRangeKey: dateString };
  } else if (view === 'week') {
    const weekStart = moment(currentDate).tz('Asia/Taipei').startOf('week');
    const weekEnd = moment(currentDate).tz('Asia/Taipei').endOf('week');
    const weekKey = `${weekStart.format('YYYY-MM-DD')}_${weekEnd.format('YYYY-MM-DD')}`;
    return {
      startDate: weekStart.format('YYYY-MM-DD'),
      endDate: weekEnd.format('YYYY-MM-DD'),
      dateRangeKey: weekKey
    };
  } else { // month
    const monthStart = moment(currentDate).tz('Asia/Taipei').startOf('month');
    const monthEnd = moment(currentDate).tz('Asia/Taipei').endOf('month');
    const monthKey = `${monthStart.format('YYYY-MM-DD')}_${monthEnd.format('YYYY-MM-DD')}`;
    return {
      startDate: monthStart.format('YYYY-MM-DD'),
      endDate: monthEnd.format('YYYY-MM-DD'),
      dateRangeKey: monthKey
    };
  }
};

const fetchCalendarEvents = async (params: UseCalendarEventsParams): Promise<CalendarEvent[]> => {
  const { selectedPractitioners, selectedResources, currentDate, view } = params;
  const { startDate, endDate } = getDateRange(currentDate, view);

  const [practitionerEvents, resourceEvents] = await Promise.all([
    selectedPractitioners.length > 0
      ? apiService.getBatchCalendar({
          practitionerIds: selectedPractitioners,
          startDate,
          endDate
        })
      : Promise.resolve({ results: [] }),
    selectedResources.length > 0
      ? apiService.getBatchResourceCalendar({
          resourceIds: selectedResources,
          startDate,
          endDate
        })
      : Promise.resolve({ results: [] })
  ]);

  // Transform events - need to include date and practitioner_id from result level
  const practitionerEventsRaw = practitionerEvents.results.flatMap(r =>
    r.events.map(event => ({ ...event, date: r.date, practitioner_id: r.user_id }))
  );
  const resourceEventsRaw = resourceEvents.results?.flatMap(r =>
    r.events.map(event => ({ ...event, date: r.date }))
  ) || [];

  return [
    ...transformToCalendarEvents(practitionerEventsRaw),
    ...transformToCalendarEvents(resourceEventsRaw)
  ];
};

// Create stable, sorted keys for consistent query caching
const createStableArrayKey = (arr: number[]): string => {
  return [...arr].sort((a, b) => a - b).join(',');
};

export const useCalendarEvents = (params: UseCalendarEventsParams) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { selectedPractitioners, selectedResources, currentDate, view } = params;
  const { dateRangeKey } = getDateRange(currentDate, view);

  // Create stable keys for consistent caching regardless of array order
  const practitionersKey = createStableArrayKey(selectedPractitioners);
  const resourcesKey = createStableArrayKey(selectedResources);

  return useQuery({
    queryKey: ['calendar-events', activeClinicId, {
      practitioners: practitionersKey,
      resources: resourcesKey,
      dateRangeKey,
      view
    }],
    queryFn: () => fetchCalendarEvents(params),
    enabled: !!activeClinicId && (selectedPractitioners.length > 0 || selectedResources.length > 0),
    staleTime: 1 * 60 * 1000, // 1 minute - calendar data should be relatively fresh
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: (failureCount, error: any) => {
      // Don't retry on auth errors or client errors
      if (error && typeof error === 'object' && 'status' in error) {
        const status = error.status;
        if (status >= 400 && status < 500) {
          return false;
        }
      }
      // Retry network errors up to 2 times
      return failureCount < 2;
    }
  });
};

/**
 * Invalidates calendar events cache for specific practitioners and date range
 * Uses precise date range overlap checking for granular invalidation
 */
export const invalidateCalendarEventsForAppointment = (
  queryClient: QueryClient,
  activeClinicId: number | null | undefined,
  practitionerId: number | null | undefined,
  appointmentDate: string,
  view: CalendarView = 'day'
) => {
  if (!activeClinicId || !practitionerId) return;

  // Create stable practitioner key for single practitioner
  const practitionersKey = createStableArrayKey([practitionerId]);

  // Get the date range that this appointment falls into for the given view
  const { dateRangeKey } = getDateRange(new Date(appointmentDate), view);

  // Invalidate only queries that include this practitioner and overlap with the appointment date
  queryClient.invalidateQueries({
    queryKey: ['calendar-events', activeClinicId],
    predicate: (query) => {
      const [, , params] = query.queryKey as [string, number, any];
      if (!params) return false;

      // Check if this query includes the practitioner
      const queryPractitioners = params.practitioners || '';
      if (!queryPractitioners.includes(practitionersKey)) return false;

      // Check if this query's date range overlaps with the appointment date
      const queryDateRange = params.dateRangeKey || '';
      if (!queryDateRange) return false;

      // Exact match - most common case
      if (queryDateRange === dateRangeKey) return true;

      // Check for overlap with range queries (week/month views)
      if (queryDateRange.includes('_')) {
        const [queryStart, queryEnd] = queryDateRange.split('_');
        return appointmentDate >= queryStart && appointmentDate <= queryEnd;
      }

      // Single date queries (day view) - should match exactly
      return queryDateRange === appointmentDate;
    }
  });
};