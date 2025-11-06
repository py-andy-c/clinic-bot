import { create } from 'zustand';
import { AppointmentType, Practitioner } from '../types';

export interface Patient {
  id: number;
  full_name: string;
  created_at: string;
}

interface AppointmentState {
  // Current step in the booking flow
  step: number;

  // Step 1: Appointment Type
  appointmentTypeId: number | null;
  appointmentType: AppointmentType | null;
  appointmentTypeInstructions: string | null;

  // Step 2: Practitioner
  practitionerId: number | null; // null means "不指定治療師"
  practitioner: Practitioner | null;
  isAutoAssigned: boolean; // true if practitioner was auto-assigned by system

  // Step 3: Date & Time
  date: string | null;
  startTime: string | null;

  // Step 4: Patient
  patientId: number | null;
  patient: Patient | null;

  // Step 5: Notes
  notes: string;

  // Created appointment data (for Step 7 display)
  createdAppointment: {
    appointment_id: number;
    calendar_event_id: number;
    start_time: string;
    end_time: string;
  } | null;

  // Clinic context
  clinicId: number | null;
  clinicName: string | null;
  clinicDisplayName: string | null;
  clinicAddress: string | null;
  clinicPhoneNumber: string | null;

  // Actions
  setStep: (step: number) => void;
  setAppointmentType: (id: number, type: AppointmentType) => void;
  setAppointmentTypeInstructions: (instructions: string | null) => void;
  setPractitioner: (id: number | null, practitioner?: Practitioner, isAutoAssigned?: boolean) => void;
  updateAssignedPractitioner: (id: number, practitioner: Practitioner, isAutoAssigned?: boolean) => void; // Updates assigned practitioner without resetting date/time
  setDateTime: (date: string, time: string) => void;
  setPatient: (id: number, patient: Patient) => void;
  setNotes: (notes: string) => void;
  updateNotesOnly: (notes: string) => void; // Updates notes without changing step
  setCreatedAppointment: (appointment: { appointment_id: number; calendar_event_id: number; start_time: string; end_time: string }) => void;
  setClinicId: (clinicId: number) => void;
  setClinicInfo: (clinicName: string, clinicDisplayName: string, clinicAddress: string | null, clinicPhoneNumber: string | null) => void;
  reset: () => void;

  // Computed properties
  canProceedToStep: (targetStep: number) => boolean;
}

export const useAppointmentStore = create<AppointmentState>((set, get) => ({
  step: 1,
  appointmentTypeId: null,
  appointmentType: null,
  appointmentTypeInstructions: null,
  practitionerId: null,
  practitioner: null,
  isAutoAssigned: false,
  date: null,
  startTime: null,
  patientId: null,
  patient: null,
  notes: '',
  createdAppointment: null,
  clinicId: null,
  clinicName: null,
  clinicDisplayName: null,
  clinicAddress: null,
  clinicPhoneNumber: null,

  setStep: (step) => set({ step }),

  setAppointmentType: (id, type) => set({
    appointmentTypeId: id,
    appointmentType: type,
    step: 2,
    // Reset dependent fields
    practitionerId: null,
    practitioner: null,
    date: null,
    startTime: null,
  }),

  setAppointmentTypeInstructions: (instructions) => set({
    appointmentTypeInstructions: instructions,
  }),

  setPractitioner: (id, practitioner, isAutoAssigned = false) => set({
    practitionerId: id,
    practitioner: practitioner || null,
    isAutoAssigned,
    step: 3,
    // Reset dependent fields
    date: null,
    startTime: null,
  }),

  updateAssignedPractitioner: (id, practitioner, isAutoAssigned = false) => set({
    practitionerId: id,
    practitioner: practitioner || null,
    isAutoAssigned,
    // Don't reset date/time or change step
  }),

  setDateTime: (date, time) => set({
    date,
    startTime: time,
    step: 4,
  }),

  setPatient: (id, patient) => set({
    patientId: id,
    patient,
    step: 5,
  }),

  setNotes: (notes) => set({
    notes,
    step: 6,
  }),

  updateNotesOnly: (notes) => set({
    notes,
  }),

  setCreatedAppointment: (appointment) => set({
    createdAppointment: appointment,
  }),

  setClinicId: (clinicId) => set({ clinicId }),

  setClinicInfo: (clinicName, clinicDisplayName, clinicAddress, clinicPhoneNumber) => set({
    clinicName,
    clinicDisplayName,
    clinicAddress,
    clinicPhoneNumber,
  }),

  reset: () => set({
    step: 1,
    appointmentTypeId: null,
    appointmentType: null,
    practitionerId: null,
    practitioner: null,
    isAutoAssigned: false,
    date: null,
    startTime: null,
    patientId: null,
    patient: null,
    notes: '',
    createdAppointment: null,
    // Keep clinicId and clinic info as they don't change during the flow
  }),

  canProceedToStep: (targetStep) => {
    const state = get();

    switch (targetStep) {
      case 1:
        return true; // Always can go back to step 1
      case 2:
        return state.appointmentTypeId !== null;
      case 3:
        return state.appointmentTypeId !== null;
      case 4:
        return state.appointmentTypeId !== null && state.practitionerId !== undefined;
      case 5:
        return state.appointmentTypeId !== null &&
               state.practitionerId !== undefined &&
               state.date !== null &&
               state.startTime !== null;
      case 6:
        return state.appointmentTypeId !== null &&
               state.practitionerId !== undefined &&
               state.date !== null &&
               state.startTime !== null &&
               state.patientId !== null;
      case 7: // Confirmation/Success
        return state.appointmentTypeId !== null &&
               state.practitionerId !== undefined &&
               state.date !== null &&
               state.startTime !== null &&
               state.patientId !== null;
      default:
        return false;
    }
  },
}));
