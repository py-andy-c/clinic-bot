import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { View } from 'react-big-calendar';
import CalendarView from '../components/CalendarView';

const AvailabilityPage: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [addExceptionHandler, setAddExceptionHandler] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (user?.user_id) {
      setLoading(false);
    }
  }, [user]);

  const handleAddExceptionHandlerReady = useCallback((handler: () => void, _view: View) => {
    setAddExceptionHandler(() => handler);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-full md:max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-4 md:mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">行事曆</h1>
        {addExceptionHandler && (
          <button
            onClick={addExceptionHandler}
            className="inline-flex items-center rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            新增休診時段
          </button>
        )}
      </div>

      {/* Calendar View */}
      <div className="bg-white md:rounded-lg md:shadow-md p-2 md:p-6">
        {user?.user_id && (
          <CalendarView 
            userId={user.user_id} 
            onAddExceptionHandlerReady={handleAddExceptionHandlerReady}
          />
        )}
      </div>
    </div>
  );
};

export default AvailabilityPage;