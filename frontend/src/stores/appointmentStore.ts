import { create } from 'zustand';

export interface AppointmentType {
  id: number;
  name: string;
  duration_minutes: number;
}

export interface Practitioner {
  id: number;
  full_name: string;
  picture_url?: string;
  offered_types: number[];
}

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

  // Step 2: Practitioner
  practitionerId: number | null; // null means "不指定治療師"
  practitioner: Practitioner | null;

  // Step 3: Date & Time
  date: string | null;
  startTime: string | null;

  // Step 4: Patient
  patientId: number | null;
  patient: Patient | null;

  // Step 5: Notes
  notes: string;

  // Clinic context
  clinicId: number | null;

  // Actions
  setStep: (step: number) => void;
  setAppointmentType: (id: number, type: AppointmentType) => void;
  setPractitioner: (id: number | null, practitioner?: Practitioner) => void;
  setDateTime: (date: string, time: string) => void;
  setPatient: (id: number, patient: Patient) => void;
  setNotes: (notes: string) => void;
  setClinicId: (clinicId: number) => void;
  reset: () => void;

  // Computed properties
  canProceedToStep: (targetStep: number) => boolean;
}

export const useAppointmentStore = create<AppointmentState>((set, get) => ({
  step: 1,
  appointmentTypeId: null,
  appointmentType: null,
  practitionerId: null,
  practitioner: null,
  date: null,
  startTime: null,
  patientId: null,
  patient: null,
  notes: '',
  clinicId: null,

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

  setPractitioner: (id, practitioner) => set({
    practitionerId: id,
    practitioner: practitioner || null,
    step: 3,
    // Reset dependent fields
    date: null,
    startTime: null,
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

  setClinicId: (clinicId) => set({ clinicId }),

  reset: () => set({
    step: 1,
    appointmentTypeId: null,
    appointmentType: null,
    practitionerId: null,
    practitioner: null,
    date: null,
    startTime: null,
    patientId: null,
    patient: null,
    notes: '',
    // Keep clinicId as it doesn't change during the flow
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
