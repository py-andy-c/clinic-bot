import React, { useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { EditAppointmentModal } from '../components/calendar/EditAppointmentModal';
import { useApiData } from '../hooks/useApiData';
import PageHeader from '../components/PageHeader';
import moment from 'moment-timezone';
import { CalendarEvent } from '../utils/calendarDataAdapter';

interface AutoAssignedAppointment {
  appointment_id: number;
  calendar_event_id: number;
  patient_name: string;
  patient_id: number;
  practitioner_id: number;
  practitioner_name: string;
  appointment_type_id: number;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  notes?: string | null;
  originally_auto_assigned: boolean;
}

const AutoAssignedAppointmentsPage: React.FC = () => {
  const { isClinicAdmin, user: currentUser, isAuthenticated, isLoading } = useAuth();
  const { alert } = useModal();
  const [selectedAppointment, setSelectedAppointment] = useState<AutoAssignedAppointment | null>(null);
  const [practitioners, setPractitioners] = useState<{ id: number; full_name: string }[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<{ id: number; name: string; duration_minutes: number }[]>([]);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [calendarEvent, setCalendarEvent] = useState<CalendarEvent | null>(null);

  // If not authenticated, show a message
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">需要登入</h1>
          <p className="text-gray-600">請先登入以查看自動指派預約頁面</p>
        </div>
      </div>
    );
  }

  // Only admins can access this page
  if (!isClinicAdmin) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title="自動指派預約" />
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mt-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">無權限</h3>
              <div className="mt-2 text-sm text-red-700">
                <p>只有診所管理員可以查看和管理自動指派預約。</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fetch auto-assigned appointments
  const fetchAppointments = useCallback(
    () => apiService.getAutoAssignedAppointments(),
    []
  );

  const { data: appointmentsData, loading, error, refetch } = useApiData<{
    appointments: AutoAssignedAppointment[];
  }>(
    fetchAppointments,
    {
      enabled: !isLoading && isAuthenticated && isClinicAdmin,
      dependencies: [isLoading, isAuthenticated, currentUser?.active_clinic_id],
      defaultErrorMessage: '無法載入自動指派預約列表',
      initialData: { appointments: [] },
    }
  );

  // Fetch practitioners and appointment types when modal opens
  React.useEffect(() => {
    if (isEditModalOpen) {
      const fetchData = async () => {
        try {
          const [practitionersData, settings] = await Promise.all([
            apiService.getPractitioners(),
            apiService.getClinicSettings()
          ]);
          setPractitioners(practitionersData);
          setAppointmentTypes(settings.appointment_types);
        } catch (err) {
          logger.error('Failed to fetch practitioners or appointment types:', err);
          alert('無法載入治療師或預約類型資料', '錯誤');
        }
      };
      fetchData();
    }
  }, [isEditModalOpen, alert]);

  const appointments = appointmentsData?.appointments || [];

  const handleAppointmentClick = async (appointment: AutoAssignedAppointment) => {
    try {
      // Ensure practitioners and appointment types are loaded before opening modal
      if (practitioners.length === 0 || appointmentTypes.length === 0) {
        const [practitionersData, settings] = await Promise.all([
          apiService.getPractitioners(),
          apiService.getClinicSettings()
        ]);
        setPractitioners(practitionersData);
        setAppointmentTypes(settings.appointment_types);
      }
      
      // Fetch appointment details to create CalendarEvent
      const startMoment = moment.tz(appointment.start_time, 'Asia/Taipei');
      const endMoment = moment.tz(appointment.end_time, 'Asia/Taipei');
      
      const resource: CalendarEvent['resource'] = {
        type: 'appointment',
        calendar_event_id: appointment.calendar_event_id,
        appointment_id: appointment.appointment_id,
        patient_id: appointment.patient_id,
        patient_name: appointment.patient_name,
        practitioner_id: appointment.practitioner_id,
        practitioner_name: appointment.practitioner_name,
        appointment_type_id: appointment.appointment_type_id,
        appointment_type_name: appointment.appointment_type_name,
        status: 'confirmed',
        is_auto_assigned: true, // All appointments from this page are currently auto-assigned
        originally_auto_assigned: appointment.originally_auto_assigned,
      };
      
      // Only include notes if it's not null/undefined (for exactOptionalPropertyTypes)
      if (appointment.notes != null) {
        resource.notes = appointment.notes;
      }
      
      const event: CalendarEvent = {
        id: appointment.calendar_event_id,
        title: `${appointment.patient_name} - ${appointment.appointment_type_name}`,
        start: startMoment.toDate(),
        end: endMoment.toDate(),
        resource: resource,
      };
      
      setSelectedAppointment(appointment);
      setCalendarEvent(event);
      setIsEditModalOpen(true);
    } catch (err) {
      logger.error('Failed to open edit modal:', err);
      alert('無法開啟編輯視窗', '錯誤');
    }
  };

  const handleEditConfirm = async (formData: {
    practitioner_id: number | null;
    start_time: string;
    notes?: string;
    notification_note?: string;
  }) => {
    if (!selectedAppointment) return;

    try {
      // Call update appointment API
      // Build request object conditionally to avoid undefined values (for exactOptionalPropertyTypes)
      const updateData: {
        practitioner_id?: number | null;
        start_time?: string | null;
        notes?: string;
        notification_note?: string;
      } = {
        practitioner_id: formData.practitioner_id,
        start_time: formData.start_time,
      };
      
      if (formData.notes !== undefined) {
        updateData.notes = formData.notes;
      }
      
      if (formData.notification_note !== undefined) {
        updateData.notification_note = formData.notification_note;
      }
      
      await apiService.editClinicAppointment(selectedAppointment.appointment_id, updateData);

      // Close modal and refresh list
      setIsEditModalOpen(false);
      setSelectedAppointment(null);
      setCalendarEvent(null);
      await refetch();
      
      alert('預約已重新指派', '成功');
    } catch (err) {
      logger.error('Failed to update appointment:', err);
      throw err; // Let EditAppointmentModal handle the error display
    }
  };

  const formatDateTime = (dateTimeStr: string) => {
    const momentObj = moment.tz(dateTimeStr, 'Asia/Taipei');
    return momentObj.format('YYYY-MM-DD HH:mm');
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title="自動指派預約" />
        <div className="flex justify-center items-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title="自動指派預約" />
        <ErrorMessage message={error} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="自動指派預約" />
      
      <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mt-4 mb-6">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">說明</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>此列表顯示所有尚未指派給特定治療師的預約。點擊預約以重新指派給治療師。預約將在達到預約時間限制時自動指派給原自動指派的治療師。</p>
            </div>
          </div>
        </div>
      </div>

      {appointments.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">目前沒有自動指派的預約</p>
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {appointments.map((appointment) => (
              <li
                key={appointment.appointment_id}
                onClick={() => handleAppointmentClick(appointment)}
                className="px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <p className="text-sm font-medium text-gray-900">
                        {appointment.patient_name}
                      </p>
                      <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {appointment.appointment_type_name}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center text-sm text-gray-500">
                      <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {formatDateTime(appointment.start_time)}
                    </div>
                    <div className="mt-1 flex items-center text-sm text-gray-500">
                      <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      目前指派給: {appointment.practitioner_name}
                    </div>
                    {appointment.notes && (
                      <div className="mt-1 text-sm text-gray-500">
                        備註: {appointment.notes}
                      </div>
                    )}
                  </div>
                  <div className="ml-4 flex-shrink-0">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isEditModalOpen && calendarEvent && selectedAppointment && (
        <EditAppointmentModal
          event={calendarEvent}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            setIsEditModalOpen(false);
            setSelectedAppointment(null);
            setCalendarEvent(null);
          }}
          onConfirm={handleEditConfirm}
          formatAppointmentTime={(start, end) => {
            const startMoment = moment(start).tz('Asia/Taipei');
            const endMoment = moment(end).tz('Asia/Taipei');
            return `${startMoment.format('YYYY-MM-DD HH:mm')} - ${endMoment.format('HH:mm')}`;
          }}
          formSubmitButtonText="確認指派"
          allowConfirmWithoutChanges={true}
        />
      )}
    </div>
  );
};

export default AutoAssignedAppointmentsPage;

