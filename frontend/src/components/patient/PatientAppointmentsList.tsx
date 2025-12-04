import React, { useState, useCallback } from 'react';
import { useApiData } from '../../hooks/useApiData';
import { apiService } from '../../services/api';
import { LoadingSpinner, ErrorMessage } from '../shared';
import moment from 'moment-timezone';
import { formatAppointmentTime } from '../../utils/calendarUtils';
import { renderStatusBadge } from '../../utils/appointmentStatus';

const TAIWAN_TIMEZONE = 'Asia/Taipei';

interface PatientAppointmentsListProps {
  patientId: number;
}

type TabType = 'future' | 'completed' | 'cancelled';

interface Appointment {
  id: number;
  patient_id: number;
  patient_name: string;
  practitioner_name: string;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: string;
  notes?: string | null;
}

export const PatientAppointmentsList: React.FC<PatientAppointmentsListProps> = ({
  patientId,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('future');

  // Fetch ALL appointments once (no filters) so we can calculate accurate counts for all tabs
  const fetchAppointments = useCallback(() => {
    return apiService.getPatientAppointments(
      patientId,
      undefined, // No status filter - get all appointments
      false // No upcoming_only filter - get all appointments
    );
  }, [patientId]);

  const { data, loading, error, refetch } = useApiData<{
    appointments: Appointment[];
  }>(
    fetchAppointments,
    {
      enabled: !!patientId,
      dependencies: [patientId], // Only depend on patientId, not activeTab
      defaultErrorMessage: '無法載入預約記錄',
      // Cache key now includes patientId via dependencies, so caching is safe
    }
  );

  const allAppointments = data?.appointments || [];

  // Get current time in Taiwan timezone for comparisons
  const nowInTaiwan = moment.tz(TAIWAN_TIMEZONE);

  // Calculate counts and filter appointments for all tabs
  // All times are interpreted as Taiwan time
  const futureAppointments = allAppointments
    .filter((apt) => {
      const startTime = moment.tz(apt.start_time, TAIWAN_TIMEZONE);
      // Use isSameOrAfter to include appointments happening exactly "now"
      return startTime.isSameOrAfter(nowInTaiwan) && apt.status === 'confirmed';
    })
    .sort((a, b) => {
      // Sort from sooner to further (ascending by start_time)
      const timeA = moment.tz(a.start_time, TAIWAN_TIMEZONE);
      const timeB = moment.tz(b.start_time, TAIWAN_TIMEZONE);
      return timeA.valueOf() - timeB.valueOf();
    });
  const completedAppointments = allAppointments.filter((apt) => {
    const startTime = moment.tz(apt.start_time, TAIWAN_TIMEZONE);
    // Use isBefore to exclude appointments happening exactly "now" (they appear in future)
    return startTime.isBefore(nowInTaiwan) && apt.status === 'confirmed';
  });
  const cancelledAppointments = allAppointments.filter(
    (apt) =>
      apt.status === 'canceled_by_patient' || apt.status === 'canceled_by_clinic'
  );

  const displayAppointments =
    activeTab === 'future'
      ? futureAppointments
      : activeTab === 'completed'
      ? completedAppointments
      : cancelledAppointments;


  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
        <ErrorMessage message={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">預約記錄</h2>

      <div className="border-b border-gray-200 mb-4">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('future')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'future'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            未來預約 ({futureAppointments.length})
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'completed'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            已完成 ({completedAppointments.length})
          </button>
          <button
            onClick={() => setActiveTab('cancelled')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'cancelled'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            已取消 ({cancelledAppointments.length})
          </button>
        </nav>
      </div>

      {displayAppointments.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>目前沒有{activeTab === 'future' ? '未來' : activeTab === 'completed' ? '已完成' : '已取消'}的預約</p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayAppointments.map((appointment) => (
            <div
              key={appointment.id}
              className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50"
            >
              <div className="flex justify-between items-start mb-2 gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900">
                    {appointment.appointment_type_name}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {formatAppointmentTime(
                      new Date(appointment.start_time),
                      new Date(appointment.end_time)
                    )}
                  </p>
                </div>
                {renderStatusBadge(appointment.status) && (
                  <div className="flex-shrink-0">{renderStatusBadge(appointment.status)}</div>
                )}
              </div>

              <div className="mt-2 space-y-1">
                <div className="flex items-center text-sm text-gray-600">
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  {appointment.practitioner_name}
                </div>

                {activeTab === 'future' && appointment.notes && (
                  <div className="text-sm text-gray-600 mt-2">
                    <span className="font-medium">備註：</span>
                    {appointment.notes}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

