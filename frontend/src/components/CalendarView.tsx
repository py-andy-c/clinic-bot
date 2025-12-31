import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { logger } from '../utils/logger';
import { LoadingSpinner, ErrorMessage } from './shared';
import { useModal } from '../contexts/ModalContext';
import { useAuth } from '../hooks/useAuth';
import { useApiData } from '../hooks/useApiData';
import { useIsMobile } from '../hooks/useIsMobile';
import { Calendar, momentLocalizer, View, Views } from 'react-big-calendar';
import moment from 'moment-timezone';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { apiService, sharedFetchFunctions } from '../services/api';
import { ApiCalendarEvent } from '../types';
import { getErrorMessage } from '../types/api';
import { 
  transformToCalendarEvents, 
  CalendarEvent,
  formatEventTimeRange
} from '../utils/calendarDataAdapter';
import { canEditAppointment, canDuplicateAppointment, getPractitionerIdForDuplicate } from '../utils/appointmentPermissions';
import { getPractitionerColor } from '../utils/practitionerColors';
import { getResourceColorById } from '../utils/resourceColorUtils';
import { CustomToolbar, CustomEventComponent, CustomDateHeader, CustomDayHeader, CustomWeekdayHeader, CustomWeekHeader } from './CalendarComponents';
import {
  EventModal,
  ExceptionModal,
  ConflictModal,
  CancellationNoteModal,
  CancellationPreviewModal,
  DeleteConfirmationModal,
  EditAppointmentModal,
  CreateAppointmentModal,
} from './calendar';
import type { ConflictAppointment } from './calendar/ConflictModal';
import {
  getDateString,
  formatAppointmentTimeRange,
  getDateRange,
  formatTimeString,
  getScrollToTime,
  getWeekdayNames,
} from '../utils/calendarUtils';
import { calendarStorage } from '../utils/storage';
import { invalidateCacheForDate } from '../utils/availabilityCache';
import { invalidateResourceCacheForDate } from '../utils/resourceAvailabilityCache';

// Configure moment for Taiwan timezone
moment.locale('zh-tw');
const localizer = momentLocalizer(moment);

// Set default timezone for moment
moment.tz.setDefault('Asia/Taipei');

interface CalendarViewProps {
  userId: number;
  additionalPractitionerIds?: number[];
  practitioners?: { id: number; full_name: string }[]; // Practitioner names for display
  resourceIds?: number[]; // Resource IDs to display calendars for
  resources?: { id: number; name: string }[]; // Resource names for display
  onSelectEvent?: (event: CalendarEvent) => void;
  onNavigate?: (date: Date) => void;
  onAddExceptionHandlerReady?: (handler: () => void, view: View) => void;
  onCreateAppointment?: (patientId?: number) => void; // Callback to open create appointment modal
  preSelectedPatientId?: number; // Pre-selected patient ID from query parameter
}

const CalendarView: React.FC<CalendarViewProps> = ({ 
  userId, 
  additionalPractitionerIds = [],
  practitioners = [],
  resourceIds = [],
  resources = [],
  onSelectEvent, 
  onNavigate,
  onAddExceptionHandlerReady,
  preSelectedPatientId
}) => {
  const { alert } = useModal();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<View>(Views.DAY);
  const [allEvents, setAllEvents] = useState<ApiCalendarEvent[]>([]);
  // Default schedule was removed - no longer needed (availability background events were removed)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track if we've loaded persisted state to avoid overwriting with defaults
  const hasLoadedPersistedStateRef = useRef(false);
  // Cache batch calendar data to avoid redundant API calls when navigating between dates
  // Key: `${practitionerIds.join(',')}-${startDate}-${endDate}`
  const cachedCalendarDataRef = useRef<Map<string, { data: ApiCalendarEvent[]; timestamp: number }>>(new Map());
  // Track in-flight batch calendar requests to prevent duplicate concurrent requests
  const inFlightBatchRequestsRef = useRef<Map<string, Promise<{ data: ApiCalendarEvent[]; timestamp: number }>>>(new Map());
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  // Counter for cache cleanup - increments on each fetch to enable deterministic cleanup
  const cacheCleanupCounterRef = useRef(0);

  // Helper to invalidate cache for a specific date range
  const invalidateCacheForDateRange = useCallback((startDate: string, endDate: string) => {
    // Helper function to extract dates from cache key
    // Cache key format: "practitionerIds-startDate-endDate"
    // Example: "1,2-2024-01-15-2024-01-15"
    const extractDates = (key: string): { startDate: string; endDate: string } | null => {
      // Extract dates using regex to find YYYY-MM-DD patterns
      const datePattern = /\d{4}-\d{2}-\d{2}/g;
      const dates = key.match(datePattern);
      
      if (dates && dates.length >= 2) {
        const cacheStartDate = dates[dates.length - 2];
        const cacheEndDate = dates[dates.length - 1];
        if (cacheStartDate && cacheEndDate) {
          return {
            startDate: cacheStartDate,
            endDate: cacheEndDate
          };
        }
      }
      return null;
    };

    const keysToDelete: string[] = [];
    
    // Invalidate cached data
    for (const key of cachedCalendarDataRef.current.keys()) {
      const dates = extractDates(key);
      if (dates && dates.startDate <= endDate && dates.endDate >= startDate) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => cachedCalendarDataRef.current.delete(key));
    
    // CRITICAL: Also invalidate in-flight requests for the same date range
    // This prevents stale in-flight requests from completing and updating the UI
    const inFlightKeysToDelete: string[] = [];
    for (const key of inFlightBatchRequestsRef.current.keys()) {
      const dates = extractDates(key);
      if (dates && dates.startDate <= endDate && dates.endDate >= startDate) {
        inFlightKeysToDelete.push(key);
      }
    }
    inFlightKeysToDelete.forEach(key => inFlightBatchRequestsRef.current.delete(key));
  }, []);
  const [modalState, setModalState] = useState<{
    type: 'event' | 'exception' | 'conflict' | 'delete_confirmation' | 'cancellation_note' | 'cancellation_preview' | 'edit_appointment' | 'create_appointment' | null;
    data: CalendarEvent | ConflictAppointment[] | null;
  }>({ type: null, data: null });
  const [createModalKey, setCreateModalKey] = useState(0);
  const [exceptionData, setExceptionData] = useState({
    date: '',
    startTime: '',
    endTime: ''
  });
  const [cancellationNote, setCancellationNote] = useState('');
  const [cancellationPreviewMessage, setCancellationPreviewMessage] = useState('');
  const [cancellationPreviewLoading, setCancellationPreviewLoading] = useState(false);
  const [editErrorMessage, setEditErrorMessage] = useState<string | null>(null);
  const [isFullDay, setIsFullDay] = useState(false);
  const scrollYRef = useRef(0);
  const calendarContainerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  
  // Swipe gesture detection
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchStartTimeRef = useRef<number | null>(null);
  const SWIPE_THRESHOLD = 50; // Minimum distance for swipe
  const SWIPE_VELOCITY_THRESHOLD = 0.3; // Minimum velocity for swipe (px/ms)
  // Ref for resize timeout - must be at component level to persist across renders
  // but be accessible in useEffect cleanup. If declared inside useEffect, it would
  // be recreated on every render, defeating the purpose of using a ref.
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get current user for role checking
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const isAdmin = user?.roles?.includes('admin') ?? false;

  // Load persisted calendar state on mount (view and date)
  useEffect(() => {
    if (!user?.user_id || !user?.active_clinic_id || hasLoadedPersistedStateRef.current) {
      return;
    }

    const persistedState = calendarStorage.getCalendarState(user.user_id, user.active_clinic_id);
    if (persistedState) {
      // Load view mode
      if (persistedState.view === 'month' || persistedState.view === 'week' || persistedState.view === 'day') {
        const viewMap: Record<string, View> = {
          month: Views.MONTH,
          week: Views.WEEK,
          day: Views.DAY,
        };
        setView(viewMap[persistedState.view] || Views.DAY);
      }

      // Load current date
      if (persistedState.currentDate) {
        try {
          const parsedDate = new Date(persistedState.currentDate);
          if (!isNaN(parsedDate.getTime())) {
            setCurrentDate(parsedDate);
          }
        } catch (error) {
          logger.warn('Failed to parse persisted date:', error);
        }
      }
    }
    
    hasLoadedPersistedStateRef.current = true;
  }, [user?.user_id, user?.active_clinic_id]);

  // Persist view and date whenever they change (after initial load)
  // Only update the fields that changed to avoid unnecessary storage reads
  useEffect(() => {
    if (!user?.user_id || !user?.active_clinic_id || !hasLoadedPersistedStateRef.current) {
      return;
    }

    const viewString: 'month' | 'week' | 'day' = view === Views.MONTH ? 'month' : view === Views.WEEK ? 'week' : 'day';
    const dateString = getDateString(currentDate);

    // Only read from storage if we need practitioner data, otherwise construct minimal state
    // This avoids reading storage on every view/date change
    const currentState = calendarStorage.getCalendarState(user.user_id, user.active_clinic_id);
    const updatedState = {
      view: viewString,
      currentDate: dateString,
      additionalPractitionerIds: currentState?.additionalPractitionerIds || [],
      defaultPractitionerId: currentState?.defaultPractitionerId || null,
    };
    
    calendarStorage.setCalendarState(user.user_id, user.active_clinic_id, updatedState);
  }, [user?.user_id, user?.active_clinic_id, view, currentDate]);

  const fetchClinicSettingsFn = sharedFetchFunctions.getClinicSettings;

  // Use practitioners from props (passed from AvailabilityPage) to avoid duplicate API calls
  // Fallback to empty array if prop is not provided (for other use cases)
  const availablePractitioners = practitioners || [];

  // Lazy-load clinic settings - only fetch when modals are opened
  // This reduces initial page load since settings are only needed for create/edit modals
  const [shouldFetchSettings, setShouldFetchSettings] = useState(false);
  const { data: clinicSettingsData } = useApiData(
    fetchClinicSettingsFn,
    {
      enabled: !authLoading && isAuthenticated && shouldFetchSettings,
      dependencies: [authLoading, isAuthenticated, shouldFetchSettings, user?.active_clinic_id],
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );

  const appointmentTypes = clinicSettingsData?.appointment_types || [];

  // Trigger settings fetch when modals that need it are opened
  useEffect(() => {
    if (modalState.type === 'create_appointment' || modalState.type === 'edit_appointment' || modalState.type === 'event') {
      setShouldFetchSettings(true);
    }
  }, [modalState.type]);

  // Helper function to check if user can edit an event
  // Uses shared utility for appointments, handles other event types
  const canEditEvent = useCallback((event: CalendarEvent | null): boolean => {
    if (!event) return false;
    // Use shared utility for appointments
    if (event.resource.type === 'appointment') {
      return canEditAppointment(event, userId, isAdmin);
    }
    // For other events, check if it's their own event
    const eventPractitionerId = event.resource.practitioner_id || userId;
    return eventPractitionerId === userId;
  }, [userId, isAdmin]);

  // Lock body scroll when modal is open (prevents background scrolling on mobile)
  useEffect(() => {
    const wasModalOpen = modalState.type !== null;

    if (wasModalOpen) {
      // Save current scroll position using ref to avoid closure issues
      scrollYRef.current = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollYRef.current}px`;
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
    }

    return () => {
      if (wasModalOpen) {
        // Restore scroll position
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollYRef.current);
      }
    };
  }, [modalState.type]);



  // Transform events for React Big Calendar
  const calendarEvents = useMemo(() => {
    const events = [...allEvents];
    
    // Availability background events removed - no longer showing default schedule as gray boxes
    // Only allEvents is needed for transformation
    
    return transformToCalendarEvents(events);
  }, [allEvents]); // Removed unused dependencies: defaultSchedule, currentDate, view

  // Helper function to check if event has changed
  const hasEventChanged = useCallback((current: CalendarEvent, updated: CalendarEvent): boolean => {
    if (current.title !== updated.title) return true;
    const currentNotes = current.resource.clinic_notes || '';
    const updatedNotes = updated.resource?.clinic_notes || '';
    if (currentNotes !== updatedNotes) return true;
    
    // Check receipt-related fields
    const currentHasActiveReceipt = current.resource.has_active_receipt || false;
    const updatedHasActiveReceipt = updated.resource?.has_active_receipt || false;
    if (currentHasActiveReceipt !== updatedHasActiveReceipt) return true;
    
    const currentHasAnyReceipt = current.resource.has_any_receipt || false;
    const updatedHasAnyReceipt = updated.resource?.has_any_receipt || false;
    if (currentHasAnyReceipt !== updatedHasAnyReceipt) return true;
    
    // Check receipt_ids array
    const currentReceiptIds = current.resource.receipt_ids || [];
    const updatedReceiptIds = updated.resource?.receipt_ids || [];
    if (currentReceiptIds.length !== updatedReceiptIds.length) return true;
    if (currentReceiptIds.some((id, idx) => id !== updatedReceiptIds[idx])) return true;
    
    return false;
  }, []);

  // Sync modalState with updated calendar events after refresh
  useEffect(() => {
    if (modalState.type === 'event' && modalState.data?.resource?.calendar_event_id) {
      const eventId = modalState.data.resource.calendar_event_id;
      const updatedEvent = calendarEvents.find(
        e => e.resource?.calendar_event_id === eventId
      );
      if (updatedEvent && hasEventChanged(modalState.data, updatedEvent)) {
        setModalState(prev => ({ ...prev, data: updatedEvent }));
      }
    }
  }, [calendarEvents, modalState.type, modalState.data?.resource?.calendar_event_id, hasEventChanged]); // Sync when calendarEvents updates (after refresh)

  // Sync column widths between header and event columns for proper alignment in week view
  // This must be after calendarEvents is declared
  useEffect(() => {
    if (view !== Views.WEEK) return;

    // Constants for width syncing timing
    const SYNC_DELAY_MS = 100; // Delay for delayed layout calculations (especially on mobile)
    const RESIZE_DEBOUNCE_MS = 50; // Debounce timeout for resize events

    /**
     * Synchronizes column widths between the time header and time content tables
     * in week view to ensure perfect alignment.
     * 
     * This function:
     * 1. Syncs the time gutter width
     * 2. Syncs each day column width
     * 3. Calculates total width from actual column widths (to avoid rounding issues)
     * 4. Sets both tables to the exact same total width
     */
    const syncColumnWidths = () => {
      try {
        if (!calendarContainerRef.current) return;

        const timeContent = calendarContainerRef.current.querySelector('.rbc-time-content') as HTMLElement;
        if (!timeContent) return;

        // Get all day slots (event columns)
        const daySlots = Array.from(
          calendarContainerRef.current.querySelectorAll('.rbc-time-content > .rbc-day-slot')
        ) as HTMLElement[];
        
        // Get all headers
        const headers = Array.from(
          calendarContainerRef.current.querySelectorAll('.rbc-time-header .rbc-header')
        ) as HTMLElement[];
        
        // Get all day backgrounds (all-day row)
        const dayBgs = Array.from(
          calendarContainerRef.current.querySelectorAll('.rbc-allday-cell .rbc-day-bg')
        ) as HTMLElement[];
        
        // Sync time gutter first - this is critical for left edge alignment
        const timeGutter = calendarContainerRef.current.querySelector('.rbc-time-content > .rbc-time-gutter') as HTMLElement;
        const headerGutter = calendarContainerRef.current.querySelector('.rbc-time-header .rbc-time-header-gutter') as HTMLElement;
        
        if (timeGutter && headerGutter) {
          // Use offsetWidth to include borders in the calculation
          const timeGutterWidth = timeGutter.offsetWidth;
          if (timeGutterWidth > 0) {
            headerGutter.style.setProperty('width', `${timeGutterWidth}px`, 'important');
            headerGutter.style.setProperty('min-width', `${timeGutterWidth}px`, 'important');
            headerGutter.style.setProperty('max-width', `${timeGutterWidth}px`, 'important');
          }
        }
        
        // Sync each day column width
        if (daySlots.length === headers.length) {
          daySlots.forEach((daySlot, index) => {
            const header = headers[index];
            const dayBg = dayBgs[index];
            
            // Use offsetWidth to include borders in the calculation
            // This ensures the total width (including borders) matches
            const slotWidth = daySlot.offsetWidth;
            
            if (slotWidth > 0 && header) {
              header.style.setProperty('width', `${slotWidth}px`, 'important');
              header.style.setProperty('min-width', `${slotWidth}px`, 'important');
              header.style.setProperty('max-width', `${slotWidth}px`, 'important');
              header.style.setProperty('flex', '0 0 auto', 'important');
            }
            
            if (slotWidth > 0 && dayBg) {
              dayBg.style.setProperty('width', `${slotWidth}px`, 'important');
              dayBg.style.setProperty('min-width', `${slotWidth}px`, 'important');
              dayBg.style.setProperty('max-width', `${slotWidth}px`, 'important');
              dayBg.style.setProperty('flex', '0 0 auto', 'important');
            }
          });
        }
        
        // Calculate total width from actual column widths to avoid rounding issues
        // This ensures both tables have exactly the same total width
        let totalContentWidth = 0;
        if (timeGutter) {
          totalContentWidth += timeGutter.offsetWidth;
        }
        daySlots.forEach(slot => {
          totalContentWidth += slot.offsetWidth;
        });
        
        // Set both tables to the exact same total width
        const timeHeader = calendarContainerRef.current.querySelector('.rbc-time-header') as HTMLElement;
        if (timeHeader && timeContent && totalContentWidth > 0) {
          // Use the calculated total width to ensure exact match
          timeHeader.style.setProperty('width', `${totalContentWidth}px`, 'important');
          timeContent.style.setProperty('width', `${totalContentWidth}px`, 'important');
        }
      } catch (error) {
        logger.error('Error syncing column widths:', error);
        // Don't throw - allow calendar to continue functioning even if sync fails
      }
    };

    // Use double requestAnimationFrame to ensure DOM is ready
    // First frame: browser completes style recalculation
    // Second frame: browser completes layout recalculation (critical for accurate width measurements)
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        syncColumnWidths();
        // Additional sync for delayed layout calculations (especially on mobile)
        // Some browsers/devices need extra time for sub-pixel rendering and font loading
        // This ensures alignment is correct even after all async layout work completes
        setTimeout(syncColumnWidths, SYNC_DELAY_MS);
      });
    });
    
    // Debounce function to avoid excessive syncing during rapid resizes
    const debouncedSync = () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(() => {
        // Clear fixed widths to let browser recalculate natural widths based on new container size
        const timeHeader = calendarContainerRef.current?.querySelector('.rbc-time-header') as HTMLElement;
        const timeContent = calendarContainerRef.current?.querySelector('.rbc-time-content') as HTMLElement;
        const headers = Array.from(
          calendarContainerRef.current?.querySelectorAll('.rbc-time-header .rbc-header') || []
        ) as HTMLElement[];
        const headerGutter = calendarContainerRef.current?.querySelector('.rbc-time-header .rbc-time-header-gutter') as HTMLElement;
        
        if (timeHeader) timeHeader.style.removeProperty('width');
        if (timeContent) timeContent.style.removeProperty('width');
        headers.forEach(h => {
          h.style.removeProperty('width');
          h.style.removeProperty('min-width');
          h.style.removeProperty('max-width');
        });
        if (headerGutter) {
          headerGutter.style.removeProperty('width');
          headerGutter.style.removeProperty('min-width');
          headerGutter.style.removeProperty('max-width');
        }
        
        // Wait for browser to recalculate layout, then sync
        // Double RAF ensures layout is complete after clearing widths
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            syncColumnWidths();
          });
        });
      }, RESIZE_DEBOUNCE_MS);
    };
    
    const resizeObserver = new ResizeObserver(debouncedSync);
    
    // Observe both the container and the time-view for more reliable resize detection
    if (calendarContainerRef.current) {
      resizeObserver.observe(calendarContainerRef.current);
      
      // Also observe the time-view directly if it exists
      const timeViewElement = calendarContainerRef.current.querySelector('.rbc-time-view') as HTMLElement;
      if (timeViewElement) {
        resizeObserver.observe(timeViewElement);
      }
    }
    
    // Also listen to window resize events (for cases where ResizeObserver might miss changes)
    window.addEventListener('resize', debouncedSync);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', debouncedSync);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [view, currentDate, calendarEvents.length]);

  // Reusable function to scroll week view to 9 AM
  const scrollWeekViewTo9AM = useCallback(() => {
    if (view !== Views.WEEK || !calendarContainerRef.current) return;

    const SCROLL_DELAY_MS = 300; // Delay to ensure calendar is fully rendered
    const MAX_RETRIES = 10; // Maximum retries to find 9 AM slot
    const RETRY_DELAY_MS = 100; // Delay between retries
    const HOURS_TO_9AM = 9;
    const ESTIMATED_SLOT_HEIGHT_PX = 120; // pixels per hour (doubled from 60)

    let retryCount = 0;

    const scrollTo9AM = (): boolean => {
      if (!calendarContainerRef.current) return false;

      const timeView = calendarContainerRef.current.querySelector('.rbc-time-view') as HTMLElement;
      if (!timeView) return false;

      const timeGutter = timeView.querySelector('.rbc-time-gutter');
      if (!timeGutter) return false;

      // Check if time slots are actually rendered (not just empty container)
      const timeLabels = timeGutter.querySelectorAll('.rbc-label');
      if (timeLabels.length === 0) {
        // Calendar not ready yet, retry
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          setTimeout(scrollTo9AM, RETRY_DELAY_MS);
          return false;
        }
        // Retries exhausted - will use estimated position below
        // (targetSlot will be null, triggering fallback calculation)
      }

      // Get header height once (used in both branches)
      const header = timeView.querySelector('.rbc-time-header') as HTMLElement;
      const headerHeight = header?.getBoundingClientRect().height || 0;

      // Find 9 AM time slot label
      let targetSlot: HTMLElement | null = null;

      for (const label of timeLabels) {
        const text = label.textContent?.trim() || '';
        if (text === '9 AM' || text === '9:00 AM') {
          targetSlot = label.closest('.rbc-timeslot-group') as HTMLElement;
          if (targetSlot) break;
        }
      }

      // Calculate scroll position
      let scrollPosition: number;
      if (targetSlot) {
        // Use actual slot position
        const timeViewRect = timeView.getBoundingClientRect();
        const slotRect = targetSlot.getBoundingClientRect();
        scrollPosition = slotRect.top - timeViewRect.top + timeView.scrollTop - headerHeight;
      } else {
        // Fallback: estimate position (9 hours * slot height)
        scrollPosition = HOURS_TO_9AM * ESTIMATED_SLOT_HEIGHT_PX - headerHeight;
      }

      // Perform scroll with error handling
      try {
        timeView.scrollTop = scrollPosition;
        return true;
      } catch (error) {
        logger.warn('Failed to scroll to 9 AM:', error);
        return false;
      }
    };

    // Use double RAF to ensure DOM is ready, then wait for calendar to fully render
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Wait a bit longer to ensure React Big Calendar has finished its own scroll operations
        setTimeout(() => {
          scrollTo9AM();
        }, SCROLL_DELAY_MS);
      });
    });
  }, [view]);

  // Scroll week view to 9 AM on initial load (same as day view)
  // Wait for calendar to finish loading and be fully rendered before scrolling
  useEffect(() => {
    if (view !== Views.WEEK) return;
    // Don't scroll if still loading
    if (loading) return;
    
    // Wait for calendar to be ready - check for time slots being rendered
    const checkAndScroll = (): boolean => {
      if (!calendarContainerRef.current) return false;
      
      const timeView = calendarContainerRef.current.querySelector('.rbc-time-view') as HTMLElement;
      if (!timeView) return false;
      
      // Check if time slots are actually rendered (not just empty container)
      const timeGutter = timeView.querySelector('.rbc-time-gutter');
      if (!timeGutter) return false;
      
      const timeLabels = timeGutter.querySelectorAll('.rbc-label');
      // If time slots are rendered, calendar is ready
      if (timeLabels.length > 0) {
        scrollWeekViewTo9AM();
        return true;
      }
      
      return false;
    };
    
    // Try immediately first (in case calendar is already rendered)
    if (checkAndScroll()) {
      return;
    }
    
    // If not ready, wait for next paint then retry with a small delay
    let rafId: number;
    let timeoutId: NodeJS.Timeout;
    
    rafId = requestAnimationFrame(() => {
      // Use double RAF to ensure layout is complete
      rafId = requestAnimationFrame(() => {
        if (checkAndScroll()) {
          return;
        }
        // If still not ready, retry after a short delay
        timeoutId = setTimeout(() => {
          checkAndScroll();
        }, 50);
      });
    });
    
    return () => {
      cancelAnimationFrame(rafId);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [view, currentDate, scrollWeekViewTo9AM, loading]);

  // isMobile is already declared above

  // Set scroll position to 9 AM for day view (week view uses manual scrolling in useEffect above)
  const scrollToTime = useMemo(() => getScrollToTime(currentDate), [currentDate]);

  // Create practitioner lookup map for O(1) access instead of O(n) find()
  const practitionerMap = useMemo(() => {
    const map = new Map<number, string>();
    availablePractitioners.forEach(p => {
      map.set(p.id, p.full_name);
    });
    return map;
  }, [availablePractitioners]);

  // Fetch all events for the visible date range using batch endpoint
  // Memoize fetchCalendarData to prevent unnecessary re-renders and enable proper dependency tracking
  const fetchCalendarData = useCallback(async (forceRefresh: boolean = false, silent: boolean = false) => {
    if (!userId) return;
    
    // Don't fetch if clinic ID is not available (e.g., during clinic switch)
    if (!user?.active_clinic_id) {
      setAllEvents([]);
      setError(null);
      if (!silent) {
        setLoading(false);
      }
      return;
    }

    // Determine the view type for date range calculation
    const viewType = view === Views.MONTH ? 'month' : view === Views.WEEK ? 'week' : 'day';
    const { start, end } = getDateRange(currentDate, viewType);
    
    // Collect all practitioner IDs to fetch (primary + additional)
    const allPractitionerIds = [userId, ...additionalPractitionerIds].sort((a, b) => a - b); // Sort for consistent cache key

    // Use batch endpoint to fetch all data in a single call
    const startDateStr = moment(start).format('YYYY-MM-DD');
    const endDateStr = moment(end).format('YYYY-MM-DD');
    
    // Create cache key - include clinic ID and resource IDs to prevent stale data when switching clinics/resources
    const clinicId = user.active_clinic_id;
    const sortedResourceIds = [...resourceIds].sort((a, b) => a - b);
    const resourceKey = sortedResourceIds.length > 0 ? `-resources-${sortedResourceIds.join(',')}` : '';
    const cacheKey = `${clinicId}-${allPractitionerIds.join(',')}${resourceKey}-${startDateStr}-${endDateStr}`;
    
    // If force refresh, clear both caches for this specific key
    if (forceRefresh) {
      cachedCalendarDataRef.current.delete(cacheKey);
      inFlightBatchRequestsRef.current.delete(cacheKey);
    }
    
    // Check cache first (unless forced refresh)
    if (!forceRefresh) {
      const cached = cachedCalendarDataRef.current.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        // Use cached data - no API call needed
        setAllEvents(cached.data);
        setError(null);
        return;
      }

      // Check if there's already an in-flight request for this cache key
      // This prevents duplicate concurrent requests (e.g., from React StrictMode)
      if (inFlightBatchRequestsRef.current.has(cacheKey)) {
        try {
          const batchData = await inFlightBatchRequestsRef.current.get(cacheKey)!;
          // Process the result from the in-flight request
          const events: ApiCalendarEvent[] = [];
          for (const result of batchData.results) {
            const practitionerId = result.user_id;
            const dateStr = result.date;
            // Use practitionerMap for O(1) lookup instead of O(n) find()
            const practitionerName = practitionerMap.get(practitionerId) || '';
            const transformedEvents = result.events.map((event: ApiCalendarEvent) => ({
              ...event,
              date: dateStr,
              practitioner_id: practitionerId,
              practitioner_name: practitionerName,
              is_primary: practitionerId === userId
            }));
            events.push(...transformedEvents);
          }
          setAllEvents(events);
          setError(null);
          return;
        } catch (err) {
          // If the in-flight request failed, continue to make a new request
          inFlightBatchRequestsRef.current.delete(cacheKey);
        }
      }
    }

    // Data not in cache or expired - fetch it
    try {
      // Only show loading state if not silent
      if (!silent) {
        setLoading(true);
      }
      setError(null);

      // Fetch both practitioner and resource calendars in parallel
      const practitionerPromise = apiService.getBatchCalendar({
        practitionerIds: allPractitionerIds,
        startDate: startDateStr,
        endDate: endDateStr,
      });
      
      // Fetch resource calendar if resources are selected
      const resourcePromise = resourceIds.length > 0
        ? apiService.getBatchResourceCalendar({
            resourceIds: sortedResourceIds,
            startDate: startDateStr,
            endDate: endDateStr,
          })
        : Promise.resolve(null);

      // Store practitioner promise for cache deduplication
      inFlightBatchRequestsRef.current.set(cacheKey, practitionerPromise);

      // Wait for both fetches to complete
      const [batchData, resourceBatchData] = await Promise.all([
        practitionerPromise,
        resourcePromise,
      ]);

      // Transform batch response to flat events array
      const events: ApiCalendarEvent[] = [];
      
      // Process practitioner events
      for (const result of batchData.results) {
        const practitionerId = result.user_id;
        const dateStr = result.date;
        
        // Use practitionerMap for O(1) lookup instead of O(n) find()
        const practitionerName = practitionerMap.get(practitionerId) || '';
        
        // Add date and practitioner ID to each event for proper display and color-coding
        const transformedEvents = result.events.map((event: ApiCalendarEvent) => ({
          ...event,
          date: dateStr,
          practitioner_id: practitionerId, // Add practitioner ID for color-coding
          practitioner_name: practitionerName, // Add practitioner name for display
          is_primary: practitionerId === userId, // Mark primary practitioner's events
          is_resource_event: false, // Mark as practitioner event
        }));
        
        events.push(...transformedEvents);
      }

      // Process resource events
      if (resourceBatchData && resourceBatchData.results) {
        // Create resource name map for O(1) lookup
        const resourceMap = new Map<number, string>();
        resources.forEach(r => resourceMap.set(r.id, r.name));
        
        for (const result of resourceBatchData.results) {
          const resourceId = result.resource_id;
          const dateStr = result.date;
          const resourceName = resourceMap.get(resourceId) || '';
          
          // Transform resource events and mark them as resource events
          const transformedEvents = result.events.map((event: ApiCalendarEvent) => ({
            ...event,
            date: dateStr,
            resource_id: resourceId, // Add resource ID for color-coding
            resource_name: resourceName, // Add resource name for display
            is_resource_event: true, // Mark as resource event for visual distinction
          }));
          
          events.push(...transformedEvents);
        }
      }

      // Combined events: practitioner events + resource events
      // Resource events will be displayed separately with unique keys
      // Practitioner events already have resource info from the backend
      const allEvents = [...events];

      // Cache the data
      cachedCalendarDataRef.current.set(cacheKey, {
        data: allEvents,
        timestamp: Date.now()
      });

      // Clean up old cache entries (older than TTL) - only run cleanup occasionally to avoid performance impact
      // Clean up every 10th request or if cache size exceeds 50 entries
      cacheCleanupCounterRef.current += 1;
      const cacheSize = cachedCalendarDataRef.current.size;
      if (cacheSize > 50 || cacheCleanupCounterRef.current % 10 === 0) {
        const now = Date.now();
        for (const [key, value] of cachedCalendarDataRef.current.entries()) {
          if (now - value.timestamp >= CACHE_TTL) {
            cachedCalendarDataRef.current.delete(key);
          }
        }
      }

      // Remove from in-flight requests
      inFlightBatchRequestsRef.current.delete(cacheKey);

      setAllEvents(allEvents);

    } catch (err: unknown) {
      // Remove from in-flight requests on error
      inFlightBatchRequestsRef.current.delete(cacheKey);
      
      // Handle 404 errors gracefully - these can occur when switching clinics
      // with stale practitioner/resource IDs that don't exist in the new clinic
      if (err?.response?.status === 404) {
        // Clear events and silently continue - the next fetch with correct IDs will succeed
        setAllEvents([]);
        setError(null);
        logger.log('Calendar fetch returned 404 (likely clinic switch with stale IDs), clearing events');
      } else {
        // For other errors, show error message
        if (!silent) {
          setError('無法載入月曆資料');
        }
        logger.error('Fetch calendar data error:', err);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [userId, additionalPractitionerIds, resourceIds, resources, currentDate, view, practitionerMap, user?.active_clinic_id]);

  // Invalidate cache when clinic or resources change to prevent stale data
  const previousClinicIdRef = useRef<number | null | undefined>(user?.active_clinic_id ?? null);
  const previousResourceIdsRef = useRef<string>('');
  useEffect(() => {
    const currentClinicId = user?.active_clinic_id;
    const currentResourceIdsStr = resourceIds.sort((a, b) => a - b).join(',');
    
    // If clinic changed (and we had a previous clinic), invalidate all cache
    if (previousClinicIdRef.current !== null && previousClinicIdRef.current !== undefined && 
        currentClinicId !== previousClinicIdRef.current) {
      // Clear all cached calendar data
      cachedCalendarDataRef.current.clear();
      // Clear all in-flight requests
      inFlightBatchRequestsRef.current.clear();
      // Clear events immediately to avoid showing stale data from previous clinic
      setAllEvents([]);
      logger.log('Clinic changed, invalidated calendar cache', { 
        from: previousClinicIdRef.current, 
        to: currentClinicId 
      });
    } else if (previousResourceIdsRef.current !== currentResourceIdsStr) {
      // Resource selection changed - clear cache to refetch with new resources
      cachedCalendarDataRef.current.clear();
      inFlightBatchRequestsRef.current.clear();
      logger.log('Resource selection changed, invalidated calendar cache', {
        from: previousResourceIdsRef.current,
        to: currentResourceIdsStr
      });
    }
    
    // Update refs to track current state
    previousClinicIdRef.current = currentClinicId ?? null;
    previousResourceIdsRef.current = currentResourceIdsStr;
  }, [user?.active_clinic_id, resourceIds]);

  // Fetch calendar data when date/view/practitioners/clinic change
  useEffect(() => {
    fetchCalendarData();
  }, [fetchCalendarData]);


  // Event styling based on document requirements and practitioner
  const eventStyleGetter = useCallback((event: CalendarEvent) => {
    // Style checked-out appointments differently (with opacity or border)
    const isCheckedOut = event.resource.has_active_receipt === true;
    
    // Check if this is a resource event
    const isResourceEvent = event.resource.is_resource_event === true;
    
    let style: React.CSSProperties = {
      borderRadius: '6px',
      color: 'white',
      border: 'none',
      display: 'block'
    };

    // Handle resource events with visual distinction (dashed border pattern)
    // Resources use the same color scheme as practitioners
    if (isResourceEvent && event.resource.resource_id) {
      const resourceId = event.resource.resource_id;
      const allPractitionerIds = [userId, ...additionalPractitionerIds];

      // Calculate color for resource using practitioner color scheme
      // Resources get colors after all practitioners
      const resourceColor = getResourceColorById(
        resourceId,
        allPractitionerIds,
        resourceIds,
        userId
      );
      
      // Use dashed border pattern to distinguish resource events from practitioner events
      style = {
        ...style,
        backgroundColor: resourceColor,
        border: '2px dashed rgba(255, 255, 255, 0.6)',
        opacity: isCheckedOut ? 0.7 : 1,
      };
      
      return { style };
    }
    
    // Handle practitioner events (existing logic)
    const practitionerId = event.resource.practitioner_id || userId;
    const isPrimary = practitionerId === userId;
    
    // Get color for this practitioner using shared utility
    const allPractitionerIds = [userId, ...additionalPractitionerIds];
    const practitionerColor = getPractitionerColor(practitionerId, userId, allPractitionerIds);

    // Style based on event type and practitioner
    if (event.resource.type === 'appointment') {
      const isAutoAssigned = event.resource.is_auto_assigned === true;
      
      if (isPrimary) {
        // Primary practitioner: blue
        style = {
          ...style,
          backgroundColor: '#3B82F6',
          opacity: 1
        };
      } else if (practitionerColor) {
        // Other practitioners: use assigned color
        style = {
          ...style,
          backgroundColor: practitionerColor,
          opacity: 0.9
        };
      } else {
        // Fallback: blue
        style = {
          ...style,
          backgroundColor: '#3B82F6',
          opacity: 1
        };
      }
      
      // Add dashed border for auto-assigned appointments
      if (isAutoAssigned) {
        style = {
          ...style,
          border: '2px dashed rgba(255, 255, 255, 0.8)'
        };
      }
      
      // Style checked-out appointments with reduced opacity and border
      if (isCheckedOut) {
        style = {
          ...style,
          opacity: style.opacity ? style.opacity * 0.7 : 0.7,
          border: style.border || '2px solid rgba(255, 255, 255, 0.5)',
          boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.3)'
        };
      }
    } else if (event.resource.type === 'availability_exception') {
      // Exceptions: light gray for primary, slightly different for others
      if (isPrimary) {
        style = {
          ...style,
          backgroundColor: '#E5E7EB',
          color: '#1F2937',
          opacity: 1
        };
      } else {
        style = {
          ...style,
          backgroundColor: '#D1D5DB',
          color: '#111827',
          opacity: 0.8
        };
      }
    }
    
    return { style };
  }, [userId, additionalPractitionerIds, resourceIds]);

  // Handle event selection
  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    setModalState({ type: 'event', data: event });
    if (onSelectEvent) {
      onSelectEvent(event);
    }
  }, [onSelectEvent]);

  // Handle slot selection - for monthly and weekly view navigation
  const handleSelectSlot = useCallback((slotInfo: { start: Date; end: Date; slots: Date[] }) => {
    // In monthly view, clicking a date should navigate to daily view of that date
    if (view === Views.MONTH) {
      setCurrentDate(slotInfo.start);
      setView(Views.DAY);
      if (onNavigate) {
        onNavigate(slotInfo.start);
      }
    } else if (view === Views.WEEK) {
      // In week view, clicking a time slot should navigate to day view of that date/time
      setCurrentDate(slotInfo.start);
      setView(Views.DAY);
      if (onNavigate) {
        onNavigate(slotInfo.start);
      }
    }
    // In daily view, clicking blank space does nothing
  }, [view, onNavigate]);

  // Create a dateHeader component that handles clicks on the date number to navigate to day view
  const DateHeaderWithClick = useCallback(({ date }: { date: Date }) => {
    const handleClick = () => {
      handleSelectSlot({
        start: date,
        end: moment(date).tz('Asia/Taipei').endOf('day').toDate(),
        slots: [date],
      });
    };
    
    return <CustomDateHeader date={date} onClick={handleClick} />;
  }, [handleSelectSlot]);

  // Handle navigation
  const handleNavigate = useCallback((date: Date) => {
    setCurrentDate(date);
    if (onNavigate) {
      onNavigate(date);
    }
  }, [onNavigate]);

  // Swipe gesture handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    touchStartTimeRef.current = Date.now();
  }, [isMobile]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isMobile || touchStartXRef.current === null || touchStartYRef.current === null || touchStartTimeRef.current === null) {
      return;
    }

    const touch = e.changedTouches[0];
    if (!touch) return;
    
    const deltaX = touch.clientX - touchStartXRef.current;
    const deltaY = touch.clientY - touchStartYRef.current;
    const deltaTime = Date.now() - touchStartTimeRef.current;
    const distance = Math.abs(deltaX);
    const velocity = distance / deltaTime;

    // Reset touch tracking
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    touchStartTimeRef.current = null;

    // Check if horizontal swipe is dominant (more horizontal than vertical)
    if (Math.abs(deltaX) < Math.abs(deltaY)) {
      return; // Vertical scroll, not a swipe
    }

    // Check if swipe meets threshold
    if (distance < SWIPE_THRESHOLD || velocity < SWIPE_VELOCITY_THRESHOLD) {
      return;
    }

    // Navigate based on swipe direction
    const unit = view === Views.MONTH ? 'month' : view === Views.WEEK ? 'week' : 'day';
    if (deltaX > 0) {
      // Swipe right - go to previous
      const newDate = moment(currentDate).subtract(1, unit).toDate();
      handleNavigate(newDate);
    } else {
      // Swipe left - go to next
      const newDate = moment(currentDate).add(1, unit).toDate();
      handleNavigate(newDate);
    }
  }, [isMobile, currentDate, view, handleNavigate]);


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
      await alert('請輸入日期、開始和結束時間');
      return;
    }

    const dateStr = exceptionData.date;
    
    try {
      // Conflict check - get the selected date's events and check for overlaps
      const dailyData = await apiService.getDailyCalendar(userId, dateStr);
      const appointments = dailyData.events.filter((event: CalendarEvent) => event.resource.type === 'appointment');
      
      // Collect all conflicting appointments
      const conflictingAppointments = appointments.filter((appointment: CalendarEvent) => {
        const startTime = appointment.start.toISOString();
        const endTime = appointment.end.toISOString();
        if (!startTime || !endTime) return false;
        return startTime < exceptionData.endTime && endTime > exceptionData.startTime;
      });

      if (conflictingAppointments.length > 0) {
        // Show conflict modal with list of conflicting appointments
        setModalState({ type: 'conflict', data: conflictingAppointments });
        return;
      }

      // Create exception (only for primary practitioner)
      await apiService.createAvailabilityException(userId, {
        date: dateStr,
        start_time: exceptionData.startTime,
        end_time: exceptionData.endTime
      });

      // Invalidate cache for this date
      invalidateCacheForDateRange(dateStr, dateStr);
      
      // Invalidate availability cache for this date (for all practitioners and appointment types)
      // Exceptions affect availability for all practitioners and appointment types
      invalidateCacheForDate(null, null, dateStr);

      // Refresh data (force refresh to ensure fresh data after mutation)
      await fetchCalendarData(true);
      setModalState({ type: null, data: null });
      setExceptionData({ date: '', startTime: '', endTime: '' });
      setIsFullDay(false);
      await alert('休診時段已建立');
    } catch (error) {
      logger.error('Error creating exception:', error);
      await alert('建立休診時段失敗，請稍後再試');
    }
  };


  // Show delete confirmation for appointments
  const handleDeleteAppointment = async () => {
    if (!modalState.data || !modalState.data.resource.appointment_id) return;
    
    if (!canEditEvent(modalState.data)) {
      await alert('您只能取消自己的預約');
      return;
    }
    
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
        appointment_time: formatAppointmentTimeRange(modalState.data.start, modalState.data.end),
        therapist_name: modalState.data.resource.practitioner_name,
        patient_name: modalState.data.resource.patient_name,
        ...(cancellationNote.trim() && { note: cancellationNote.trim() }),
      });

      setCancellationPreviewMessage(response.preview_message);
      setModalState({ type: 'cancellation_preview', data: modalState.data });
    } catch (error) {
      logger.error('Error generating cancellation preview:', error);
      await alert('無法產生預覽訊息，請稍後再試');
    } finally {
      setCancellationPreviewLoading(false);
    }
  };

  // Confirm and perform appointment deletion
  const handleConfirmDeleteAppointment = async () => {
    if (!modalState.data || !modalState.data.resource.appointment_id) return;

    if (!canEditEvent(modalState.data)) {
      await alert('您只能取消自己的預約');
      return;
    }

    try {
      await apiService.cancelClinicAppointment(modalState.data.resource.appointment_id, cancellationNote.trim() || undefined);

      // Invalidate cache for the appointment's date
      const appointmentDate = modalState.data.resource.date || getDateString(modalState.data.start);
      invalidateCacheForDateRange(appointmentDate, appointmentDate);
      
      // Invalidate availability cache for the appointment's date, practitioner, and appointment type
      const practitionerId = modalState.data.resource.practitioner_id;
      const appointmentTypeId = modalState.data.resource.appointment_type_id;
      if (practitionerId && appointmentTypeId) {
        invalidateCacheForDate(practitionerId, appointmentTypeId, appointmentDate);
        invalidateResourceCacheForDate(practitionerId, appointmentTypeId, appointmentDate);
      } else {
        // If IDs are missing, invalidate for all practitioners/types to be safe
        invalidateCacheForDate(null, null, appointmentDate);
        invalidateResourceCacheForDate(null, null, appointmentDate);
      }

      // Refresh data (force refresh to ensure fresh data after mutation)
      await fetchCalendarData(true);
      setModalState({ type: null, data: null });
      setCancellationNote('');
      setCancellationPreviewMessage('');
    } catch (error) {
      logger.error('Error deleting appointment:', error);
      await alert('取消預約失敗，請稍後再試');
    }
  };

  // Show delete confirmation for availability exceptions
  const handleDeleteException = async () => {
    if (!modalState.data || !modalState.data.resource.exception_id) return;
    
    if (!canEditEvent(modalState.data)) {
      await alert('您只能刪除自己的休診時段');
      return;
    }
    
    // Show confirmation modal instead of deleting directly
    setModalState({ type: 'delete_confirmation', data: modalState.data });
  };

  // Confirm and perform exception deletion
  const handleConfirmDeleteException = async () => {
    if (!modalState.data || !modalState.data.resource.exception_id) return;

    if (!canEditEvent(modalState.data)) {
      await alert('您只能刪除自己的休診時段');
      return;
    }

    try {
      await apiService.deleteAvailabilityException(userId, modalState.data.resource.exception_id);
      
      // Invalidate cache for the exception's date
      const exceptionDate = modalState.data.resource.date || getDateString(modalState.data.start);
      invalidateCacheForDateRange(exceptionDate, exceptionDate);
      
      // Invalidate availability cache for this date (for all practitioners and appointment types)
      // Exceptions affect availability for all practitioners and appointment types
      invalidateCacheForDate(null, null, exceptionDate);
      
      // Refresh data (force refresh to ensure fresh data after mutation)
      await fetchCalendarData(true);
      setModalState({ type: null, data: null });
    } catch (error) {
      logger.error('Error deleting availability exception:', error);
      await alert('刪除休診時段失敗，請稍後再試');
    }
  };

  // Handle edit appointment button click
  const handleEditAppointment = async () => {
    if (!modalState.data || !modalState.data.resource.appointment_id) return;
    
    if (!canEditEvent(modalState.data)) {
      await alert('您只能編輯自己的預約');
      return;
    }
    
    // Reset error and show edit modal
    setEditErrorMessage(null); // Clear any previous error
    setModalState({ type: 'edit_appointment', data: modalState.data });
  };

  // Handle duplicate appointment button click
  const handleDuplicateAppointment = useCallback(async () => {
    if (!modalState.data || !modalState.data.resource.appointment_id) return;
    
    const event = modalState.data;
    
    // Extract data from the original appointment
    const patientId = event.resource.patient_id;
    const appointmentTypeId = event.resource.appointment_type_id;
    // Use shared utility to get practitioner_id (hides for auto-assigned when not admin)
    const practitionerId = getPractitionerIdForDuplicate(event, isAdmin);
    const clinicNotes = event.resource.clinic_notes;
    
    // Extract date and time from event.start
    const startMoment = moment(event.start).tz('Asia/Taipei');
    const initialDate = startMoment.format('YYYY-MM-DD');
    const initialTime = startMoment.format('HH:mm');
    
    // Close event modal and open create appointment modal with pre-filled data
    // Resources will be fetched by useAppointmentForm in duplicate mode
    setCreateModalKey(prev => prev + 1); // Force remount to reset state
    setModalState({ 
      type: 'create_appointment', 
      data: { 
        patientId: patientId ?? null,
        initialDate,
        // Only include these if they have values (avoid passing undefined)
        ...(appointmentTypeId !== undefined && { preSelectedAppointmentTypeId: appointmentTypeId }),
        ...(practitionerId !== undefined && { preSelectedPractitionerId: practitionerId }),
        ...(initialTime && { preSelectedTime: initialTime }),
        ...(clinicNotes !== undefined && clinicNotes !== null && { preSelectedClinicNotes: clinicNotes }),
        event,
      } 
    });
  }, [modalState.data, isAdmin]);

  // Type definition for edit appointment form data
  type EditAppointmentFormData = {
    appointment_type_id?: number | null;
    practitioner_id: number | null;
    start_time: string;
    clinic_notes?: string;
    notification_note?: string;
    selected_resource_ids?: number[];
  };

  // Handle appointment edit confirmation (called from EditAppointmentModal)
  const handleConfirmEditAppointment = async (formData: EditAppointmentFormData) => {
    if (!modalState.data) return;

    if (!canEditEvent(modalState.data)) {
      // Show error in edit modal
      setEditErrorMessage('您只能編輯自己的預約');
      return;
    }

    try {
      await apiService.editClinicAppointment(
        modalState.data.resource.calendar_event_id,
        {
          ...(formData.appointment_type_id !== undefined ? { appointment_type_id: formData.appointment_type_id } : {}),
          practitioner_id: formData.practitioner_id,
          start_time: formData.start_time,
          ...(formData.clinic_notes !== undefined ? { clinic_notes: formData.clinic_notes } : {}),
          ...(formData.notification_note ? { notification_note: formData.notification_note } : {}),
          ...(formData.selected_resource_ids !== undefined ? { selected_resource_ids: formData.selected_resource_ids } : {}),
        }
      );

      // Invalidate cache for both old and new dates (in case appointment moved to different day)
      const oldDate = modalState.data.resource.date || getDateString(modalState.data.start);
      const newDate = moment(formData.start_time).format('YYYY-MM-DD'); // Extract date from ISO datetime string
      invalidateCacheForDateRange(oldDate, oldDate);
      if (newDate !== oldDate) {
        invalidateCacheForDateRange(newDate, newDate);
      }
      
      // Invalidate availability cache for both old and new dates
      // Use the practitioner_id and appointment_type_id from formData (new values) or modalState (old values)
      const practitionerId = formData.practitioner_id ?? modalState.data.resource.practitioner_id;
      const appointmentTypeId = formData.appointment_type_id ?? modalState.data.resource.appointment_type_id;
      if (practitionerId && appointmentTypeId) {
        invalidateCacheForDate(practitionerId, appointmentTypeId, oldDate);
        invalidateResourceCacheForDate(practitionerId, appointmentTypeId, oldDate);
        if (newDate !== oldDate) {
          invalidateCacheForDate(practitionerId, appointmentTypeId, newDate);
          invalidateResourceCacheForDate(practitionerId, appointmentTypeId, newDate);
        }
      }

      // Refresh data (force refresh to ensure fresh data after mutation)
      await fetchCalendarData(true);
      setModalState({ type: null, data: null });
      setEditErrorMessage(null);
      await alert('預約已更新');
    } catch (error) {
      logger.error('Error editing appointment:', error);
      // Extract error message from backend response
      const errorMessage = getErrorMessage(error);
      // Store error message - modal will display it
      setEditErrorMessage(errorMessage);
      throw error; // Re-throw so modal can handle it
    }
  };

  // Handle create appointment button click
  const handleCreateAppointment = useCallback((patientId?: number) => {
    setCreateModalKey(prev => prev + 1); // Force remount to reset state
    // Format current date as YYYY-MM-DD for initial date selection
    const currentDateString = getDateString(currentDate);
    // Use null to explicitly mean "no patient" (button click), undefined means "use prop" (URL-based)
    setModalState({ type: 'create_appointment', data: { patientId: patientId ?? null, initialDate: currentDateString } });
  }, [currentDate]);

  // Expose create appointment handler to parent
  useEffect(() => {
    // Store the handler so parent can call it
    window.__calendarCreateAppointment = handleCreateAppointment;
    return () => {
      delete window.__calendarCreateAppointment;
    };
  }, [handleCreateAppointment]);

  // Open create appointment modal if preSelectedPatientId is provided
  useEffect(() => {
    if (preSelectedPatientId && modalState.type === null) {
      handleCreateAppointment(preSelectedPatientId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preSelectedPatientId]);

  // Handle create appointment confirmation
  const handleConfirmCreateAppointment = async (formData: {
    patient_id: number;
    appointment_type_id: number;
    practitioner_id: number;
    start_time: string;
    clinic_notes?: string;
  }) => {
    try {
      await apiService.createClinicAppointment(formData);

      // Invalidate cache for the appointment's date
      const appointmentDate = moment(formData.start_time).format('YYYY-MM-DD'); // Extract date from ISO datetime string
      invalidateCacheForDateRange(appointmentDate, appointmentDate);
      
      // Invalidate availability cache for the appointment's date, practitioner, and appointment type
      invalidateCacheForDate(formData.practitioner_id, formData.appointment_type_id, appointmentDate);
      
      // Invalidate resource availability cache for the appointment's date, practitioner, and appointment type
      invalidateResourceCacheForDate(formData.practitioner_id, formData.appointment_type_id, appointmentDate);

      // Refresh data (force refresh to ensure fresh data after mutation)
      await fetchCalendarData(true);
      setModalState({ type: null, data: null });
      await alert('預約已建立');
      
      // Clear query parameter if it exists
      if (window.location.search.includes('createAppointment=')) {
        const url = new URL(window.location.href);
        url.searchParams.delete('createAppointment');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (error) {
      logger.error('Error creating appointment:', error);
      const errorMessage = getErrorMessage(error);
      throw new Error(errorMessage);
    }
  };

  // Event component - no longer needs view prop since CSS handles display
  const EventComponent = useCallback((props: { event: CalendarEvent }) => {
    return <CustomEventComponent event={props.event} />;
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRetry={fetchCalendarData}
      />
    );
  }

  return (
    <>
      {/* Calendar Component */}
      <div 
        ref={calendarContainerRef} 
        className={view === Views.WEEK ? 'rbc-week-view' : ''}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <Calendar
          localizer={localizer}
          events={calendarEvents}
          startAccessor="start"
          endAccessor="end"
          view={view}
          views={[Views.MONTH, Views.WEEK, Views.DAY]}
          date={currentDate}
          scrollToTime={view === Views.DAY ? scrollToTime : undefined}
          onNavigate={handleNavigate}
          onView={setView}
          onSelectEvent={handleSelectEvent}
          onSelectSlot={handleSelectSlot}
          selectable={view === Views.MONTH || view === Views.WEEK}
          components={{
            toolbar: CustomToolbar,
            event: EventComponent,
            month: {
              dateHeader: DateHeaderWithClick,
              header: CustomWeekdayHeader,
            },
            day: {
              header: CustomDayHeader,
            },
            week: {
              header: CustomWeekHeader,
            },
          }}
          formats={{
            monthHeaderFormat: (date: Date) => {
              const taiwanDate = moment(date).tz('Asia/Taipei');
              return taiwanDate.format('YYYY年M月');
            },
            dayHeaderFormat: (date: Date) => {
              const taiwanDate = moment(date).tz('Asia/Taipei');
              const weekdayNames = getWeekdayNames();
              const weekday = weekdayNames[taiwanDate.day()];
              return `${taiwanDate.format('M月D日')} (${weekday})`;
            },
            dayRangeHeaderFormat: ({ start, end }: { start: Date; end: Date }) => {
              const startDate = moment(start).tz('Asia/Taipei');
              const endDate = moment(end).tz('Asia/Taipei');
              const weekdayNames = getWeekdayNames();
              const startWeekday = weekdayNames[startDate.day()];
              const endWeekday = weekdayNames[endDate.day()];
              // Format: "M月D日 (X) - M月D日 (X)" - used for week view header
              return `${startDate.format('M月D日')} (${startWeekday}) - ${endDate.format('M月D日')} (${endWeekday})`;
            },
            // Note: weekday column headers in month view are handled by CustomWeekdayHeader component
            // dayRangeHeaderFormat is used for week view to show the date range in the header
            timeGutterFormat: (date: Date) => {
              // Format for time slots in day view: "00:00", "13:00", etc. (24-hour format)
              const taiwanDate = moment(date).tz('Asia/Taipei');
              const hours = taiwanDate.hour();
              const minutes = taiwanDate.minute();
              return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            },
          }}
          eventPropGetter={eventStyleGetter}
          // Mobile optimizations
          showMultiDayTimes={!isMobile}
          step={15}
          timeslots={4}
          // Timezone configuration
          culture="zh-TW"
          style={{ height: 800 }}
        />
      </div>

      {/* Event Modal */}
      {modalState.type === 'event' && modalState.data && (() => {
        const canEdit = canEditEvent(modalState.data);
        
        return (
          <EventModal
            event={modalState.data}
            onClose={() => setModalState({ type: null, data: null })}
            onDeleteAppointment={
              canEdit && modalState.data.resource.type === 'appointment' 
                ? handleDeleteAppointment 
                : undefined
            }
            onDeleteException={
              canEdit && modalState.data.resource.type === 'availability_exception' 
                ? handleDeleteException 
                : undefined
            }
            onEditAppointment={
              canEdit && modalState.data.resource.type === 'appointment' 
                ? handleEditAppointment 
                : undefined
            }
            onDuplicateAppointment={
              canDuplicateAppointment(modalState.data)
                ? handleDuplicateAppointment 
                : undefined
            }
            formatAppointmentTime={formatEventTimeRange}
            appointmentTypes={appointmentTypes}
            practitioners={availablePractitioners}
            onReceiptCreated={async () => {
              // Refresh calendar data after receipt creation
              try {
                await fetchCalendarData(true);
                // The useEffect hook will automatically sync modalState with updated event
                // after calendarEvents updates, so no manual update needed here
              } catch (error) {
                logger.error('Failed to refresh calendar after receipt creation:', error);
              }
            }}
            onEventNameUpdated={async (_newName: string | null) => {  
              // Store original state for potential rollback
              const originalEvent = modalState.data;
              
              // Optimistic update: immediately update modalState.data for instant UI feedback
              // For event name updates (_newName is a non-empty string), update the title immediately
              // For clinic notes updates or cleared event names (_newName === null), we'll refresh silently and let useEffect sync
              if (_newName !== null && _newName.trim() !== '' && originalEvent) {
                // Event name was updated - optimistically update the title
                setModalState(prev => ({
                  ...prev,
                  data: {
                    ...prev.data,
                    title: _newName.trim(),
                  }
                }));
              }
              
              try {
                // Refresh calendar data silently in background (no loading spinner)
                // The useEffect above will sync the modalState with the refreshed event when it completes
                // This ensures we get the correct default title if _newName was null/empty
                await fetchCalendarData(true, true); // forceRefresh=true, silent=true
              } catch (error) {
                // Revert optimistic update on error
                if (originalEvent) {
                  setModalState(prev => ({ ...prev, data: originalEvent }));
                }
                // Error is already handled in EventModal, so we just log here
                logger.error('Failed to refresh calendar after event name update:', error);
              }
            }}
          />
        );
      })()}

      {/* Exception Modal */}
      {modalState.type === 'exception' && (
        <ExceptionModal
          exceptionData={exceptionData}
          isFullDay={isFullDay}
          onClose={() => {
            setModalState({ type: null, data: null });
            setIsFullDay(false);
          }}
          onCreate={handleCreateException}
          onExceptionDataChange={setExceptionData}
          onFullDayChange={setIsFullDay}
        />
      )}

      {/* Conflict Warning Modal */}
      {modalState.type === 'conflict' && modalState.data && Array.isArray(modalState.data) && (
        <ConflictModal
          conflictingAppointments={modalState.data}
          onClose={() => setModalState({ type: null, data: null })}
          formatTimeString={formatTimeString}
        />
      )}

      {/* Cancellation Note Input Modal */}
      {modalState.type === 'cancellation_note' && modalState.data && (
        <CancellationNoteModal
          cancellationNote={cancellationNote}
          isLoading={cancellationPreviewLoading}
          onNoteChange={setCancellationNote}
          onBack={() => setModalState({ type: 'event', data: modalState.data })}
          onSubmit={handleCancellationNoteSubmit}
        />
      )}

      {/* Cancellation Preview Modal */}
      {modalState.type === 'cancellation_preview' && modalState.data && (
        <CancellationPreviewModal
          previewMessage={cancellationPreviewMessage}
          onBack={() => setModalState({ type: 'cancellation_note', data: modalState.data })}
          onConfirm={handleConfirmDeleteAppointment}
        />
      )}

      {/* Delete Confirmation Modal */}
      {modalState.type === 'delete_confirmation' && modalState.data && canEditEvent(modalState.data) && (
        <DeleteConfirmationModal
          event={modalState.data}
          onCancel={() => setModalState({ type: 'event', data: modalState.data })}
          onConfirm={modalState.data.resource.type === 'appointment' 
            ? handleConfirmDeleteAppointment 
            : handleConfirmDeleteException}
        />
      )}

      {/* Edit Appointment Modal - handles all steps (form, note, preview) */}
      {modalState.type === 'edit_appointment' && modalState.data && (
        <EditAppointmentModal
          event={modalState.data}
          practitioners={availablePractitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            setEditErrorMessage(null); // Clear error when closing
            setModalState({ type: 'event', data: modalState.data });
          }}
          onComplete={() => {
            // Successful completion → close everything completely
            setEditErrorMessage(null);
            setModalState({ type: null, data: null });
          }}
          onConfirm={handleConfirmEditAppointment}
          formatAppointmentTime={formatAppointmentTimeRange}
          errorMessage={editErrorMessage}
        />
      )}

      {/* Create Appointment Modal */}
      {modalState.type === 'create_appointment' && modalState.data && (
        <CreateAppointmentModal
          key={`create-${createModalKey}`}
          // null from button click → undefined (no patient), number from URL → use it, undefined → fall back to prop
          preSelectedPatientId={
            modalState.data.patientId === null 
              ? undefined 
              : modalState.data.patientId ?? preSelectedPatientId
          }
          initialDate={modalState.data.initialDate || null}
          preSelectedAppointmentTypeId={modalState.data.preSelectedAppointmentTypeId}
          preSelectedPractitionerId={modalState.data.preSelectedPractitionerId}
          preSelectedTime={modalState.data.preSelectedTime}
          preSelectedClinicNotes={modalState.data.preSelectedClinicNotes}
          event={modalState.data.event}
          practitioners={availablePractitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            setModalState({ type: null, data: null });
            // Clear query parameter if it exists
            if (window.location.search.includes('createAppointment=')) {
              const url = new URL(window.location.href);
              url.searchParams.delete('createAppointment');
              window.history.replaceState({}, '', url.toString());
            }
          }}
          onConfirm={handleConfirmCreateAppointment}
        />
      )}
    </>
  );
};

export default CalendarView;
