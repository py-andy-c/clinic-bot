import React, { useCallback } from 'react';
import { useApiData } from '../hooks/useApiData';
import { apiService } from '../services/api';
import { PatientStatsSection } from '../components/dashboard/PatientStatsSection';
import { AppointmentStatsSection } from '../components/dashboard/AppointmentStatsSection';
import { MessageStatsSection } from '../components/dashboard/MessageStatsSection';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { useAuth } from '../hooks/useAuth';

const ClinicDashboardPage: React.FC = () => {
  const { isLoading: authLoading, isAuthenticated, user } = useAuth();

  const fetchDashboardMetrics = useCallback(() => apiService.getDashboardMetrics(), []);

  const { data, loading, error } = useApiData(fetchDashboardMetrics, {
    enabled: !authLoading && isAuthenticated,
    dependencies: [authLoading, isAuthenticated, user?.active_clinic_id],
    defaultErrorMessage: '無法載入儀表板數據',
    cacheTTL: 2 * 60 * 1000, // 2 minutes cache
  });

  if (loading && !data) {
    return (
      <div className="min-h-screen pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <LoadingSpinner size="xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <ErrorMessage message={error} />
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="min-h-screen pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">儀表板</h1>
        </div>

        {/* Patient Statistics Section */}
        <PatientStatsSection
          activePatients={data.active_patients_by_month}
          newPatients={data.new_patients_by_month}
        />

        {/* Appointment Statistics Section */}
        <AppointmentStatsSection
          appointments={data.appointments_by_month}
          cancellations={data.cancellation_rate_by_month}
          appointmentTypes={data.appointment_type_stats_by_month}
          practitioners={data.practitioner_stats_by_month}
        />

        {/* Message Statistics Section */}
        <MessageStatsSection
          paidMessages={data.paid_messages_by_month}
          aiReplies={data.ai_reply_messages_by_month}
        />
      </div>
    </div>
  );
};

export default ClinicDashboardPage;

