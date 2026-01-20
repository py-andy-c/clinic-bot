import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import moment from 'moment-timezone';
import { useAuth } from '../hooks/useAuth';
// Removed complex modal hooks - using simple state management
import { usePractitioners, useClinicSettings, useServiceTypeGroups } from '../hooks/queries';
import { canEditAppointment, canDuplicateAppointment, getPractitionerIdForDuplicate } from '../utils/appointmentPermissions';
import { LoadingSpinner } from '../components/shared';
import { CalendarView, CalendarViews } from '../types/calendar';
import CalendarLayout from '../components/calendar/CalendarLayout';
import CalendarSidebar from '../components/calendar/CalendarSidebar';
import CalendarDateStrip from '../components/calendar/CalendarDateStrip';
import CalendarGrid from '../components/calendar/CalendarGrid';
import { EventModal } from '../components/calendar/EventModal';
import { CreateAppointmentModal } from '../components/calendar/CreateAppointmentModal';
import { ExceptionModal } from '../components/calendar/ExceptionModal';
import { EditAppointmentModal } from '../components/calendar/EditAppointmentModal';
import { DeleteConfirmationModal } from '../components/calendar/DeleteConfirmationModal';
import { CancellationNoteModal } from '../components/calendar/CancellationNoteModal';
import { CancellationPreviewModal } from '../components/calendar/CancellationPreviewModal';
import { CheckoutModal } from '../components/calendar/CheckoutModal';
import { ReceiptListModal } from '../components/calendar/ReceiptListModal';
import { ReceiptViewModal } from '../components/calendar/ReceiptViewModal';
import { PractitionerSelectionModal } from '../components/calendar/PractitionerSelectionModal';
import { ServiceItemSelectionModal } from '../components/calendar/ServiceItemSelectionModal';
import { apiService } from '../services/api';
import { calendarStorage } from '../utils/storage';
import { getDateString, formatAppointmentTimeRange } from '../utils/calendarUtils';
import { logger } from '../utils/logger';
import { Resource } from '../types';
import { CalendarEvent, transformToCalendarEvents } from '../utils/calendarDataAdapter';
import { trackCalendarAPICall, completeCalendarAPICall } from '../utils/performanceMonitor';

// Mock calendar data for development fallback
const getMockCalendarEvents = (currentDate: Date, selectedPractitioners: number[], selectedResources: number[]) => {

  const baseDate = moment(currentDate).tz('Asia/Taipei');
  const dateString = baseDate.format('YYYY-MM-DD');

  // Simulate API response structure
  const mockApiResponse = {
    results: [] as Array<{
      user_id: number;
      date: string;
      default_schedule: unknown;
      events: Array<{
        calendar_event_id: number;
        type: string;
        start_time: string;
        end_time: string;
        title: string;
        patient_id?: number;
        appointment_type_id?: number;
        status?: string;
        appointment_id?: number;
        notes?: string;
        clinic_notes?: string;
        patient_name?: string;
        practitioner_name?: string;
        appointment_type_name?: string;
        is_primary?: boolean;
        has_active_receipt?: boolean;
        has_any_receipt?: boolean;
        receipt_ids?: number[];
        resource_names?: string[];
        resource_ids?: number[];
        resource_id?: number;
        resource_name?: string;
        is_resource_event?: boolean;
        exception_id?: number;
      }>;
    }>
  };

  // Generate mock practitioner results (matching API structure)
  selectedPractitioners.forEach((practitionerId, index) => {
    const practitionerEvents = [];

    // Create 2-3 appointments per practitioner
    for (let i = 0; i < Math.min(3, index + 2); i++) {
      const hour = 9 + (i * 2) + (practitionerId % 3); // Spread appointments throughout the day

      practitionerEvents.push({
        calendar_event_id: 1000 + practitionerId * 10 + i,
        type: 'appointment',
        start_time: `${hour.toString().padStart(2, '0')}:00`,
        end_time: `${(hour + 1).toString().padStart(2, '0')}:00`,
        title: `王小明 | 全身按摩`,
        patient_id: 1,
        appointment_type_id: 1,
        status: 'confirmed',
        appointment_id: 1000 + practitionerId * 10 + i,
        notes: '初診',
        clinic_notes: '',
        patient_name: '王小明',
        practitioner_name: `治療師${practitionerId}`,
        appointment_type_name: '全身按摩',
        is_primary: true,
        has_active_receipt: false,
        has_any_receipt: false,
        receipt_ids: [],
        resource_names: ['治療室1'],
        resource_ids: [1],
      });
    }

    // Add one exception per practitioner
    if (index === 0) {
      practitionerEvents.push({
        calendar_event_id: 2000 + practitionerId,
        type: 'availability_exception',
        start_time: '12:00',
        end_time: '13:00',
        title: '午休',
        exception_id: 2000 + practitionerId,
        notes: '午休時間',
      });
    }

    mockApiResponse.results.push({
      user_id: practitionerId,
      date: dateString,
      default_schedule: null,
      events: practitionerEvents
    });
  });

  // Generate mock resource results
  if (selectedResources.length > 0) {
    const resourceEvents: Array<{
      calendar_event_id: number;
      type: string;
      start_time: string;
      end_time: string;
      title: string;
      resource_id?: number;
      resource_name?: string;
      is_resource_event?: boolean;
      notes?: string;
    }> = [];
    selectedResources.forEach((resourceId, index) => {
      const hour = 10 + (index * 3);

      resourceEvents.push({
        calendar_event_id: 3000 + resourceId,
        type: 'appointment',
        start_time: `${hour.toString().padStart(2, '0')}:00`,
        end_time: `${(hour + 1).toString().padStart(2, '0')}:00`,
        title: `[治療室${resourceId}] 清潔中`,
        resource_id: resourceId,
        resource_name: `治療室${resourceId}`,
        is_resource_event: true,
        notes: '定期清潔',
      });
    });

    mockApiResponse.results.push({
      user_id: selectedResources[0]!, // Use first resource ID as user_id for simplicity (guaranteed by length check)
      date: dateString,
      default_schedule: null,
      events: resourceEvents
    });
  }

  // Now apply the same transformation logic as the real API response
  const practitionerEventsRaw = mockApiResponse.results
    .filter(r => selectedPractitioners.includes(r.user_id))
    .flatMap(r => r.events.map((event) => ({ ...event, date: r.date, practitioner_id: r.user_id })));

  const resourceEventsRaw = mockApiResponse.results
    .filter(r => selectedResources.includes(r.user_id))
    .flatMap(r => r.events.map((event) => ({ ...event, date: r.date })));

  const allEvents = [
    ...transformToCalendarEvents(practitionerEventsRaw),
    ...transformToCalendarEvents(resourceEventsRaw)
  ];

  return allEvents;
};

const AvailabilityPage: React.FC = () => {
  const { hasRole, user, isLoading: authLoading, isAuthenticated, isClinicUser } = useAuth();
  const canEdit = hasRole && (hasRole("admin") || hasRole("practitioner"));
  const isClinicAdmin = user?.roles?.includes("admin") ?? false;
  const userId = user?.user_id;
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarView>(CalendarViews.DAY);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]);
  const [selectedPractitioners, setSelectedPractitioners] = useState<number[]>([]);
  const [selectedResources, setSelectedResources] = useState<number[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);

  // Event caching to reduce API calls
  const [eventCache, setEventCache] = useState<Map<string, { events: CalendarEvent[], timestamp: number }>>(new Map());

  // Modal state management - keep non-appointment modals
  const [isExceptionModalOpen, setIsExceptionModalOpen] = useState(false);
  const [isCancellationNoteModalOpen, setIsCancellationNoteModalOpen] = useState(false);
  const [isCancellationPreviewModalOpen, setIsCancellationPreviewModalOpen] = useState(false);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [isReceiptListModalOpen, setIsReceiptListModalOpen] = useState(false);
  const [isReceiptViewModalOpen, setIsReceiptViewModalOpen] = useState(false);
  const [isPractitionerSelectionModalOpen, setIsPractitionerSelectionModalOpen] = useState(false);
  const [isServiceItemSelectionModalOpen, setIsServiceItemSelectionModalOpen] = useState(false);

  // Modal data state - keep non-appointment data
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [cancellationNote, setCancellationNote] = useState('');
  const [scrollTrigger, setScrollTrigger] = useState(0); // Counter to trigger scroll

  // Use React Query for practitioners
  const { data: practitionersData, isLoading: practitionersLoading } = usePractitioners();
  const practitioners = practitionersData || [];

  // Fetch service type groups when service item selection modal is open
  const { data: serviceGroupsData } = useServiceTypeGroups();
  const serviceGroups = serviceGroupsData?.groups || [];

  // Appointment modal state - simple state management
  const [appointmentModalState, setAppointmentModalState] = useState<{
    type: 'edit_appointment' | 'create_appointment' | 'delete_confirmation' | null;
    data?: any;
  }>({ type: null });

  // Stable key for create modal - only increments when modal opens
  const [createModalKey, setCreateModalKey] = useState(0);

  // Helper functions for permissions and actions
  const canEditEvent = useCallback((event: CalendarEvent | null): boolean => {
    if (!event || !canEdit) return false;
    if (event.resource.type === "appointment") {
      return canEditAppointment(event, userId, isClinicAdmin);
    }
    const eventPractitionerId = event.resource.practitioner_id || userId;
    return eventPractitionerId === userId;
  }, [canEdit, userId, isClinicAdmin]);

  const canDuplicateEvent = useCallback((event: CalendarEvent | null): boolean => {
    return canDuplicateAppointment(event);
  }, []);

  // Appointment modal handlers
  const handleEditAppointment = useCallback(async () => {
    if (!selectedEvent || !canEditEvent(selectedEvent)) {
      await alert("您只能編輯自己的預約");
      return;
    }
    setAppointmentModalState({ type: 'edit_appointment', data: selectedEvent });
    setSelectedEvent(null); // Close event modal
  }, [selectedEvent, canEditEvent]);

  const handleDuplicateAppointment = useCallback(async () => {
    if (!selectedEvent || !canDuplicateEvent(selectedEvent)) {
      return;
    }

    const event = selectedEvent;
    const appointmentTypeId = event.resource.appointment_type_id;
    const practitionerId = getPractitionerIdForDuplicate(event, isClinicAdmin);
    const clinicNotes = event.resource.clinic_notes;

    // Extract date and time in Taipei timezone (consistent with calendar display)
    const startMoment = moment(event.start).tz('Asia/Taipei');
    const initialDate = startMoment.format('YYYY-MM-DD');
    const initialTime = startMoment.format('HH:mm');

    setCreateModalKey(prev => prev + 1);
    setAppointmentModalState({
      type: 'create_appointment',
      data: {
        initialDate,
        ...(appointmentTypeId !== undefined && { preSelectedAppointmentTypeId: appointmentTypeId }),
        ...(practitionerId !== undefined && { preSelectedPractitionerId: practitionerId }),
        ...(initialTime && { preSelectedTime: initialTime }),
        ...(clinicNotes !== undefined && clinicNotes !== null && { preSelectedClinicNotes: clinicNotes }),
        event,
      }
    });
    setSelectedEvent(null); // Close event modal
  }, [selectedEvent, canDuplicateEvent, isClinicAdmin]);

  const handleDeleteAppointment = useCallback(async () => {
    if (!selectedEvent || !canEditEvent(selectedEvent)) {
      await alert("您只能取消自己的預約");
      return;
    }
    setAppointmentModalState({ type: 'delete_confirmation', data: selectedEvent });
    setSelectedEvent(null); // Close event modal
  }, [selectedEvent, canEditEvent]);

  // Fetch clinic settings only when modals that need appointment types are opened
  const shouldFetchSettings = appointmentModalState.type === 'create_appointment' || appointmentModalState.type === 'edit_appointment' || isCheckoutModalOpen || isServiceItemSelectionModalOpen;
  const { data: clinicSettingsData } = useClinicSettings(shouldFetchSettings);
  const appointmentTypes = clinicSettingsData?.appointment_types || [];

  // URL parameter handling for deep linking
  useEffect(() => {
    // Read URL parameters on mount
    const dateParam = searchParams.get('date');
    const viewParam = searchParams.get('view');

    if (dateParam) {
      try {
        const parsedDate = new Date(dateParam);
        if (!isNaN(parsedDate.getTime())) {
          setCurrentDate(parsedDate);
        }
      } catch (error) {
        logger.warn('Invalid date parameter:', dateParam);
      }
    }

    if (viewParam && ['day', 'week', 'month'].includes(viewParam)) {
      const viewMap: Record<string, CalendarView> = {
        day: CalendarViews.DAY,
        week: CalendarViews.WEEK,
        month: CalendarViews.MONTH,
      };
      setView(viewMap[viewParam] || CalendarViews.DAY);
    }
  }, []); // Only run on mount

  // Load resources
  useEffect(() => {
    const loadResources = async () => {
      if (!isAuthenticated || authLoading || !user?.active_clinic_id) {
        return;
      }

      try {
        // Get all resource types
        const resourceTypesResponse = await apiService.getResourceTypes();
        const resourceTypes = resourceTypesResponse.resource_types;

        // Fetch all resources
        const allResources: Resource[] = [];
        for (const resourceType of resourceTypes) {
          try {
            const resourcesResponse = await apiService.getResources(resourceType.id);
            const activeResources = resourcesResponse.resources.filter(r => !r.is_deleted);
            allResources.push(...activeResources);
          } catch (err) {
            logger.error(`Failed to load resources for type ${resourceType.id}:`, err);
          }
        }

        setResources(allResources);
      } catch (err) {
        logger.error('Failed to load resources:', err);
      }
    };

    if (isAuthenticated && !authLoading) {
      loadResources();
    }
  }, [isAuthenticated, authLoading, user?.active_clinic_id]);

  // Initialize selection state
  useEffect(() => {
    if (practitioners.length > 0 && user?.user_id && user?.active_clinic_id) {
      // Load persisted state
      const persistedState = calendarStorage.getCalendarState(user.user_id, user.active_clinic_id);
      if (persistedState) {
        // Set view and date
        setView(persistedState.view === 'month' ? CalendarViews.MONTH :
                persistedState.view === 'week' ? CalendarViews.WEEK : CalendarViews.DAY);
        if (persistedState.currentDate) {
          setCurrentDate(new Date(persistedState.currentDate));
        }

        // Set practitioners (limit to 10)
        const validPractitioners = persistedState.additionalPractitionerIds
          .filter(id => practitioners.some(p => p.id === id))
          .slice(0, 10);
        setSelectedPractitioners(validPractitioners);

        // Set resources (limit to 10)
        const resourceState = calendarStorage.getResourceSelection(user.user_id, user.active_clinic_id);
        const validResources = resourceState
          .filter(id => resources.some(r => r.id === id))
          .slice(0, 10);
        setSelectedResources(validResources);
      } else {
        // Default: select first available practitioner
        if (practitioners.length > 0 && practitioners[0]) {
          setSelectedPractitioners([practitioners[0].id]);
        }
      }
      setLoading(false);
    }
  }, [practitioners, resources, user]);

  // Load calendar events function (extracted for explicit refresh capability)
  const loadCalendarEvents = useCallback(async (forceRefresh: boolean = false) => {
    if (selectedPractitioners.length === 0 && !forceRefresh) return;

    // Calculate date range based on view
    let startDate: string;
    let endDate: string;

    if (view === CalendarViews.DAY) {
      startDate = getDateString(currentDate);
      endDate = startDate;
    } else if (view === CalendarViews.WEEK) {
      // Load the full week containing currentDate
      const weekStart = moment(currentDate).tz('Asia/Taipei').startOf('week');
      const weekEnd = moment(currentDate).tz('Asia/Taipei').endOf('week');
      startDate = getDateString(weekStart.toDate());
      endDate = getDateString(weekEnd.toDate());
    } else { // MONTH
      // Load the full month containing currentDate
      const monthStart = moment(currentDate).tz('Asia/Taipei').startOf('month');
      const monthEnd = moment(currentDate).tz('Asia/Taipei').endOf('month');
      startDate = getDateString(monthStart.toDate());
      endDate = getDateString(monthEnd.toDate());
    }

    // Create cache key
    const cacheKey = `${startDate}-${endDate}-${selectedPractitioners.sort().join(',')}-${selectedResources.sort().join(',')}`;

    // Skip cache check if force refresh is requested
    if (!forceRefresh) {
      // Check cache first (5-minute TTL)
      const cached = eventCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
        setAllEvents(cached.events);
        // Track actual cache hit that prevents API call
        const callId = trackCalendarAPICall('calendar-cache-hit', 'CACHE');
        completeCalendarAPICall(callId, true, true);
        return;
      }
    }

    // Track cache miss (API call will be made)
    const missCallId = trackCalendarAPICall('calendar-cache-miss', 'CACHE');
    completeCalendarAPICall(missCallId, true, false);

    try {
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

      const allEvents = [
        ...transformToCalendarEvents(practitionerEventsRaw),
        ...transformToCalendarEvents(resourceEventsRaw)
      ];

      // Cache the results
      setEventCache(prev => new Map(prev).set(cacheKey, { events: allEvents, timestamp: Date.now() }));

      setAllEvents(allEvents);
    } catch (error) {
      logger.error('Failed to load calendar events:', error);

      // Fallback to mock data for development when API calls fail
      if (process.env.NODE_ENV === 'development') {
        const mockEvents = getMockCalendarEvents(currentDate, selectedPractitioners, selectedResources);
        setAllEvents(mockEvents);
      }
    }
  }, [selectedPractitioners, selectedResources, currentDate, view, eventCache]);

  // Load calendar events with caching
  useEffect(() => {
    loadCalendarEvents();
  }, [loadCalendarEvents]);

  // Event handlers
  const handleViewChange = useCallback((newView: CalendarView) => {
    setView(newView);
    // Update URL parameters
    const newSearchParams = new URLSearchParams(searchParams);
    const viewParam = newView === CalendarViews.MONTH ? 'month' : newView === CalendarViews.WEEK ? 'week' : 'day';
    newSearchParams.set('view', viewParam);
    setSearchParams(newSearchParams, { replace: true });

    // Persist view change
    if (user?.user_id && user?.active_clinic_id) {
      calendarStorage.setCalendarState(user.user_id, user.active_clinic_id, {
        view: viewParam,
        currentDate: getDateString(currentDate),
        additionalPractitionerIds: selectedPractitioners,
        defaultPractitionerId: null,
      });
    }
  }, [user, currentDate, selectedPractitioners, searchParams, setSearchParams]);

  const handleDateChange = useCallback((date: Date) => {
    setCurrentDate(date);
    // Update URL parameters
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set('date', getDateString(date));
    setSearchParams(newSearchParams, { replace: true });

    // Persist date change
    if (user?.user_id && user?.active_clinic_id) {
      calendarStorage.setCalendarState(user.user_id, user.active_clinic_id, {
        view: view === CalendarViews.MONTH ? 'month' : view === CalendarViews.WEEK ? 'week' : 'day',
        currentDate: getDateString(date),
        additionalPractitionerIds: selectedPractitioners,
        defaultPractitionerId: null,
      });
    }
  }, [user, selectedPractitioners, view, searchParams, setSearchParams]);

  const handleEventClick = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event);
  }, []);

  const handleSlotClick = useCallback(() => {
    setCreateModalKey(prev => prev + 1);
    setAppointmentModalState({ type: 'create_appointment', data: {} });
  }, []);

  const handleCreateAppointment = useCallback(() => {
    setCreateModalKey(prev => prev + 1);
    setAppointmentModalState({ type: 'create_appointment', data: {} });
  }, []);

  const handleCreateException = useCallback(() => {
    setIsExceptionModalOpen(true);
  }, []);

  const handleToday = useCallback(() => {
    const today = new Date();
    setCurrentDate(today);
    handleDateChange(today);
    // Trigger scroll to current time
    setScrollTrigger(prev => prev + 1);
  }, [handleDateChange]);

  const handleSettings = useCallback(() => {
    setSidebarOpen(!sidebarOpen);
  }, [sidebarOpen]);

  if (loading || practitionersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (practitioners.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg mb-2">目前沒有可用的治療師</p>
        <p className="text-sm">請先新增治療師到診所</p>
      </div>
    );
  }

  return (
    <CalendarLayout>
      <CalendarSidebar
        view={view}
        onViewChange={handleViewChange}
        practitioners={practitioners}
        selectedPractitioners={selectedPractitioners}
        onPractitionersChange={setSelectedPractitioners}
        resources={resources}
        selectedResources={selectedResources}
        onResourcesChange={setSelectedResources}
        isOpen={sidebarOpen}
        onClose={handleSettings}
      />

      <CalendarDateStrip
        view={view}
        currentDate={currentDate}
        onDateChange={handleDateChange}
        onCreateAppointment={handleCreateAppointment}
        onCreateException={handleCreateException}
        onToday={handleToday}
        onSettings={handleSettings}
      />

      <CalendarGrid
        view={view}
        currentDate={currentDate}
        events={allEvents}
        selectedPractitioners={selectedPractitioners}
        selectedResources={selectedResources}
        practitioners={practitioners}
        resources={resources}
        onEventClick={handleEventClick}
        onSlotClick={handleSlotClick}
        scrollToCurrentTime={scrollTrigger > 0}
      />

      {/* Modal Components */}
      {selectedEvent && (
        <EventModal
          event={selectedEvent}
          onClose={() => {
            setSelectedEvent(null);
          }}
          onEditAppointment={
            canEditEvent(selectedEvent) && selectedEvent.resource.type === "appointment"
              ? handleEditAppointment
              : undefined
          }
          onDeleteAppointment={
            canEditEvent(selectedEvent) && selectedEvent.resource.type === "appointment"
              ? handleDeleteAppointment
              : undefined
          }
          onDuplicateAppointment={
            canDuplicateEvent(selectedEvent)
              ? handleDuplicateAppointment
              : undefined
          }
          formatAppointmentTime={formatAppointmentTimeRange}
          appointmentTypes={appointmentTypes}
          practitioners={practitioners}
        />
      )}

      {appointmentModalState.type === 'create_appointment' && appointmentModalState.data && (
        <CreateAppointmentModal
          key={`create-${createModalKey}`} // Stable key that only changes when modal opens
          initialDate={appointmentModalState.data.initialDate}
          preSelectedAppointmentTypeId={appointmentModalState.data.preSelectedAppointmentTypeId}
          preSelectedPractitionerId={appointmentModalState.data.preSelectedPractitionerId}
          preSelectedTime={appointmentModalState.data.preSelectedTime}
          preSelectedClinicNotes={appointmentModalState.data.preSelectedClinicNotes}
          event={appointmentModalState.data.event}
          onClose={() => setAppointmentModalState({ type: null })}
          onConfirm={async (formData) => {
            try {
              await apiService.createClinicAppointment(formData);
              await alert("預約已建立");
              await loadCalendarEvents(true);
              setAppointmentModalState({ type: null });
            } catch (error) {
              logger.error('Failed to create appointment:', error);
              throw error;
            }
          }}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
        />
      )}

      {isExceptionModalOpen && (
        <ExceptionModal
          exceptionData={{ date: getDateString(currentDate), startTime: '09:00', endTime: '17:00' }}
          isFullDay={false}
          onClose={() => setIsExceptionModalOpen(false)}
          onCreate={async () => {
            setIsExceptionModalOpen(false);
            // Force refresh calendar data
            await loadCalendarEvents(true);
          }}
          onExceptionDataChange={() => {}}
          onFullDayChange={() => {}}
        />
      )}

      {appointmentModalState.type === 'edit_appointment' && appointmentModalState.data && (
        <EditAppointmentModal
          event={appointmentModalState.data}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => setAppointmentModalState({ type: null })}
          onComplete={async () => {
            await loadCalendarEvents(true);
            setAppointmentModalState({ type: null });
          }}
          onConfirm={async (formData) => {
            const event = appointmentModalState.data;
            if (!event?.id || typeof event.id !== 'number') return;

            if (!canEditEvent(event)) {
              await alert('您只能編輯自己的預約');
              return;
            }

            try {
              const updateData: any = {
                appointment_type_id: formData.appointment_type_id || null,
                practitioner_id: formData.practitioner_id || null,
                start_time: formData.start_time,
                selected_resource_ids: formData.selected_resource_ids,
              };
              if (formData.clinic_notes) {
                updateData.clinic_notes = formData.clinic_notes;
              }
              await apiService.editClinicAppointment(event.id, updateData);
            } catch (error) {
              logger.error('Failed to update appointment:', error);
              throw error;
            }
          }}
          formatAppointmentTime={formatAppointmentTimeRange}
        />
      )}

      {appointmentModalState.type === 'delete_confirmation' && appointmentModalState.data && (
        <DeleteConfirmationModal
          event={appointmentModalState.data}
          onCancel={() => setAppointmentModalState({ type: null })}
          onConfirm={async () => {
            const event = appointmentModalState.data;
            if (!event?.id || typeof event.id !== 'number') return;

            if (!canEditEvent(event)) {
              alert('您只能取消自己的預約');
              return;
            }

            try {
              await apiService.cancelClinicAppointment(event.id);
              await loadCalendarEvents(true);
              setAppointmentModalState({ type: null });
            } catch (error) {
              logger.error('Failed to cancel appointment:', error);
              throw error;
            }
          }}
        />
      )}

      {/* Additional Modals */}
      {isCancellationNoteModalOpen && (
        <CancellationNoteModal
          cancellationNote={cancellationNote}
          isLoading={false}
          onNoteChange={setCancellationNote}
          onBack={() => {
            setIsCancellationNoteModalOpen(false);
            setCancellationNote('');
          }}
          onSubmit={() => {
            // Proceed to preview with the note
            setIsCancellationNoteModalOpen(false);
            setIsCancellationPreviewModalOpen(true);
          }}
        />
      )}

      {isCancellationPreviewModalOpen && selectedAppointmentId && (
        <CancellationPreviewModal
          previewMessage={`取消預約確認\n\n原因：${cancellationNote || '無'}\n\n此動作無法復原。`}
          onBack={() => {
            setIsCancellationPreviewModalOpen(false);
            setIsCancellationNoteModalOpen(true); // Go back to note modal
          }}
          onConfirm={async () => {
            try {
              await apiService.cancelClinicAppointment(selectedAppointmentId, cancellationNote);
              setIsCancellationPreviewModalOpen(false);
              setCancellationNote('');
              setSelectedAppointmentId(null);
              await loadCalendarEvents(true); // Refresh events
            } catch (error) {
              logger.error('Failed to cancel appointment:', error);
              alert('Failed to cancel appointment. Please try again or contact support if the problem persists.');
            }
          }}
        />
      )}

      {isCheckoutModalOpen && selectedEvent && (
        <CheckoutModal
          event={selectedEvent}
          appointmentTypes={appointmentTypes}
          practitioners={practitioners}
          onClose={() => {
            setIsCheckoutModalOpen(false);
            setSelectedEvent(null);
          }}
          onSuccess={async () => {
            // Note: CheckoutModal handles the API call internally
            // Here we just need to refresh the UI
            setIsCheckoutModalOpen(false);
            setSelectedEvent(null);
            await loadCalendarEvents(true); // Refresh
          }}
        />
      )}

      {isReceiptListModalOpen && selectedAppointmentId && (
        <ReceiptListModal
          appointmentId={selectedAppointmentId}
          receiptIds={[]} // Will be populated by the modal itself
          onClose={() => {
            setIsReceiptListModalOpen(false);
            setSelectedAppointmentId(null);
          }}
          onSelectReceipt={(receiptId) => {
            setSelectedAppointmentId(receiptId);
            setIsReceiptListModalOpen(false);
            setIsReceiptViewModalOpen(true);
          }}
        />
      )}

      {isReceiptViewModalOpen && selectedAppointmentId && (
        <ReceiptViewModal
          receiptId={selectedAppointmentId}
          onClose={() => {
            setIsReceiptViewModalOpen(false);
            setSelectedAppointmentId(null);
          }}
          isClinicUser={isClinicUser}
        />
      )}

      {isPractitionerSelectionModalOpen && (
        <PractitionerSelectionModal
          isOpen={isPractitionerSelectionModalOpen}
          selectedPractitionerId={null}
          practitioners={practitioners}
          onClose={() => setIsPractitionerSelectionModalOpen(false)}
          onSelect={() => {
            // Handle practitioner selection - could store for later use
            setIsPractitionerSelectionModalOpen(false);
          }}
        />
      )}

      {isServiceItemSelectionModalOpen && (
        <ServiceItemSelectionModal
          isOpen={isServiceItemSelectionModalOpen}
          onClose={() => setIsServiceItemSelectionModalOpen(false)}
          onSelect={() => {
            // Handle service item selection - could store for checkout
            setIsServiceItemSelectionModalOpen(false);
          }}
          serviceItems={appointmentTypes}
          groups={serviceGroups}
        />
      )}

    </CalendarLayout>
  );
};

export default AvailabilityPage;