import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export interface AutoAssignedAppointment {
  appointment_id: number;
  calendar_event_id: number;
  patient_name: string;
  patient_id: number;
  appointment_type_name: string;
  scheduled_at: string;
  assigned_practitioner_name: string;
  assigned_practitioner_id: number;
  notes?: string;
  clinic_notes?: string;
}

export interface AutoAssignedAppointmentsResponse {
  appointments: AutoAssignedAppointment[];
}

export const useAutoAssignedAppointments = () => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['autoAssignedAppointments', activeClinicId],
    queryFn: () => apiService.getAutoAssignedAppointments(),
    enabled: !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
