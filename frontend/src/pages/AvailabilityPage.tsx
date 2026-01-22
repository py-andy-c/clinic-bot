import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import moment from 'moment-timezone';
import { useAuth } from '../hooks/useAuth';
import { usePractitioners, useClinicSettings, useServiceTypeGroups } from '../hooks/queries';
import { LoadingSpinner } from '../components/shared';
import { CalendarView, CalendarViews } from '../types/calendar';

// Utility function to update a CalendarEvent with fresh appointment data
const updateCalendarEventWithAppointmentData = (
  existingEvent: CalendarEvent,
  appointmentData: any
): CalendarEvent => {
  const updatedResource = {
    ...existingEvent.resource,
    has_active_receipt: appointmentData.has_active_receipt,
    has_any_receipt: appointmentData.has_any_receipt,
    receipt_id: appointmentData.receipt_id || null,
    receipt_ids: appointmentData.receipt_ids || [],
  };

  return {
    ...existingEvent,
    resource: updatedResource,
  };
};
import CalendarLayout from '../components/calendar/CalendarLayout';
import CalendarSidebar from '../components/calendar/CalendarSidebar';
import CalendarDateStrip from '../components/calendar/CalendarDateStrip';
import CalendarGrid, { PractitionerRow } from '../components/calendar/CalendarGrid';
import { EventModal } from '../components/calendar/EventModal';
import { CreateAppointmentModal } from '../components/calendar/CreateAppointmentModal';
import { ExceptionModal, ExceptionData } from '../components/calendar/ExceptionModal';
import { EditAppointmentModal } from '../components/calendar/EditAppointmentModal';
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
import { useCalendarEvents, invalidateCalendarEventsForAppointment } from '../hooks/queries/useCalendarEvents';
import { useCreateAppointmentOptimistic } from '../hooks/queries/useAvailabilitySlots';
import { queryClient } from '../config/queryClient';
import { CalendarEvent } from '../utils/calendarDataAdapter';
import { useModal } from '../contexts/ModalContext';
import { canDuplicateAppointment, getPractitionerIdForDuplicate } from '../utils/appointmentPermissions';
import { canEditEvent as canEditEventUtil } from '../utils/eventPermissions';
import { getErrorMessage } from '../types/api';
import { AvailabilityExceptionRequest } from '../types';
import { CalendarPractitionerAvailability } from '../utils/practitionerAvailability';



const AvailabilityPage: React.FC = () => {
  const { user, isLoading: authLoading, isAuthenticated, isClinicUser, hasRole } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  // Reset initial load state when clinic changes
  React.useEffect(() => {
    if (user?.active_clinic_id) {
      setLoading(true);
      setInitialLoadComplete(false);
      setIsInitialized(false);
      setDataReady({ practitioners: false, resources: false, user: false });
    }
  }, [user?.active_clinic_id]);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarView>(CalendarViews.DAY);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedPractitioners, setSelectedPractitioners] = useState<number[]>([]);
  const [selectedResources, setSelectedResources] = useState<number[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Selection limits (extracted as constants for maintainability)
  const MAX_PRACTITIONERS = 10;
  const MAX_RESOURCES = 10;

  // Track when each data source is ready to prevent race conditions
  const [dataReady, setDataReady] = useState({
    practitioners: false,
    resources: false,
    user: false
  });

  // Use React Query for calendar events
  const {
    data: calendarData,
    isLoading: eventsLoading,
    error: eventsError
  } = useCalendarEvents({
    selectedPractitioners,
    selectedResources,
    currentDate,
    view
  });

  // Extract events and practitioner availability from calendar data
  const allEvents = calendarData?.events || [];
  const practitionerAvailability: CalendarPractitionerAvailability = calendarData?.practitionerAvailability || {};


  // Optimistic update hook for appointment creation
  const createAppointmentMutation = useCreateAppointmentOptimistic();

  // Handle calendar query errors gracefully
  React.useEffect(() => {
    if (eventsError) {
      logger.error('Calendar events query failed:', eventsError);
      alert('行事曆載入失敗，請稍後再試。如問題持續，請聯絡系統管理員。', '錯誤');
    }
  }, [eventsError]);

  // Modal state management
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isCreateAppointmentModalOpen, setIsCreateAppointmentModalOpen] = useState(false);
  const [isExceptionModalOpen, setIsExceptionModalOpen] = useState(false);
  const [isEditAppointmentModalOpen, setIsEditAppointmentModalOpen] = useState(false);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [isReceiptListModalOpen, setIsReceiptListModalOpen] = useState(false);
  const [isReceiptViewModalOpen, setIsReceiptViewModalOpen] = useState(false);
  const [isPractitionerSelectionModalOpen, setIsPractitionerSelectionModalOpen] = useState(false);
  const [isServiceItemSelectionModalOpen, setIsServiceItemSelectionModalOpen] = useState(false);

  // Modal data state
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [cancellationNote, setCancellationNote] = useState('');

  // Delete appointment state (following patient detail page pattern)
  const [deletingAppointment, setDeletingAppointment] = useState<CalendarEvent | null>(null);
  const [cancellationPreviewMessage, setCancellationPreviewMessage] = useState<string>('');
  const [cancellationPreviewLoading, setCancellationPreviewLoading] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'note' | 'preview' | null>(null);

  // Duplicate appointment state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createModalKey, setCreateModalKey] = useState(0);
  const [duplicateData, setDuplicateData] = useState<{
    preSelectedAppointmentTypeId?: number;
    preSelectedPractitionerId?: number;
    preSelectedTime?: string;
    preSelectedClinicNotes?: string;
    initialDate?: string;
    event?: CalendarEvent;
  } | null>(null);

  // Exception modal state
  const [exceptionData, setExceptionData] = useState<ExceptionData>({
    date: getDateString(currentDate),
    startTime: '00:00',
    endTime: '23:00'
  });
  const [isFullDay, setIsFullDay] = useState(false);

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

  // Track data readiness to prevent race conditions
  React.useEffect(() => {
    if (practitioners.length > 0) {
      setDataReady(prev => ({ ...prev, practitioners: true }));
    }
  }, [practitioners.length]);

  React.useEffect(() => {
    if (resources.length > 0) {
      setDataReady(prev => ({ ...prev, resources: true }));
    }
  }, [resources.length]);

  React.useEffect(() => {
    if (user?.user_id && user?.active_clinic_id) {
      setDataReady(prev => ({ ...prev, user: true }));
    }
  }, [user?.user_id, user?.active_clinic_id]);

  // Modal context for alerts
  const { alert } = useModal();

  // Permission checks (matching patient detail page pattern)
  const canEdit = hasRole && (hasRole("admin") || hasRole("practitioner"));

  // Helper function to check if user can edit an event (uses shared utility)
  const canEditEvent = useCallback(
    (event: CalendarEvent | null): boolean => {
      return canEditEventUtil(event, canEdit, {
        userId: user?.user_id,
        isAdmin: user?.roles?.includes('admin') ?? false
      });
    },
    [canEdit, user]
  );


  // Handle delete appointment from EventModal (following patient detail page pattern)
  const handleDeleteAppointment = useCallback(async () => {
    if (!selectedEvent || !selectedEvent.resource.appointment_id) return;

    // Security check: Ensure user has permission to delete this appointment
    if (!canEditEvent(selectedEvent)) {
      await alert("您只能取消自己的預約");
      return;
    }

    // Reset cancellation note and show note input modal
    setCancellationNote('');
    setCancellationPreviewMessage('');
    setDeletingAppointment(selectedEvent);
    setDeleteStep('note');
    setIsEventModalOpen(false);
    setSelectedEvent(null); // Close EventModal
  }, [selectedEvent, canEditEvent]);

  // Handle delete availability exception
  const handleDeleteException = useCallback(async () => {
    if (!selectedEvent || !selectedEvent.resource.exception_id) return;

    // Security check: Ensure user has permission to delete this exception
    if (!canEditEvent(selectedEvent)) {
      await alert("您只能刪除自己的休診時段");
      return;
    }

    try {
      await apiService.deleteAvailabilityException(user!.user_id, selectedEvent.resource.exception_id);

      // Invalidate calendar events cache to refresh the view
      invalidateCalendarEventsForAppointment(queryClient, user?.active_clinic_id);

      setIsEventModalOpen(false);
      setSelectedEvent(null);
      await alert('休診時段已刪除');
    } catch (error) {
      logger.error('Failed to delete availability exception:', error);
      const errorMessage = getErrorMessage(error);
      await alert(`刪除休診時段失敗：${errorMessage}`, '錯誤');
    }
  }, [selectedEvent, canEditEvent, user, queryClient, alert]);

  // Handle duplicate appointment from EventModal (following patient detail page pattern)
  const handleDuplicateAppointment = useCallback(async () => {
    if (!selectedEvent) return;

    // Security check: Ensure user has permission to duplicate this appointment
    if (!canEditEvent(selectedEvent)) {
      await alert("您只能複製自己的預約");
      return;
    }

    const event = selectedEvent;

    // Extract data from the original appointment
    const appointmentTypeId = event.resource.appointment_type_id;
    // Use shared utility to get practitioner_id (hides for auto-assigned when not admin)
    const practitionerId = getPractitionerIdForDuplicate(event, user?.roles?.includes('admin') || false);
    const clinicNotes = event.resource.clinic_notes;

    // Extract date and time from event.start
    const startMoment = moment(event.start).tz('Asia/Taipei');
    const initialDate = startMoment.format('YYYY-MM-DD');
    const initialTime = startMoment.format('HH:mm');

    // Set up duplicate appointment data - only include fields that have values
    // Resources will be fetched by useAppointmentForm in duplicate mode
    setDuplicateData({
      initialDate,
      // Only include these if they have values (avoid passing undefined)
      ...(appointmentTypeId !== undefined && { preSelectedAppointmentTypeId: appointmentTypeId }),
      ...(practitionerId !== undefined && { preSelectedPractitionerId: practitionerId }),
      ...(initialTime && { preSelectedTime: initialTime }),
      ...(clinicNotes !== undefined && clinicNotes !== null && { preSelectedClinicNotes: clinicNotes }),
      event,
    });
    setCreateModalKey(prev => prev + 1); // Force remount to reset state
    setIsCreateModalOpen(true);
    setIsEventModalOpen(false);
    setSelectedEvent(null); // Close EventModal
  }, [selectedEvent, user]);

  // Handle cancellation note submission
  const handleCancellationNoteSubmit = useCallback(async () => {
    if (!deletingAppointment) return;

    // Security check: Ensure user still has permission to cancel this appointment
    if (!canEditEvent(deletingAppointment)) {
      await alert("您只能取消自己的預約");
      return;
    }

    setCancellationPreviewLoading(true);
    try {
      const response = await apiService.generateCancellationPreview({
        appointment_type: deletingAppointment.resource.appointment_type_name || '',
        appointment_time: formatAppointmentTimeRange(
          deletingAppointment.start,
          deletingAppointment.end,
        ),
        therapist_name: deletingAppointment.resource.practitioner_name || '',
        patient_name: deletingAppointment.resource.patient_name || '',
        ...(cancellationNote.trim() && { note: cancellationNote.trim() }),
      });

      setCancellationPreviewMessage(response.preview_message);
      setDeleteStep('preview');
    } catch (error) {
      logger.error('Error generating cancellation preview:', error);
      const errorMessage = getErrorMessage(error);
      await alert(`無法產生預覽訊息：${errorMessage}`, '錯誤');
      // Stay on note step so user can retry
    } finally {
      setCancellationPreviewLoading(false);
    }
  }, [deletingAppointment, cancellationNote, alert]);

  // Handle final confirmation to delete/cancel appointment
  const handleConfirmDelete = useCallback(async () => {
    if (!deletingAppointment || !deletingAppointment.resource.calendar_event_id) return;

    try {
      // Note: cancelClinicAppointment API uses calendar_event_id despite parameter name
      await apiService.cancelClinicAppointment(
        deletingAppointment.resource.calendar_event_id,
        cancellationNote.trim() || undefined,
      );

      // Note: Availability cache is now handled by React Query automatically

      // Invalidate calendar events cache for the clinic
      invalidateCalendarEventsForAppointment(
        queryClient,
        user?.active_clinic_id
      );

      setDeletingAppointment(null);
      setCancellationNote('');
      setCancellationPreviewMessage('');
      setDeleteStep(null);
      await alert('預約已取消');
    } catch (error) {
      logger.error('Error deleting appointment:', error);
      const errorMessage = getErrorMessage(error);
      await alert(`取消預約失敗：${errorMessage}`, '錯誤');
      // Stay on preview step so user can retry or go back
    }
  }, [deletingAppointment, cancellationNote, alert]);

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
    } else {
      // No view parameter - default to day view and update URL for consistency
      setView(CalendarViews.DAY);
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.set('view', 'day');
      setSearchParams(newSearchParams, { replace: true }); // Use replace to avoid history entry
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

  // Initialize selection state - only run when all data is ready
  useEffect(() => {
    if (dataReady.practitioners && dataReady.resources && dataReady.user && !isInitialized) {
      try {
        // Load persisted state
        const persistedState = calendarStorage.getCalendarState(user!.user_id, user!.active_clinic_id);

      // Check if URL parameters are present (should take precedence)
      const urlViewParam = searchParams.get('view');
      const urlDateParam = searchParams.get('date');

      if (persistedState) {
        // Set view - URL takes precedence, then localStorage
        if (!urlViewParam) {
          // No URL view param, use localStorage preference
          setView(persistedState.view === 'month' ? CalendarViews.MONTH :
                  persistedState.view === 'week' ? CalendarViews.WEEK : CalendarViews.DAY);
        }
        // If URL has view param, component state was already set by URL effect, just sync localStorage
        if (urlViewParam && ['day', 'week', 'month'].includes(urlViewParam)) {
          calendarStorage.setCalendarState(user!.user_id, user!.active_clinic_id, {
            ...persistedState,
            view: urlViewParam as 'day' | 'week' | 'month'
          });
        }

        // Set date - URL takes precedence, then localStorage
        if (!urlDateParam && persistedState.currentDate) {
          // No URL date param, use localStorage
          setCurrentDate(new Date(persistedState.currentDate));
        }
        // If URL has date param, component state was already set by URL effect, just sync localStorage
        if (urlDateParam) {
          try {
            const parsedDate = new Date(urlDateParam);
            if (!isNaN(parsedDate.getTime())) {
              calendarStorage.setCalendarState(user!.user_id, user!.active_clinic_id, {
                ...persistedState,
                currentDate: urlDateParam
              });
            }
          } catch (error) {
            logger.warn('Invalid date parameter for localStorage sync:', urlDateParam);
          }
        }

        try {
          // Validate and set practitioners (limit to MAX_PRACTITIONERS)
          if (persistedState?.additionalPractitionerIds && Array.isArray(persistedState.additionalPractitionerIds)) {
            const validPractitioners = persistedState.additionalPractitionerIds
              .filter(id => typeof id === 'number' && practitioners.some(p => p.id === id))
              .slice(0, MAX_PRACTITIONERS);
            setSelectedPractitioners(validPractitioners);
          }

          // Validate and set resources (limit to MAX_RESOURCES)
          const resourceState = calendarStorage.getResourceSelection(user!.user_id, user!.active_clinic_id);
          if (Array.isArray(resourceState)) {
            const validResources = resourceState
              .filter(id => typeof id === 'number' && resources.some(r => r.id === id))
              .slice(0, MAX_RESOURCES);
            setSelectedResources(validResources);
          }
        } catch (error) {
          logger.error('Failed to initialize calendar selections:', error);
          // Fallback to empty selections on error
          setSelectedPractitioners([]);
          setSelectedResources([]);
        }
      } else {
        // No persisted state - sync current URL params to localStorage if present
        if (urlViewParam && ['day', 'week', 'month'].includes(urlViewParam)) {
          const newState = {
            view: urlViewParam as 'day' | 'week' | 'month',
            currentDate: urlDateParam || getDateString(currentDate),
            additionalPractitionerIds: selectedPractitioners,
            defaultPractitionerId: null
          };
          calendarStorage.setCalendarState(user!.user_id, user!.active_clinic_id, newState);
        }

        // Default: select first available practitioner
        if (practitioners.length > 0 && practitioners[0]) {
          setSelectedPractitioners([practitioners[0].id]);
        }
      }
      setLoading(false);
      setInitialLoadComplete(true);
      setIsInitialized(true);
      } catch (error) {
        logger.error('Failed to initialize calendar:', error);
        // Fallback: reset to defaults on error
        setSelectedPractitioners([]);
        setSelectedResources([]);
        setLoading(false);
        setInitialLoadComplete(true);
        setIsInitialized(true);
      }
    }
  }, [dataReady, isInitialized, user?.user_id, user?.active_clinic_id, practitioners, resources]);

  // Load calendar events with caching

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

  // Persist selection changes (only after initialization)
  React.useEffect(() => {
    if (user?.user_id && user?.active_clinic_id && isInitialized) {
      try {
        // Persist practitioners to calendar state
        const currentState = calendarStorage.getCalendarState(user.user_id, user.active_clinic_id);
        const defaultDate = new Date().toISOString().split('T')[0];
        const updatedState = {
          view: (currentState?.view || 'day') as 'month' | 'week' | 'day',
          currentDate: (currentState?.currentDate ?? defaultDate) as string,
          additionalPractitionerIds: selectedPractitioners,
          defaultPractitionerId: currentState?.defaultPractitionerId || null,
        };
        calendarStorage.setCalendarState(user.user_id, user.active_clinic_id, updatedState);

        // Persist resources separately
        calendarStorage.setResourceSelection(user.user_id, user.active_clinic_id, selectedResources);
      } catch (error) {
        logger.error('Failed to persist calendar selections:', error);
        // Continue execution - don't break the UI due to storage failures
      }
    }
  }, [user?.user_id, user?.active_clinic_id, selectedPractitioners, selectedResources, isInitialized]);

  const handleEventClick = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event);
    setIsEventModalOpen(true);
  }, []);

  const handleSlotClick = useCallback(() => {
    setIsCreateAppointmentModalOpen(true);
  }, []);

  const handleCreateAppointment = useCallback(() => {
    setIsCreateAppointmentModalOpen(true);
  }, []);

  const handleCreateException = useCallback(() => {
    // Reset exception data to current date defaults
    setExceptionData({
      date: getDateString(currentDate),
      startTime: '00:00',
      endTime: '23:00'
    });
    setIsFullDay(false);
    setIsExceptionModalOpen(true);
  }, [currentDate]);

  const handleToday = useCallback(() => {
    const today = new Date();
    setCurrentDate(today);
    handleDateChange(today);
    // No auto-scroll for today button - user controls their own scrolling
  }, [handleDateChange]);

  const handleSettings = useCallback(() => {
    setSidebarOpen(!sidebarOpen);
  }, [sidebarOpen]);

  // Show loading spinner during initial load, but not for subsequent event fetches after initial load is complete
  if (loading || practitionersLoading || (eventsLoading && !initialLoadComplete)) {
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
    <>
      <CalendarLayout
        sidebar={
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
        }
        dateStrip={
          <CalendarDateStrip
            view={view}
            currentDate={currentDate}
            onDateChange={handleDateChange}
            onCreateAppointment={handleCreateAppointment}
            onCreateException={handleCreateException}
            onToday={handleToday}
            onSettings={handleSettings}
          />
        }
        practitionerRow={
          <PractitionerRow
            view={view}
            currentDate={currentDate}
            events={allEvents}
            selectedPractitioners={selectedPractitioners}
            selectedResources={selectedResources}
            practitioners={practitioners}
            resources={resources}
            practitionerAvailability={practitionerAvailability}
            onEventClick={handleEventClick}
            onSlotClick={handleSlotClick}
          />
        }
        calendarGrid={
          <CalendarGrid
            view={view}
            currentDate={currentDate}
            events={allEvents}
            selectedPractitioners={selectedPractitioners}
            selectedResources={selectedResources}
            practitioners={practitioners}
            resources={resources}
            practitionerAvailability={practitionerAvailability}
            onEventClick={handleEventClick}
            onSlotClick={handleSlotClick}
            showHeaderRow={false}
          />
        }
      />

      {/* Modal Components */}
    {isEventModalOpen && selectedEvent && (
        <EventModal
          event={selectedEvent}
          onClose={() => {
            setIsEventModalOpen(false);
            setSelectedEvent(null);
          }}
          onEditAppointment={
            canEditEvent(selectedEvent) &&
            selectedEvent?.resource.type === "appointment"
              ? () => {
                  setIsEventModalOpen(false);
                  setIsEditAppointmentModalOpen(true);
                }
              : undefined
          }
          onDeleteAppointment={
            canEditEvent(selectedEvent) &&
            selectedEvent?.resource.type === "appointment"
              ? handleDeleteAppointment
              : undefined
          }
          onDeleteException={
            canEditEvent(selectedEvent) &&
            selectedEvent?.resource.type === "availability_exception"
              ? handleDeleteException
              : undefined
          }
          onDuplicateAppointment={
            canDuplicateAppointment(selectedEvent!)
              ? handleDuplicateAppointment
              : undefined
          }
          formatAppointmentTime={formatAppointmentTimeRange}
          appointmentTypes={appointmentTypes}
          practitioners={practitioners}
          onEventNameUpdated={async (updateTrigger) => {
            // Invalidate calendar events to refresh appointment data after modifications
            try {
              if (queryClient && user?.active_clinic_id) {
                invalidateCalendarEventsForAppointment(queryClient, user.active_clinic_id);
              }

              // If called with null, it means the event data changed (e.g., after checkout)
              // Fetch fresh appointment data and update the selectedEvent
              if (updateTrigger === null && selectedEvent?.resource.appointment_id) {
                try {
                  const appointmentData = await apiService.getAppointmentDetails(selectedEvent.resource.appointment_id);

                  // Update the event with fresh appointment data
                  const updatedEvent = updateCalendarEventWithAppointmentData(selectedEvent, appointmentData);
                  setSelectedEvent(updatedEvent);
                } catch (fetchError) {
                  // Failed to fetch updated appointment data - close modal as fallback
                  // to ensure user sees fresh data when reopened
                  setIsEventModalOpen(false);
                  setSelectedEvent(null);
                }
              }
            } catch (error) {
              // Cache invalidation failed - this is non-critical for user experience
              // The calendar will still function, just with potentially stale data
            }
          }}
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
              // Calculate appointment date from start_time
              const appointmentDate = formData.start_time.split('T')[0];

              // Use optimistic update mutation
              const [, timePart] = formData.start_time.split('T');
              const mutationParams: any = {
                practitionerId: formData.practitioner_id,
                appointmentTypeId: formData.appointment_type_id,
                date: appointmentDate,
                startTime: timePart || '00:00:00', // Extract time part with fallback
                patientId: formData.patient_id,
              };
              if (formData.clinic_notes) {
                mutationParams.clinicNotes = formData.clinic_notes;
              }
              await createAppointmentMutation.mutateAsync(mutationParams);

              setIsCreateAppointmentModalOpen(false);
              await alert('預約已建立');
            } catch (error) {
              logger.error('Failed to create appointment:', error);
              const errorMessage = getErrorMessage(error);
              await alert(`預約建立失敗：${errorMessage}`, '錯誤');
            }
          }}
        />
      )}

      {/* Duplicate Appointment Modal */}
      {isCreateModalOpen && duplicateData && (
        <CreateAppointmentModal
          key={`create-${createModalKey}`}
          {...(duplicateData.event?.resource.patient_id !== undefined && { preSelectedPatientId: duplicateData.event.resource.patient_id })}
          {...(duplicateData.initialDate !== undefined && { initialDate: duplicateData.initialDate })}
          {...(duplicateData.preSelectedAppointmentTypeId !== undefined && { preSelectedAppointmentTypeId: duplicateData.preSelectedAppointmentTypeId })}
          {...(duplicateData.preSelectedPractitionerId !== undefined && { preSelectedPractitionerId: duplicateData.preSelectedPractitionerId })}
          {...(duplicateData.preSelectedTime !== undefined && { preSelectedTime: duplicateData.preSelectedTime })}
          {...(duplicateData.preSelectedClinicNotes !== undefined && { preSelectedClinicNotes: duplicateData.preSelectedClinicNotes })}
          {...(duplicateData.event !== undefined && { event: duplicateData.event })}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            setIsCreateModalOpen(false);
            setDuplicateData(null);
          }}
          onConfirm={async (formData) => {
            try {
              // Security check: Validate user has permission to create this appointment
              // Note: We can't use canEditEvent() here since we don't have an event object
              // Instead, check if user has general appointment creation permissions
              if (!canEdit) {
                await alert("您沒有權限建立預約", "錯誤");
                return;
              }

              // Calculate appointment date from start_time
              const appointmentDate = formData.start_time.split('T')[0];

              // Use optimistic update mutation
              const [, timePart] = formData.start_time.split('T');
              const mutationParams: any = {
                practitionerId: formData.practitioner_id,
                appointmentTypeId: formData.appointment_type_id,
                date: appointmentDate,
                startTime: timePart || '00:00:00', // Extract time part with fallback
                patientId: formData.patient_id,
              };
              if (formData.clinic_notes) {
                mutationParams.clinicNotes = formData.clinic_notes;
              }
              await createAppointmentMutation.mutateAsync(mutationParams);

              setIsCreateModalOpen(false);
              setDuplicateData(null);
              await alert('預約已建立');
            } catch (error) {
              logger.error('Error creating duplicate appointment:', error);
              const errorMessage = getErrorMessage(error);
              await alert(`複製預約失敗：${errorMessage}`, '錯誤');
            }
          }}
          onRecurringAppointmentsCreated={async () => {
            // Invalidate calendar events cache
            invalidateCalendarEventsForAppointment(queryClient, user?.active_clinic_id);
          }}
        />
      )}

      {/* Cancellation Note Modal (for appointment deletion) */}
      {deletingAppointment && deleteStep === 'note' && (
        <CancellationNoteModal
          cancellationNote={cancellationNote}
          isLoading={cancellationPreviewLoading}
          onNoteChange={setCancellationNote}
          onBack={() => {
            setDeletingAppointment(null);
            setDeleteStep(null);
            setCancellationNote('');
          }}
          onSubmit={handleCancellationNoteSubmit}
        />
      )}

      {/* Cancellation Preview Modal (for appointment deletion) */}
      {deletingAppointment && deleteStep === 'preview' && (
        <CancellationPreviewModal
          previewMessage={cancellationPreviewMessage}
          onBack={() => setDeleteStep('note')}
          onConfirm={handleConfirmDelete}
        />
      )}

      {isExceptionModalOpen && (
        <ExceptionModal
          exceptionData={exceptionData}
          isFullDay={isFullDay}
          onClose={() => setIsExceptionModalOpen(false)}
          onCreate={async () => {
            logger.info('Creating availability exception:', { exceptionData, isFullDay, userId: user?.user_id });

            if (!user?.user_id) {
              logger.error('Cannot create exception: user not authenticated');
              await alert('無法建立休診時段：用戶未認證', '錯誤');
              return;
            }

            try {
              // Prepare the exception request data
              const requestData: AvailabilityExceptionRequest = {
                date: exceptionData.date,
                start_time: isFullDay ? null : exceptionData.startTime,
                end_time: isFullDay ? null : exceptionData.endTime,
              };

              logger.info('Sending exception request to API:', requestData);

              // Call the API to create the exception
              const response = await apiService.createAvailabilityException(user.user_id, requestData);

              logger.info('Availability exception created successfully:', response);

              // Close the modal
              setIsExceptionModalOpen(false);

              // Invalidate calendar events cache to refresh the view
              invalidateCalendarEventsForAppointment(queryClient, user?.active_clinic_id);

              await alert('休診時段已建立');
            } catch (error) {
              logger.error('Failed to create availability exception:', error);
              const errorMessage = getErrorMessage(error);
              await alert(`建立休診時段失敗：${errorMessage}`, '錯誤');
            }
          }}
          onExceptionDataChange={setExceptionData}
          onFullDayChange={setIsFullDay}
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
            // Invalidate calendar events cache for the clinic
            invalidateCalendarEventsForAppointment(
              queryClient,
              user?.active_clinic_id
            );
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

              // Note: Availability cache is now handled by React Query automatically

              // Invalidate calendar events cache for the clinic
              invalidateCalendarEventsForAppointment(
                queryClient,
                user?.active_clinic_id
              );

              setIsEditAppointmentModalOpen(false);
              setSelectedEvent(null);
              await alert('預約已更新');
            } catch (error) {
              logger.error('Failed to update appointment:', error);
              const errorMessage = getErrorMessage(error);
              await alert(`預約更新失敗：${errorMessage}`, '錯誤');
            }
          }}
          formatAppointmentTime={formatAppointmentTimeRange}
        />
      )}

      {/* Cancellation Modals */}

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

            // Note: Availability cache is now handled by React Query automatically
            // React Query will automatically handle cache invalidation for checkout operations

            setIsCheckoutModalOpen(false);
            setSelectedEvent(null);
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
    </>
  );
};

export default AvailabilityPage;