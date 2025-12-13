/**
 * Utility functions for determining checkout status of appointments.
 */

/**
 * Determine if appointment is checked out.
 * Checked out = has active (non-voided) receipt.
 */
export function isCheckedOut(hasActiveReceipt: boolean): boolean {
  return hasActiveReceipt === true;
}

/**
 * Determine if appointment can be modified.
 * Previously checked out = has any receipt (active or voided).
 * 
 * @param hasAnyReceipt - Whether appointment has any receipt (active or voided)
 * @returns true if appointment can be modified, false if it has any receipt
 */
export function canModifyAppointment(hasAnyReceipt: boolean): boolean {
  return !hasAnyReceipt;
}

/**
 * Get checkout status for display.
 * Returns null for cancelled appointments (no status shown).
 * 
 * @param hasActiveReceipt - Whether appointment has an active receipt
 * @param appointmentStatus - Appointment status ('confirmed', 'canceled_by_patient', 'canceled_by_clinic')
 * @returns Checkout status or null if appointment is cancelled
 */
export function getCheckoutStatus(
  hasActiveReceipt: boolean,
  appointmentStatus: string
): 'checked_out' | 'not_checked_out' | null {
  if (appointmentStatus !== 'confirmed') {
    return null;
  }
  return hasActiveReceipt ? 'checked_out' : 'not_checked_out';
}

