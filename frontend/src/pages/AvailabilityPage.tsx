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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">行事曆</h1>
        </div>
      </div>

      {/* Calendar View */}
      {user?.user_id && (
        <CalendarView userId={user.user_id} />
      )}
    </div>
  );
};

export default AvailabilityPage;