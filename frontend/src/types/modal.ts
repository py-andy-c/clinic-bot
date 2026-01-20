/**
 * Shared modal state management types and utilities
 *
 * Provides a unified system for managing modal states across the application,
 * replacing multiple boolean flags with a single typed state object.
 */

export type ModalType =
  // Appointment modals
  | 'create_appointment'
  | 'edit_appointment'
  | 'delete_confirmation'
  // Event modals
  | 'checkout'
  | 'receipt_view'
  | 'receipt_list'
  | 'edit_event_name'
  // Settings modals
  | 'service_item_edit'
  | 'validation_summary'
  // Dashboard modals
  | 'patient_stats'
  | 'message_stats'
  | 'appointment_stats';

export interface ModalState<T = Record<string, unknown>> {
  type: ModalType | null;
  data?: T;
}

export interface AppointmentModalData {
  event?: any; // Using any for now due to CalendarEvent interface conflicts
  patientId?: number;
  initialDate?: string;
  preSelectedAppointmentTypeId?: number;
  preSelectedPractitionerId?: number;
  preSelectedTime?: string;
  preSelectedClinicNotes?: string;
}

export interface EventModalData {
  receiptId?: number;
  eventName?: string;
  clinicNotes?: string;
}

export interface CheckoutModalData {
  appointmentId: number;
  patientId: number;
}

export interface ValidationModalData {
  errors: any[];
}

/**
 * Type-safe modal state hook
 */
export const createModalState = <T = any>() => ({
  type: null as ModalType | null,
  data: undefined as T | undefined,
});

/**
 * Modal state utilities
 */
export const modalUtils = {
  isOpen: (state: ModalState, type: ModalType): boolean =>
    state.type === type,

  open: <T>(type: ModalType, data?: T): ModalState<T> => ({
    type,
    data: data as T,
  }),

  close: (): ModalState => ({
    type: null,
  }),
};