import { create } from 'zustand';
import { AppointmentType, Practitioner, Patient } from '../types';

type FlowType = 'flow1' | 'flow2' | null;

interface AppointmentState {
  // Current step in the booking flow
  step: number;
  flowType: FlowType; // null until flow is determined

  // Step 1: Appointment Type (Flow 1) or Patient (Flow 2)
  appointmentTypeId: number | null;
  appointmentType: AppointmentType | null;
  appointmentTypeInstructions: string | null;
  appointmentNotesInstructions: string | null;

  // Step 2: Practitioner (Flow 1) or Appointment Type (Flow 2)
  practitionerId: number | null; // null means "不指定治療師"
  practitioner: Practitioner | null;
  isAutoAssigned: boolean; // true if practitioner was auto-assigned by system

  // Step 3: Date & Time (Flow 1) or Practitioner (Flow 2)
  date: string | null;
  startTime: string | null;

  // Step 4: Patient (Flow 1) or Date & Time (Flow 2)
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
  setFlowType: (flowType: FlowType) => void;
  setAppointmentType: (id: number, type: AppointmentType) => void;
  setAppointmentTypeInstructions: (instructions: string | null) => void;
  setAppointmentNotesInstructions: (instructions: string | null) => void;
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
  flowType: null,
  appointmentTypeId: null,
  appointmentType: null,
  appointmentTypeInstructions: null,
  appointmentNotesInstructions: null,
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

  setFlowType: (flowType) => set({ flowType }),

  setAppointmentType: (id, type) => {
    const state = get();
    const flowType = state.flowType;
    const skipPractitionerStep = type.allow_patient_practitioner_selection === false;
    
    // Determine next step based on flow type
    let nextStep: number;
    if (flowType === 'flow2') {
      // Flow 2: Step 2 is appointment type, next is step 3 (practitioner) or step 4 (date/time)
      nextStep = skipPractitionerStep ? 4 : 3;
    } else {
      // Flow 1: Step 1 is appointment type, next is step 2 (practitioner) or step 3 (date/time)
      nextStep = skipPractitionerStep ? 3 : 2;
    }
    
    set({
      appointmentTypeId: id,
      appointmentType: type,
      step: nextStep,
      // Reset dependent fields
      practitionerId: null,
      practitioner: null,
      isAutoAssigned: skipPractitionerStep ? true : false, // Auto-assign if skipped
      date: null,
      startTime: null,
    });
  },

  setAppointmentTypeInstructions: (instructions) => set({
    appointmentTypeInstructions: instructions,
  }),

  setAppointmentNotesInstructions: (instructions) => set({
    appointmentNotesInstructions: instructions,
  }),

  setPractitioner: (id, practitioner, isAutoAssigned = false) => {
    const state = get();
    const flowType = state.flowType;
    
    // Determine next step based on flow type
    // Flow 1: Step 2 -> Step 3 (date/time)
    // Flow 2: Step 3 -> Step 4 (date/time)
    const nextStep = flowType === 'flow2' ? 4 : 3;
    
    set({
      practitionerId: id,
      practitioner: practitioner || null,
      isAutoAssigned,
      step: nextStep,
      // Reset dependent fields
      date: null,
      startTime: null,
    });
  },

  updateAssignedPractitioner: (id, practitioner, isAutoAssigned = false) => set({
    practitionerId: id,
    practitioner: practitioner || null,
    isAutoAssigned,
    // Don't reset date/time or change step
  }),

  setDateTime: (date, time) => {
    const state = get();
    const flowType = state.flowType;
    
    // Determine next step based on flow type
    // Flow 1: Step 3 -> Step 4 (patient)
    // Flow 2: Step 4 -> Step 5 (notes)
    const nextStep = flowType === 'flow2' ? 5 : 4;
    
    set({
      date,
      startTime: time,
      step: nextStep,
    });
  },

  setPatient: (id, patient) => {
    const state = get();
    const flowType = state.flowType;
    
    // Determine next step based on flow type
    // Flow 1: Step 4 -> Step 5 (notes)
    // Flow 2: Step 1 -> Step 2 (appointment type)
    const nextStep = flowType === 'flow2' ? 2 : 5;
    
    set({
      patientId: id,
      patient,
      step: nextStep,
    });
  },

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
    flowType: null,
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
    // Keep clinicId, clinic info, and instructions as they don't change during the flow
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
