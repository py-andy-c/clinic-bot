import React, { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiData } from '../hooks/useApiData';
import { apiService } from '../services/api';
import { PatientStatsSection } from '../components/dashboard/PatientStatsSection';
import { AppointmentStatsSection } from '../components/dashboard/AppointmentStatsSection';
import { MessageStatsSection } from '../components/dashboard/MessageStatsSection';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { useAuth } from '../hooks/useAuth';
import PageHeader from '../components/PageHeader';

const ClinicDashboardPage: React.FC = () => {
  const { isLoading: authLoading, isAuthenticated, user, isClinicAdmin } = useAuth();
  const navigate = useNavigate();

  // Redirect non-admin users
  useEffect(() => {
    if (!authLoading && isAuthenticated && !isClinicAdmin) {
      navigate('/admin/clinic/members', { replace: true });
    }
  }, [authLoading, isAuthenticated, isClinicAdmin, navigate]);

  const fetchDashboardMetrics = useCallback(() => apiService.getDashboardMetrics(), []);

  const { data, loading, error } = useApiData(fetchDashboardMetrics, {
    enabled: !authLoading && isAuthenticated && isClinicAdmin,
    dependencies: [authLoading, isAuthenticated, isClinicAdmin, user?.active_clinic_id],
    defaultErrorMessage: '無法載入儀表板數據',
    cacheTTL: 2 * 60 * 1000, // 2 minutes cache
  });

  // Don't render anything if not admin (will redirect)
  if (!authLoading && isAuthenticated && !isClinicAdmin) {
    return null;
  }

  if (loading && !data) {
    return (
      <LoadingSpinner size="xl" />
    );
  }

  if (error) {
    return (
      <ErrorMessage message={error} />
    );
  }

  if (!data) {
    return null;
  }

  return (
    <>
      {/* Page Header */}
      <PageHeader title="儀表板" />

        {/* Patient Statistics Section */}
        <PatientStatsSection
          activePatients={data.active_patients_by_month}
          newPatients={data.new_patients_by_month}
        />

        {/* Appointment Statistics Section */}
        <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
          <AppointmentStatsSection
            appointments={data.appointments_by_month}
            cancellations={data.cancellation_rate_by_month}
            appointmentTypes={data.appointment_type_stats_by_month}
            practitioners={data.practitioner_stats_by_month}
          />
        </div>

        {/* Message Statistics Section */}
        <div className="pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
          <MessageStatsSection
            paidMessages={data.paid_messages_by_month}
            aiReplies={data.ai_reply_messages_by_month}
          />
        </div>
    </>
  );
};

export default ClinicDashboardPage;

