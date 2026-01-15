import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export interface AutoAssignedAppointment {
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
  pending_time_confirmation?: boolean;
  alternative_time_slots?: string[] | null;
  resource_names: string[];
  resource_ids: number[];
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
