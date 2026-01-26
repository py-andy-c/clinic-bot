import { useQuery, QueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';
import { CalendarEvent, transformToCalendarEvents } from '../../utils/calendarDataAdapter';
import { CalendarView } from '../../types/calendar';
import moment from 'moment-timezone';
import { extractPractitionerAvailability, CalendarPractitionerAvailability } from '../../utils/practitionerAvailability';

const isDevelopment = import.meta.env.DEV;

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

const fetchCalendarEvents = async (params: UseCalendarEventsParams & { currentUserId?: number }): Promise<{
  events: CalendarEvent[];
  practitionerAvailability: CalendarPractitionerAvailability;
}> => {
  const { selectedPractitioners, selectedResources, currentDate, view, currentUserId } = params;
  const { startDate, endDate } = getDateRange(currentDate, view);

  // Always fetch availability for the current user if they exist,
  // plus any selected practitioners
  const practitionerIdsToFetch = Array.from(new Set([
    ...selectedPractitioners,
    ...(currentUserId ? [currentUserId] : [])
  ]));

  const [practitionerEvents, resourceEvents] = await Promise.all([
    practitionerIdsToFetch.length > 0
      ? apiService.getBatchCalendar({
        practitionerIds: practitionerIdsToFetch,
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

  // Extract practitioner availability from calendar results
  // This will include availability for current user even if they aren't in selectedPractitioners
  let practitionerAvailability: CalendarPractitionerAvailability = {};
  try {
    practitionerAvailability = extractPractitionerAvailability(practitionerEvents.results || []);
  } catch (error) {
    if (isDevelopment) console.error('Error extracting practitioner availability:', error);
    // Continue with empty availability - safer than crashing
    practitionerAvailability = {};
  }

  // Transform events - need to include date and practitioner_id from result level
  // Filter events to ONLY show those for selectedPractitioners to respect the sidebar filters
  const practitionerEventsRaw = practitionerEvents.results
    .filter(r => selectedPractitioners.includes(r.user_id))
    .flatMap(r =>
      r.events.map(event => ({ ...event, date: r.date, practitioner_id: r.user_id }))
    );

  const resourceEventsRaw = resourceEvents.results?.flatMap(r =>
    r.events.map(event => ({ ...event, date: r.date, resource_id: r.resource_id, is_resource_event: true }))
  ) || [];

  return {
    events: [
      ...transformToCalendarEvents(practitionerEventsRaw),
      ...transformToCalendarEvents(resourceEventsRaw)
    ],
    practitionerAvailability
  };
};

// Create stable, sorted keys for consistent query caching
const createStableArrayKey = (arr: number[]): string => {
  return [...arr].sort((a, b) => a - b).join(',');
};

// Store the last successful calendar data to prevent flickering
let lastSuccessfulCalendarData: { events: CalendarEvent[]; practitionerAvailability: CalendarPractitionerAvailability } | null = null;

export const useCalendarEvents = (params: UseCalendarEventsParams) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { selectedPractitioners, selectedResources, currentDate, view } = params;
  const { dateRangeKey } = getDateRange(currentDate, view);

  // Create stable keys for consistent caching regardless of array order
  const practitionersKey = createStableArrayKey(selectedPractitioners);
  const resourcesKey = createStableArrayKey(selectedResources);

  const query = useQuery({
    queryKey: ['calendar-events', activeClinicId, {
      practitioners: practitionersKey,
      resources: resourcesKey,
      dateRangeKey,
      view
    }],
    queryFn: () => fetchCalendarEvents({
      ...params,
      ...(user?.user_id ? { currentUserId: user.user_id } : {})
    }),
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

  // Store successful data to prevent flickering
  if (query.data && !query.isLoading && !query.isError) {
    lastSuccessfulCalendarData = query.data;
  }

  // Return last successful data if current query is loading and we have previous data
  const shouldShowLastData = query.isLoading && lastSuccessfulCalendarData && !query.data;

  return {
    ...query,
    data: shouldShowLastData ? lastSuccessfulCalendarData : query.data
  };
};

/**
 * Invalidates calendar events cache for specific practitioners and date range
 * Uses precise date range overlap checking for granular invalidation
 */
export const invalidateCalendarEventsForAppointment = (
  queryClient: QueryClient,
  activeClinicId: number | null | undefined
) => {
  // Defensive programming - ensure valid inputs
  if (!queryClient || !activeClinicId) {
    return;
  }

  try {
    // Invalidate ALL calendar events for this clinic - much simpler and more reliable
    queryClient.invalidateQueries({
      queryKey: ['calendar-events', activeClinicId]
    });
  } catch (error) {
    // Silent failure - cache invalidation errors shouldn't break the app
  }
};