export { usePractitioners } from './usePractitioners';
export { usePatients, type PatientsResponse } from './usePatients';
export { useMembers } from './useMembers';
export { useAutoAssignedAppointments, type AutoAssignedAppointmentsResponse, type AutoAssignedAppointment } from './useAutoAssignedAppointments';
export { useAppointmentTypes } from './useAppointmentTypes';
export { useClinicSettings } from './useClinicSettings';
export { useRevenueDistribution } from './useRevenueDistribution';
export { useLineUsage } from './useLineUsage';
export { useBusinessInsights } from './useBusinessInsights';
export { useServiceTypeGroups } from './useServiceTypeGroups';

// New hooks for migration completion
export { usePatientDetail } from './usePatientDetail';
export { usePatientAppointments } from './usePatientAppointments';
// export { useAppointments, type AppointmentsFilters } from './useAppointments'; // Not implemented - no API method
export { useLineUsers } from './useLineUsers';
export { useSystemClinics } from './useSystemClinics';
export { useUserProfile } from './useUserProfile';
export { usePractitionerStatus } from './usePractitionerStatus';
export { useBatchPractitionerStatus } from './useBatchPractitionerStatus';
export { useClinicDetails, type ClinicDetailsData } from './useClinicDetails';
