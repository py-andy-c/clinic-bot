import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner } from '../components/shared';
import { View } from 'react-big-calendar';
import CalendarView from '../components/CalendarView';
import PageHeader from '../components/PageHeader';
import PractitionerSelector from '../components/PractitionerSelector';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';

const AvailabilityPage: React.FC = () => {
  const { user, isPractitioner } = useAuth();
  const [loading, setLoading] = useState(true);
  const [practitionersLoading, setPractitionersLoading] = useState(true);
  const [addExceptionHandler, setAddExceptionHandler] = useState<(() => void) | null>(null);
  const [practitioners, setPractitioners] = useState<{ id: number; full_name: string }[]>([]);
  const [additionalPractitionerIds, setAdditionalPractitionerIds] = useState<number[]>([]);
  const [defaultPractitionerId, setDefaultPractitionerId] = useState<number | null>(null);

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

  // Fetch practitioners list
  useEffect(() => {
    const fetchPractitioners = async () => {
      try {
        setPractitionersLoading(true);
        const data = await apiService.getPractitioners();
        setPractitioners(data);
        
        // Handle default practitioner for non-practitioners
        if (!isPractitioner) {
          if (data.length > 0) {
            // Check if current default practitioner still exists
            if (defaultPractitionerId && data.some(p => p.id === defaultPractitionerId)) {
              // Keep current default if it still exists
              // No change needed
            } else {
              // Default practitioner was removed or doesn't exist, set to first available
              const firstPractitioner = data[0];
              if (firstPractitioner) {
                setDefaultPractitionerId(firstPractitioner.id);
              }
            }
          } else {
            // No practitioners available
            setDefaultPractitionerId(null);
          }
        }
        
        // Clean up additional practitioners that no longer exist
        setAdditionalPractitionerIds(prev => 
          prev.filter(id => data.some(p => p.id === id))
        );
      } catch (err) {
        logger.error('Failed to fetch practitioners:', err);
      } finally {
        setPractitionersLoading(false);
      }
    };

    if (user?.user_id) {
      fetchPractitioners();
    }
  }, [user?.user_id, isPractitioner]); // Removed defaultPractitionerId to avoid unnecessary re-runs

  useEffect(() => {
    if (user?.user_id) {
      setLoading(false);
    }
  }, [user]);

  const handleAddExceptionHandlerReady = useCallback((handler: () => void, _view: View) => {
    setAddExceptionHandler(() => handler);
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
      {/* Header */}
      <PageHeader
        title="行事曆"
        action={
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-4 w-full md:w-auto">
            {/* Practitioner Selector */}
            {practitioners.length > 0 && (
              <div className="w-full md:w-auto">
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
            
            {/* Add Unavailable Time button - only show for practitioners */}
            {addExceptionHandler && isPractitioner && (
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
          />
        )}
        {!primaryUserId && practitioners.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg mb-2">目前沒有可用的治療師</p>
            <p className="text-sm">請先新增治療師到診所</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AvailabilityPage;