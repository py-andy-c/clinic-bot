import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useApiData } from '../hooks/useApiData';
import { useIsMobile } from '../hooks/useIsMobile';
import { useCalendarSelection } from '../hooks/useCalendarSelection';
import { LoadingSpinner } from '../components/shared';
import { View } from 'react-big-calendar';
import CalendarView from '../components/CalendarView';
import PageHeader from '../components/PageHeader';
import CalendarSelector from '../components/CalendarSelector';
import PractitionerChips from '../components/PractitionerChips';
import ResourceChips from '../components/ResourceChips';
import FloatingActionButton from '../components/FloatingActionButton';
import { sharedFetchFunctions, apiService } from '../services/api';
import { calendarStorage } from '../utils/storage';
import { getDateString } from '../utils/calendarUtils';
import { logger } from '../utils/logger';
import { Resource } from '../types';

const AvailabilityPage: React.FC = () => {
  const { user, isPractitioner, isLoading: authLoading, isAuthenticated } = useAuth();
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [addExceptionHandler, setAddExceptionHandler] = useState<(() => void) | null>(null);
  const [additionalPractitionerIds, setAdditionalPractitionerIds] = useState<number[]>([]);
  const [defaultPractitionerId, setDefaultPractitionerId] = useState<number | null>(null);
  const [showPractitionerModal, setShowPractitionerModal] = useState(false);
  const [resources, setResources] = useState<Resource[]>([]);

  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Get pre-selected patient ID from query parameter
  const preSelectedPatientId = searchParams.get('createAppointment') 
    ? parseInt(searchParams.get('createAppointment') || '0', 10) 
    : undefined;

  // Use shared fetch function for cache key consistency
  const fetchPractitionersFn = sharedFetchFunctions.getPractitioners;

  // Use useApiData for practitioners with caching and request deduplication
  // Include active_clinic_id in dependencies to refetch when clinic changes
  const { data: practitionersData, loading: practitionersLoading } = useApiData(
    fetchPractitionersFn,
    {
      enabled: !authLoading && isAuthenticated,
      dependencies: [authLoading, isAuthenticated, user?.active_clinic_id],
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );

  const practitioners = practitionersData || [];
  
  // Load resources for resource selector
  const [resourcesLoading, setResourcesLoading] = useState(false);
  
  useEffect(() => {
    const loadResources = async () => {
      try {
        setResourcesLoading(true);
        
        // Fetch all resource types
        const resourceTypesResponse = await apiService.getResourceTypes();
        const resourceTypes = resourceTypesResponse.resource_types;

        // Fetch all resources for each type
        const allResources: Resource[] = [];
        for (const resourceType of resourceTypes) {
          try {
            const resourcesResponse = await apiService.getResources(resourceType.id);
            // Filter out deleted resources
            const activeResources = resourcesResponse.resources
              .filter(r => !r.is_deleted);
            allResources.push(...activeResources);
          } catch (err) {
            logger.error(`Failed to load resources for type ${resourceType.id}:`, err);
          }
        }

        setResources(allResources);
      } catch (err) {
        logger.error('Failed to load resources:', err);
      } finally {
        setResourcesLoading(false);
      }
    };

    if (isAuthenticated && !authLoading) {
      loadResources();
    }
  }, [isAuthenticated, authLoading, user?.active_clinic_id]);

  // Use unified hook for resource selection persistence
  const {
    selectedIds: selectedResourceIds,
    setSelectedIds: setSelectedResourceIds,
  } = useCalendarSelection({
    items: resources,
    userId: user?.user_id,
    clinicId: user?.active_clinic_id ?? null,
    validateItem: (resource) => !resource.is_deleted,
    storageType: 'resources',
    waitForAllItems: false, // Resources load all at once, no race condition
  });
  
  // Track if we've loaded persisted state to avoid overwriting with defaults
  const hasLoadedPersistedStateRef = useRef(false);
  // Track if persisted state had a default practitioner to prevent default handler from overriding
  const persistedStateHadDefaultPractitionerRef = useRef(false);
  // Track previous clinic ID to reset persistence flags when clinic changes
  const previousClinicIdForPractitionersRef = useRef<number | null>(null);

  // Load persisted calendar state on mount (after user and practitioners are available)
  // This must run before the default practitioner handler
  useEffect(() => {
    // Reset persistence flags when clinic changes
    if (user?.active_clinic_id !== previousClinicIdForPractitionersRef.current && previousClinicIdForPractitionersRef.current !== null) {
      hasLoadedPersistedStateRef.current = false;
      persistedStateHadDefaultPractitionerRef.current = false;
    }
    previousClinicIdForPractitionersRef.current = user?.active_clinic_id ?? null;
    
    if (!user?.user_id || !user?.active_clinic_id || practitioners.length === 0 || hasLoadedPersistedStateRef.current) {
      return;
    }

    const persistedState = calendarStorage.getCalendarState(user.user_id, user.active_clinic_id);
    
    if (persistedState) {
      // Filter out invalid practitioners (those that no longer exist)
      const validPractitionerIds = persistedState.additionalPractitionerIds.filter(id =>
        practitioners.some(p => p.id === id)
      );
      
      // If we filtered out IDs but the persisted state had IDs, practitioners might still be loading.
      // Don't mark as loaded yet - wait for practitioners array to grow to avoid overwriting persisted state.
      // Only mark as loaded if all persisted IDs are valid OR persisted state had no IDs to begin with.
      const allPersistedIdsAreValid = validPractitionerIds.length === persistedState.additionalPractitionerIds.length;
      const hadNoPersistedIds = persistedState.additionalPractitionerIds.length === 0;
      
      if (!allPersistedIdsAreValid && !hadNoPersistedIds) {
        // Don't set state or mark as loaded - let it re-run when more practitioners load
        return;
      }
      
      // Validate default practitioner exists
      const validDefaultPractitionerId = persistedState.defaultPractitionerId && 
        practitioners.some(p => p.id === persistedState.defaultPractitionerId)
        ? persistedState.defaultPractitionerId
        : null;

      setAdditionalPractitionerIds(validPractitionerIds);
      
      // Only set default practitioner if user is not a practitioner
      if (!isPractitioner) {
        if (validDefaultPractitionerId) {
          setDefaultPractitionerId(validDefaultPractitionerId);
          persistedStateHadDefaultPractitionerRef.current = true;
        } else if (practitioners.length > 0) {
          // Fallback to first practitioner if persisted one doesn't exist
          setDefaultPractitionerId(practitioners[0]!.id);
          persistedStateHadDefaultPractitionerRef.current = false;
        }
      }
      
      hasLoadedPersistedStateRef.current = true;
    } else {
      // No persisted state - will be handled by default practitioner handler
      hasLoadedPersistedStateRef.current = true;
      persistedStateHadDefaultPractitionerRef.current = false;
    }
  }, [user?.user_id, user?.active_clinic_id, practitioners, isPractitioner]);

  // Persist state whenever it changes (after initial load)
  useEffect(() => {
    if (!user?.user_id || !user?.active_clinic_id || !hasLoadedPersistedStateRef.current) {
      return;
    }

    // Get current view and date from storage (CalendarView manages these)
    // We preserve them when saving practitioner state
    const currentState = calendarStorage.getCalendarState(user.user_id, user.active_clinic_id);
    const updatedState = {
      view: (currentState?.view || 'day') as 'month' | 'week' | 'day',
      // Preserve current date from storage, or use today's date if not available
      currentDate: currentState?.currentDate || getDateString(new Date()),
      additionalPractitionerIds,
      defaultPractitionerId,
    };
    calendarStorage.setCalendarState(user.user_id, user.active_clinic_id, updatedState);
    // Resource selection is now handled by useCalendarSelection hook
  }, [user?.user_id, user?.active_clinic_id, additionalPractitionerIds, defaultPractitionerId]);

  // Determine which practitioner IDs to display
  const displayedPractitionerIds = React.useMemo(() => {
    const ids: number[] = [];
    
    // Always include current user if they're a practitioner
    if (isPractitioner && user?.user_id) {
      ids.push(user.user_id);
    }
    
    // Add default practitioner if user is not a practitioner
    if (!isPractitioner && defaultPractitionerId) {
      ids.push(defaultPractitionerId);
    }
    
    // Add additional selected practitioners
    additionalPractitionerIds.forEach((id) => {
      if (!ids.includes(id)) {
        ids.push(id);
      }
    });
    
    return ids;
  }, [isPractitioner, user?.user_id, defaultPractitionerId, additionalPractitionerIds]);

  // Handle default practitioner for non-practitioners when practitioners data loads
  // Only runs if persisted state didn't set a default practitioner
  useEffect(() => {
    // Skip if we haven't loaded persisted state yet, or if persisted state already set a default
    if (!hasLoadedPersistedStateRef.current || persistedStateHadDefaultPractitionerRef.current) {
      return;
    }

    if (!isPractitioner && practitioners.length > 0) {
      // Check if current default practitioner still exists
      if (defaultPractitionerId && practitioners.some(p => p.id === defaultPractitionerId)) {
        // Keep current default if it still exists
        // No change needed
      } else {
        // Default practitioner was removed or doesn't exist, set to first available
        const firstPractitioner = practitioners[0];
        if (firstPractitioner) {
          setDefaultPractitionerId(firstPractitioner.id);
        }
      }
    } else if (!isPractitioner && practitioners.length === 0) {
      // No practitioners available
      setDefaultPractitionerId(null);
    }
  }, [isPractitioner, practitioners, defaultPractitionerId]);

  // Clean up additional practitioners that no longer exist
  useEffect(() => {
    if (practitioners.length > 0) {
      setAdditionalPractitionerIds(prev => 
        prev.filter(id => practitioners.some(p => p.id === id))
      );
    }
  }, [practitioners]);

  useEffect(() => {
    if (user?.user_id) {
      setLoading(false);
    }
  }, [user]);

  const handleAddExceptionHandlerReady = useCallback((handler: () => void, _view: View) => {
    setAddExceptionHandler(() => handler);
  }, []);

  // Handler for create appointment button
  const handleCreateAppointment = useCallback(() => {
    // Trigger create appointment modal in CalendarView
    (window as any).__calendarCreateAppointment?.();
  }, []);

  if (loading || practitionersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  // Determine the primary user ID for calendar display
  // If user is practitioner, use their ID; otherwise use default practitioner
  const primaryUserId = isPractitioner && user?.user_id
    ? user.user_id
    : defaultPractitionerId;

  return (
    <>
      {/* Practitioner Chips - Mobile only, show below header */}
      {isMobile && practitioners.length > 0 && additionalPractitionerIds.length > 0 && (
        <PractitionerChips
          practitioners={practitioners}
          selectedPractitionerIds={additionalPractitionerIds}
          currentUserId={user?.user_id || null}
          isPractitioner={isPractitioner || false}
          primaryUserId={primaryUserId || null}
          onRemove={(id) => setAdditionalPractitionerIds(prev => prev.filter(pid => pid !== id))}
        />
      )}

      {/* Resource Chips - Mobile only, show below header */}
      {isMobile && !resourcesLoading && resources.length > 0 && selectedResourceIds.length > 0 && (
        <ResourceChips
          resources={resources}
          selectedResourceIds={selectedResourceIds}
          onRemove={(id) => setSelectedResourceIds(prev => prev.filter(rid => rid !== id))}
          allPractitionerIds={displayedPractitionerIds}
          primaryUserId={primaryUserId}
        />
      )}

      {/* Header - Hide title on mobile */}
      <PageHeader
        title={isMobile ? "" : "行事曆"}
        action={
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-4 w-full md:w-auto">
            {/* Calendar Selector - Desktop only (combines practitioners and resources) */}
            {(practitioners.length > 0 || (!resourcesLoading && resources.length > 0)) && (
              <div className="desktop-only w-full md:w-auto">
                <CalendarSelector
                  practitioners={practitioners}
                  selectedPractitionerIds={additionalPractitionerIds}
                  currentUserId={user?.user_id || null}
                  isPractitioner={isPractitioner || false}
                  onPractitionerChange={setAdditionalPractitionerIds}
                  resources={resources}
                  selectedResourceIds={selectedResourceIds}
                  onResourceChange={setSelectedResourceIds}
                  maxSelectablePractitioners={5}
                  maxSelectableResources={10}
                />
              </div>
            )}
            
            {/* Create Appointment button - hide on mobile (moved to FAB) */}
            {!isMobile && (
              <button
                onClick={handleCreateAppointment}
                className="w-full md:w-auto inline-flex items-center justify-center rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 whitespace-nowrap"
                data-testid="create-appointment-button"
              >
                新增預約
              </button>
            )}
            
            {/* Add Unavailable Time button - only show for practitioners, hide on mobile (moved to FAB) */}
            {!isMobile && addExceptionHandler && isPractitioner && (
              <button
                onClick={addExceptionHandler}
                className="w-full md:w-auto inline-flex items-center justify-center rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 whitespace-nowrap"
              >
                新增休診時段
              </button>
            )}
          </div>
        }
      />

      {/* Calendar View - Full width on mobile, constrained on desktop */}
      <div className="-mx-4 sm:-mx-6 md:mx-0 -my-2 md:-my-6">
        {primaryUserId && (
          <CalendarView
            userId={primaryUserId}
            additionalPractitionerIds={displayedPractitionerIds.filter(id => id !== primaryUserId)}
            practitioners={practitioners}
            resourceIds={selectedResourceIds}
            resources={resources}
            onAddExceptionHandlerReady={handleAddExceptionHandlerReady}
            {...(preSelectedPatientId !== undefined ? { preSelectedPatientId } : {})}
          />
        )}
        {!primaryUserId && practitioners.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg mb-2">目前沒有可用的治療師</p>
            <p className="text-sm">請先新增治療師到診所</p>
          </div>
        )}

        {/* Floating Action Button - Mobile only */}
        {isMobile && (
        <FloatingActionButton
          items={[
            {
              id: 'create-appointment',
              label: '新增預約',
              onClick: handleCreateAppointment,
              color: 'green' as const,
              icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              ),
            },
            ...(addExceptionHandler && isPractitioner ? [{
              id: 'add-exception',
              label: '新增休診時段',
              onClick: addExceptionHandler,
              color: 'blue' as const,
              icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
            }] : []),
            ...((practitioners.length > 0 || (!resourcesLoading && resources.length > 0)) ? [{
              id: 'add-calendar',
              label: '加入行事曆',
              onClick: () => setShowPractitionerModal(true),
              color: 'purple' as const,
              icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              ),
            }] : []),
          ]}
        />
        )}
      </div>

      {/* Calendar Selector Modal - Mobile only */}
      {isMobile && showPractitionerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={() => setShowPractitionerModal(false)}>
          <div className="bg-white rounded-lg w-full md:w-auto md:max-w-md max-h-[80vh] flex flex-col mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex-shrink-0 bg-white border-b px-4 py-3 flex justify-between items-center z-10 rounded-t-lg">
              <h2 className="text-lg font-semibold">加入行事曆</h2>
              <button
                onClick={() => setShowPractitionerModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                aria-label="關閉"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <CalendarSelector
                practitioners={practitioners}
                selectedPractitionerIds={additionalPractitionerIds}
                currentUserId={user?.user_id || null}
                isPractitioner={isPractitioner || false}
                onPractitionerChange={setAdditionalPractitionerIds}
                resources={resources}
                selectedResourceIds={selectedResourceIds}
                onResourceChange={setSelectedResourceIds}
                maxSelectablePractitioners={5}
                maxSelectableResources={10}
                showAsList={true}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AvailabilityPage;