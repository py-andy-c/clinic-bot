import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { usePractitioners } from '../hooks/queries';
import { LoadingSpinner } from '../components/shared';
import { View, Views } from 'react-big-calendar';
import CalendarLayout from '../components/calendar/CalendarLayout';
import CalendarSidebar from '../components/calendar/CalendarSidebar';
import CalendarDateStrip from '../components/calendar/CalendarDateStrip';
import CalendarGrid from '../components/calendar/CalendarGrid';
import { apiService } from '../services/api';
import { calendarStorage } from '../utils/storage';
import { getDateString } from '../utils/calendarUtils';
import { logger } from '../utils/logger';
import { Resource } from '../types';
import { CalendarEvent, transformToCalendarEvents } from '../utils/calendarDataAdapter';

const AvailabilityPage: React.FC = () => {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<View>(Views.DAY);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]);
  const [selectedPractitioners, setSelectedPractitioners] = useState<number[]>([]);
  const [selectedResources, setSelectedResources] = useState<number[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);

  // Use React Query for practitioners
  const { data: practitionersData, isLoading: practitionersLoading } = usePractitioners();
  const practitioners = practitionersData || [];

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
        setView(persistedState.view === 'month' ? Views.MONTH :
                persistedState.view === 'week' ? Views.WEEK : Views.DAY);
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

  // Load calendar events
  useEffect(() => {
    const loadEvents = async () => {
      if (selectedPractitioners.length === 0) return;

      try {
        // Use batch API to get events for all selected practitioners and resources
        const startDate = getDateString(currentDate);
        const endDate = startDate; // For now, just load current day

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

        setAllEvents(allEvents);
      } catch (error) {
        logger.error('Failed to load calendar events:', error);
      }
    };

    loadEvents();
  }, [selectedPractitioners, selectedResources, currentDate]);

  // Event handlers
  const handleViewChange = useCallback((newView: View) => {
    setView(newView);
    // Persist view change
    if (user?.user_id && user?.active_clinic_id) {
      calendarStorage.setCalendarState(user.user_id, user.active_clinic_id, {
        view: newView === Views.MONTH ? 'month' : newView === Views.WEEK ? 'week' : 'day',
        currentDate: getDateString(currentDate),
        additionalPractitionerIds: selectedPractitioners,
        defaultPractitionerId: null,
      });
    }
  }, [user, currentDate, selectedPractitioners]);

  const handleDateChange = useCallback((date: Date) => {
    setCurrentDate(date);
    // Persist date change
    if (user?.user_id && user?.active_clinic_id) {
      calendarStorage.setCalendarState(user.user_id, user.active_clinic_id, {
        view: view === Views.MONTH ? 'month' : view === Views.WEEK ? 'week' : 'day',
        currentDate: getDateString(date),
        additionalPractitionerIds: selectedPractitioners,
        defaultPractitionerId: null,
      });
    }
  }, [user, selectedPractitioners, view]);

  const handleEventClick = useCallback((_event: CalendarEvent) => {
    // TODO: Open event modal
  }, []);

  const handleSlotClick = useCallback((_slotInfo: { start: Date; end: Date }) => {
    // TODO: Open create appointment modal
  }, []);

  const handleCreateAppointment = useCallback(() => {
    // TODO: Open create appointment modal
  }, []);

  const handleCreateException = useCallback(() => {
    // TODO: Open create exception modal
  }, []);

  const handleToday = useCallback(() => {
    const today = new Date();
    setCurrentDate(today);
    handleDateChange(today);
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
        onToggle={() => setSidebarOpen(!sidebarOpen)}
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
        onEventClick={handleEventClick}
        onSlotClick={handleSlotClick}
      />
    </CalendarLayout>
  );
};

export default AvailabilityPage;