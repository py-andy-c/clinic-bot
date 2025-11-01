import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import CalendarView from '../components/CalendarView';

const AvailabilityPage: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.user_id) {
      setLoading(false);
    }
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">行事曆</h1>
      </div>

      {/* Calendar View */}
      <div className="bg-white rounded-lg shadow-md p-6">
        {user?.user_id && (
          <CalendarView userId={user.user_id} />
        )}
      </div>
    </div>
  );
};

export default AvailabilityPage;