import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useApiData } from '../hooks/useApiData';
import { useIsMobile } from '../hooks/useIsMobile';
import { LoadingSpinner } from '../components/shared';
import { View } from 'react-big-calendar';
import CalendarView from '../components/CalendarView';
import PageHeader from '../components/PageHeader';
import PractitionerSelector from '../components/PractitionerSelector';
import PractitionerChips from '../components/PractitionerChips';
import FloatingActionButton from '../components/FloatingActionButton';
import { sharedFetchFunctions } from '../services/api';

const AvailabilityPage: React.FC = () => {
  const { user, isPractitioner, isLoading: authLoading, isAuthenticated } = useAuth();
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [addExceptionHandler, setAddExceptionHandler] = useState<(() => void) | null>(null);
  const [additionalPractitionerIds, setAdditionalPractitionerIds] = useState<number[]>([]);
  const [defaultPractitionerId, setDefaultPractitionerId] = useState<number | null>(null);
  const [showPractitionerModal, setShowPractitionerModal] = useState(false);
  
  // Get pre-selected patient ID from query parameter
  const preSelectedPatientId = searchParams.get('createAppointment') 
    ? parseInt(searchParams.get('createAppointment') || '0', 10) 
    : undefined;

  // Use shared fetch function for cache key consistency
  const fetchPractitionersFn = sharedFetchFunctions.getPractitioners;

  // Use useApiData for practitioners with caching and request deduplication
  const { data: practitionersData, loading: practitionersLoading } = useApiData(
    fetchPractitionersFn,
    {
      enabled: !authLoading && isAuthenticated,
      dependencies: [authLoading, isAuthenticated],
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );

  const practitioners = practitionersData || [];

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
  useEffect(() => {
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
    <div className="max-w-full md:max-w-4xl mx-auto">
      {/* Practitioner Chips - Mobile only, show below header */}
      {isMobile && practitioners.length > 0 && additionalPractitionerIds.length > 0 && (
        <PractitionerChips
          practitioners={practitioners}
          selectedPractitionerIds={additionalPractitionerIds}
          currentUserId={user?.user_id || null}
          isPractitioner={isPractitioner || false}
          onRemove={(id) => setAdditionalPractitionerIds(prev => prev.filter(pid => pid !== id))}
        />
      )}

      {/* Header - Hide title on mobile */}
      <PageHeader
        title={isMobile ? "" : "行事曆"}
        action={
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-4 w-full md:w-auto">
            {/* Practitioner Selector - Desktop only */}
            {practitioners.length > 0 && (
              <div className="desktop-only w-full md:w-auto">
                <PractitionerSelector
                  practitioners={practitioners}
                  selectedPractitionerIds={additionalPractitionerIds}
                  currentUserId={user?.user_id || null}
                  isPractitioner={isPractitioner || false}
                  onChange={setAdditionalPractitionerIds}
                  maxSelectable={5}
                />
              </div>
            )}
            
            {/* Create Appointment button - hide on mobile (moved to FAB) */}
            {!isMobile && (
              <button
                onClick={handleCreateAppointment}
                className="w-full md:w-auto inline-flex items-center justify-center rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 whitespace-nowrap"
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

      {/* Calendar View */}
      <div className="bg-white md:rounded-lg md:shadow-md p-2 md:p-6 -mx-4 md:mx-0">
        {primaryUserId && (
          <CalendarView 
            userId={primaryUserId}
            additionalPractitionerIds={displayedPractitionerIds.filter(id => id !== primaryUserId)}
            practitioners={practitioners}
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
      </div>

      {/* Floating Action Button - Mobile only */}
      {isMobile && (
        <FloatingActionButton
          items={[
            ...(practitioners.length > 0 ? [{
              id: 'add-practitioner',
              label: '加入其他治療師',
              onClick: () => setShowPractitionerModal(true),
              color: 'purple' as const,
            }] : []),
            ...(addExceptionHandler && isPractitioner ? [{
              id: 'add-exception',
              label: '新增休診時段',
              onClick: addExceptionHandler,
              color: 'blue' as const,
            }] : []),
            {
              id: 'create-appointment',
              label: '新增預約',
              onClick: handleCreateAppointment,
              color: 'green' as const,
            },
          ]}
        />
      )}

      {/* Practitioner Selector Modal - Mobile only */}
      {isMobile && showPractitionerModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black bg-opacity-50" onClick={() => setShowPractitionerModal(false)}>
          <div className="bg-white rounded-t-lg md:rounded-lg w-full md:w-auto md:max-w-md max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b px-4 py-3 flex justify-between items-center">
              <h2 className="text-lg font-semibold">加入其他治療師</h2>
              <button
                onClick={() => setShowPractitionerModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                aria-label="關閉"
              >
                ×
              </button>
            </div>
            <div className="p-4">
              {practitioners.length > 0 && (
                <PractitionerSelector
                  practitioners={practitioners}
                  selectedPractitionerIds={additionalPractitionerIds}
                  currentUserId={user?.user_id || null}
                  isPractitioner={isPractitioner || false}
                  onChange={setAdditionalPractitionerIds}
                  maxSelectable={5}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AvailabilityPage;