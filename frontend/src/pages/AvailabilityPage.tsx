import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import moment from 'moment-timezone';
import { useAuth } from '../hooks/useAuth';
import { usePractitioners, useClinicSettings, useServiceTypeGroups } from '../hooks/queries';
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
import { ConflictModal, ConflictAppointment } from '../components/calendar/ConflictModal';
import { CancellationNoteModal } from '../components/calendar/CancellationNoteModal';
import { CancellationPreviewModal } from '../components/calendar/CancellationPreviewModal';
import { CheckoutModal } from '../components/calendar/CheckoutModal';
import { ReceiptListModal } from '../components/calendar/ReceiptListModal';
import { ReceiptViewModal } from '../components/calendar/ReceiptViewModal';
import { PractitionerSelectionModal } from '../components/calendar/PractitionerSelectionModal';
import { ServiceItemSelectionModal } from '../components/calendar/ServiceItemSelectionModal';
import NotificationModal, { NotificationPreview } from '../components/calendar/NotificationModal';
import { apiService } from '../services/api';
import { calendarStorage } from '../utils/storage';
import { getDateString, formatAppointmentTimeRange } from '../utils/calendarUtils';
import { logger } from '../utils/logger';
import { Resource } from '../types';
import { CalendarEvent, transformToCalendarEvents } from '../utils/calendarDataAdapter';
import { trackCalendarAPICall, completeCalendarAPICall } from '../utils/performanceMonitor';

// Conflict detection utility
const detectAppointmentConflicts = (
  events: CalendarEvent[],
  newStart: Date,
  newEnd: Date,
  practitionerId?: number | null,
  resourceIds?: number[],
  excludeEventId?: number
): ConflictAppointment[] => {
  const conflicts: ConflictAppointment[] = [];

  events.forEach(event => {
    // Skip the event being edited
    if (excludeEventId && event.id === excludeEventId) return;

    // Check if this event overlaps with the new appointment time
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);

    const hasTimeOverlap = !(newEnd <= eventStart || newStart >= eventEnd);

    if (hasTimeOverlap) {
      // Check practitioner conflict
      if (practitionerId && event.resource.practitioner_id === practitionerId) {
        conflicts.push({
          title: event.title,
          patient_name: event.resource.patient_name || 'Unknown Patient',
          start_time: formatAppointmentTimeRange(eventStart, eventEnd),
          end_time: event.resource.notes || '',
          notes: `Practitioner conflict with ${event.resource.patient_name || 'Unknown Patient'}`,
        });
      }

      // Check resource conflicts
      if (resourceIds && resourceIds.length > 0 && event.resource.resource_id) {
        const isResourceConflict = resourceIds.includes(event.resource.resource_id);

        if (isResourceConflict) {
        conflicts.push({
          title: event.title,
          patient_name: event.resource.patient_name || 'Unknown Patient',
          start_time: formatAppointmentTimeRange(eventStart, eventEnd),
          end_time: event.resource.notes || '',
          notes: `Resource conflict with ${event.resource.patient_name || 'Unknown Patient'}`,
        });
        }
      }
    }
  });

  return conflicts;
};

const AvailabilityPage: React.FC = () => {
  const { user, isLoading: authLoading, isAuthenticated, isClinicUser } = useAuth();
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

  // Modal state management
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isCreateAppointmentModalOpen, setIsCreateAppointmentModalOpen] = useState(false);
  const [isExceptionModalOpen, setIsExceptionModalOpen] = useState(false);
  const [isEditAppointmentModalOpen, setIsEditAppointmentModalOpen] = useState(false);
  const [isDeleteConfirmationModalOpen, setIsDeleteConfirmationModalOpen] = useState(false);
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [isCancellationNoteModalOpen, setIsCancellationNoteModalOpen] = useState(false);
  const [isCancellationPreviewModalOpen, setIsCancellationPreviewModalOpen] = useState(false);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [isReceiptListModalOpen, setIsReceiptListModalOpen] = useState(false);
  const [isReceiptViewModalOpen, setIsReceiptViewModalOpen] = useState(false);
  const [isPractitionerSelectionModalOpen, setIsPractitionerSelectionModalOpen] = useState(false);
  const [isServiceItemSelectionModalOpen, setIsServiceItemSelectionModalOpen] = useState(false);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);

  // Modal data state
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [notificationPreview, setNotificationPreview] = useState<NotificationPreview | null>(null);
  const [conflictingAppointments, setConflictingAppointments] = useState<ConflictAppointment[]>([]);
  const [cancellationNote, setCancellationNote] = useState('');
  const [scrollTrigger, setScrollTrigger] = useState(0); // Counter to trigger scroll

  // Use React Query for practitioners
  const { data: practitionersData, isLoading: practitionersLoading } = usePractitioners();
  const practitioners = practitionersData || [];

  // Fetch clinic settings only when modals that need appointment types are opened
  const shouldFetchSettings = isCreateAppointmentModalOpen || isEditAppointmentModalOpen || isCheckoutModalOpen || isServiceItemSelectionModalOpen;
  const { data: clinicSettingsData } = useClinicSettings(shouldFetchSettings);
  const appointmentTypes = clinicSettingsData?.appointment_types || [];

  // Fetch service type groups when service item selection modal is open
  const { data: serviceGroupsData } = useServiceTypeGroups();
  const serviceGroups = serviceGroupsData?.groups || [];

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

  // Load calendar events with caching
  useEffect(() => {
    const loadEvents = async () => {
      if (selectedPractitioners.length === 0) return;

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

      // Check cache first (5-minute TTL)
      const cached = eventCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
        setAllEvents(cached.events);
        // Track actual cache hit that prevents API call
        const callId = trackCalendarAPICall('calendar-cache-hit', 'CACHE');
        completeCalendarAPICall(callId, true, true);
        return;
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

        // Transform events
        const allEvents = [
          ...transformToCalendarEvents(practitionerEvents.results.flatMap(r => r.events)),
          ...transformToCalendarEvents(resourceEvents.results?.flatMap(r => r.events) || [])
        ];

        // Cache the results
        setEventCache(prev => new Map(prev).set(cacheKey, { events: allEvents, timestamp: Date.now() }));

        setAllEvents(allEvents);
      } catch (error) {
        logger.error('Failed to load calendar events:', error);
      }
    };

    loadEvents();
  }, [selectedPractitioners, selectedResources, currentDate, view]);

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
    setIsEventModalOpen(true);
  }, []);

  const handleSlotClick = useCallback((_slotInfo: { start: Date; end: Date }) => {
    setIsCreateAppointmentModalOpen(true);
  }, []);

  const handleCreateAppointment = useCallback(() => {
    setIsCreateAppointmentModalOpen(true);
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
      {isEventModalOpen && selectedEvent && (
        <EventModal
          event={selectedEvent}
          onClose={() => {
            setIsEventModalOpen(false);
            setSelectedEvent(null);
          }}
          onEditAppointment={() => {
            setIsEventModalOpen(false);
            setIsEditAppointmentModalOpen(true);
          }}
          onDeleteAppointment={() => {
            setIsEventModalOpen(false);
            setIsDeleteConfirmationModalOpen(true);
          }}
          onDuplicateAppointment={() => {
            // Handle duplicate - for now just close modal
            setIsEventModalOpen(false);
            setSelectedEvent(null);
          }}
          formatAppointmentTime={formatAppointmentTimeRange}
        />
      )}

      {isCreateAppointmentModalOpen && (
        <CreateAppointmentModal
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            setIsCreateAppointmentModalOpen(false);
          }}
          onConfirm={async (formData) => {
            try {
              // Check for conflicts before creating appointment
              const conflicts = detectAppointmentConflicts(
                allEvents,
                new Date(formData.start_time),
                new Date(new Date(formData.start_time).getTime() + 60 * 60 * 1000), // Default 1 hour
                formData.practitioner_id || null,
                formData.selected_resource_ids
              );

              if (conflicts.length > 0) {
                setConflictingAppointments(conflicts);
                setIsCreateAppointmentModalOpen(false);
                setIsConflictModalOpen(true);
                return;
              }

              const appointmentData: any = {
                patient_id: formData.patient_id,
                appointment_type_id: formData.appointment_type_id,
                start_time: formData.start_time,
                practitioner_id: formData.practitioner_id || null,
                selected_resource_ids: formData.selected_resource_ids,
              };
              if (formData.clinic_notes) {
                appointmentData.clinic_notes = formData.clinic_notes;
              }
              const result = await apiService.createClinicAppointment(appointmentData);

              // Trigger notification for new appointment
              if (result.success && result.appointment_id) {
                // Set up notification preview for the newly created appointment
                setNotificationPreview({
                  message: `您的預約已確認。\n時間：${formatAppointmentTimeRange(new Date(formData.start_time), new Date(new Date(formData.start_time).getTime() + 60 * 60 * 1000))}\n服務項目：預約服務`,
                  patient_id: formData.patient_id,
                  event_type: 'appointment_created'
                });
                setIsNotificationModalOpen(true);
              }

              setIsCreateAppointmentModalOpen(false);
              // Clear cache to force refresh
              setEventCache(new Map());
            } catch (error) {
              logger.error('Failed to create appointment:', error);
              // Error handling will be done by the modal
            }
          }}
        />
      )}

      {isExceptionModalOpen && (
        <ExceptionModal
          exceptionData={{ date: getDateString(currentDate), startTime: '09:00', endTime: '17:00' }}
          isFullDay={false}
          onClose={() => setIsExceptionModalOpen(false)}
          onCreate={() => {
            setIsExceptionModalOpen(false);
            // Clear cache to force refresh
            setEventCache(new Map());
          }}
          onExceptionDataChange={() => {}}
          onFullDayChange={() => {}}
        />
      )}

      {isEditAppointmentModalOpen && selectedEvent && (
        <EditAppointmentModal
          event={selectedEvent}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            setIsEditAppointmentModalOpen(false);
            setSelectedEvent(null);
          }}
          onComplete={() => {
            setIsEditAppointmentModalOpen(false);
            setSelectedEvent(null);
            // Clear cache to force refresh
            setEventCache(new Map());
          }}
          onConfirm={async (formData) => {
            if (!selectedEvent?.id || typeof selectedEvent.id !== 'number') return;

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
              await apiService.editClinicAppointment(selectedEvent.id, updateData);
              setIsEditAppointmentModalOpen(false);
              setSelectedEvent(null);
              // Clear cache to force refresh
              setEventCache(new Map());
            } catch (error) {
              logger.error('Failed to update appointment:', error);
              // Error handling will be done by the modal
            }
          }}
          formatAppointmentTime={formatAppointmentTimeRange}
        />
      )}

      {isDeleteConfirmationModalOpen && selectedEvent && (
        <DeleteConfirmationModal
          event={selectedEvent}
          onCancel={() => {
            setIsDeleteConfirmationModalOpen(false);
            setSelectedEvent(null);
          }}
          onConfirm={() => {
            if (!selectedEvent?.id || typeof selectedEvent.id !== 'number') return;

            // For appointments, this actually cancels them (not deletes)
            apiService.cancelClinicAppointment(selectedEvent.id)
              .then(() => {
                setIsDeleteConfirmationModalOpen(false);
                setSelectedEvent(null);
                // Clear cache to force refresh
                setEventCache(new Map());
              })
              .catch((error) => {
                logger.error('Failed to cancel appointment:', error);
                // Error handling will be done by the modal
              });
          }}
        />
      )}

      {/* Additional Modals */}
      {isConflictModalOpen && (
        <ConflictModal
          conflictingAppointments={conflictingAppointments}
          onClose={() => {
            setIsConflictModalOpen(false);
            setConflictingAppointments([]);
          }}
          formatTimeString={(timeStr) => timeStr}
        />
      )}

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
              setEventCache(new Map()); // Refresh events
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
            setEventCache(new Map()); // Refresh
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
          onSelect={(_practitionerId) => {
            // Handle practitioner selection - could store for later use
            setIsPractitionerSelectionModalOpen(false);
          }}
        />
      )}

      {isServiceItemSelectionModalOpen && (
        <ServiceItemSelectionModal
          isOpen={isServiceItemSelectionModalOpen}
          onClose={() => setIsServiceItemSelectionModalOpen(false)}
          onSelect={(_serviceItemId) => {
            // Handle service item selection - could store for checkout
            setIsServiceItemSelectionModalOpen(false);
          }}
          serviceItems={appointmentTypes}
          groups={serviceGroups}
        />
      )}

      {isNotificationModalOpen && notificationPreview && (
        <NotificationModal
          visible={isNotificationModalOpen}
          onClose={() => {
            setIsNotificationModalOpen(false);
            setNotificationPreview(null);
          }}
          preview={notificationPreview}
        />
      )}

    </CalendarLayout>
  );
};

export default AvailabilityPage;