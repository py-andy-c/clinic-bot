import moment from 'moment-timezone';

/**
 * Check if an appointment can be cancelled or rescheduled based on
 * the minimum cancellation hours requirement.
 *
 * @param appointmentStartTime - ISO string of the appointment start time
 * @param minimumHours - Minimum hours required before cancellation/reschedule (null if not loaded yet)
 * @returns true if the appointment can be cancelled/rescheduled, false otherwise
 */
export function checkCancellationConstraint(
  appointmentStartTime: string,
  minimumHours: number | null
): boolean {
  if (minimumHours === null) {
    // If we don't have the hours yet, allow (will be checked on backend)
    return true;
  }

  const appointmentTime = moment(appointmentStartTime).tz('Asia/Taipei');
  const now = moment().tz('Asia/Taipei');
  const hoursUntilAppointment = appointmentTime.diff(now, 'hours', true);

  return hoursUntilAppointment >= minimumHours;
}

