import moment from 'moment-timezone';
import { logger } from './logger';
import i18n from '../i18n';

export interface AppointmentData {
  id: number;
  appointment_type_name: string;
  practitioner_name: string;
  patient_name: string;
  start_time: string;
  end_time: string;
  notes: string | undefined;
  clinic_name?: string | undefined;
  clinic_address?: string | undefined;
  clinic_phone_number?: string | undefined;
  is_auto_assigned?: boolean; // Optional flag for defensive check
}

export const downloadAppointmentICS = (appointment: AppointmentData) => {
  const {
    id,
    appointment_type_name,
    practitioner_name,
    start_time,
    end_time,
    notes,
    clinic_name,
    clinic_address,
    clinic_phone_number,
    is_auto_assigned
  } = appointment;

  // Defensive check: If appointment is auto-assigned, use "不指定" regardless of practitioner_name
  // This ensures patients never see actual practitioner names in calendar invitations
  const practitionerDisplayName = is_auto_assigned
    ? i18n.t('practitioner.notSpecified')
    : practitioner_name;

  // Use translations for calendar event
  const defaultClinicName = i18n.t('success.clinicName');
  const clinicNameDisplay = clinic_name || defaultClinicName;
  const practitionerLabel = i18n.t('calendar.eventDescription.practitioner', { practitioner: practitionerDisplayName });
  const appointmentTypeLabel = i18n.t('calendar.eventDescription.appointmentType', { appointmentType: appointment_type_name });
  const notesLabel = i18n.t('calendar.eventDescription.notes');

  // Build description with appointment details
  // Use actual newlines for building the description string
  let description = `${clinicNameDisplay}\n`;
  description += `${practitionerLabel}\n`;
  description += `${appointmentTypeLabel}`;

  // Add address to description if available
  if (clinic_address) {
    description += `\n\n${i18n.t('calendar.eventDescription.address', { address: clinic_address })}`;
  }

  // Add phone number to description if available
  if (clinic_phone_number) {
    description += `\n${i18n.t('calendar.eventDescription.phone', { phone: clinic_phone_number })}`;
  }

  if (notes) {
    description += `\n\n${notesLabel}\n${notes}`;
  }

  // Create event title
  const eventTitle = i18n.t('calendar.eventTitle', { appointmentType: appointment_type_name, practitioner: practitionerDisplayName });

  // Escape text fields for ICS format per RFC 5545
  // ICS format requires special characters to be escaped: backslash, semicolon, comma, newline
  const escapeICSValue = (value: string): string => {
    return value
      .replace(/\\/g, '\\\\')  // Escape backslashes first
      .replace(/;/g, '\\;')    // Escape semicolons
      .replace(/,/g, '\\,')    // Escape commas
      .replace(/\n/g, '\\n');  // Escape newlines as literal \n
  };

  const escapedDescription = escapeICSValue(description);
  const escapedSummary = escapeICSValue(eventTitle);
  const escapedLocation = escapeICSValue(clinic_address || clinicNameDisplay);

  // Sanitize clinic name for PRODID field
  // PRODID format is -//vendor//product//language, so // has special meaning
  // Replace // with - to prevent breaking the PRODID format
  const sanitizedClinicName = clinicNameDisplay.replace(/\//g, '-');

  // Create ICS content
  // DTSTAMP should be current UTC time
  const nowUTC = moment().utc().format('YYYYMMDDTHHmmss') + 'Z';
  // Use clinic display name in PRODID instead of hardcoded "診所"
  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//${sanitizedClinicName}//Appointment//EN
BEGIN:VEVENT
UID:appointment-${id}@clinicbot.com
DTSTAMP:${nowUTC}
DTSTART:${formatICSDate(start_time)}
DTEND:${formatICSDate(end_time)}
SUMMARY:${escapedSummary}
DESCRIPTION:${escapedDescription}
LOCATION:${escapedLocation}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

  // Create and download the file
  try {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `appointment-${id}.ics`;
    link.style.display = 'none'; // Hide the link
  document.body.appendChild(link);
  link.click();
    
    // Clean up after a short delay
    setTimeout(() => {
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
    }, 100);
  } catch (error) {
    logger.error('Failed to create ICS download:', error);
    throw error;
  }
};

// Helper function to format date for ICS format
// Input is Taiwan time ISO string (with +08:00), convert to UTC for ICS format
const formatICSDate = (date: Date | string): string => {
  // Parse as Taiwan time and convert to UTC for ICS format
  const twMoment = moment.tz(date, 'Asia/Taipei');
  // Format as YYYYMMDDTHHMMSSZ (UTC format required by ICS)
  return twMoment.utc().format('YYYYMMDDTHHmmss') + 'Z';
};

// Generate Google Calendar URL for adding event directly
export const generateGoogleCalendarURL = (appointment: AppointmentData): string => {
  const {
    appointment_type_name,
    practitioner_name,
    start_time,
    end_time,
    notes,
    clinic_name,
    clinic_address,
    clinic_phone_number,
    is_auto_assigned
  } = appointment;

  // Defensive check: If appointment is auto-assigned, use "不指定" regardless of practitioner_name
  const practitionerDisplayName = is_auto_assigned
    ? i18n.t('practitioner.notSpecified')
    : practitioner_name;

  // Format dates for Google Calendar (YYYYMMDDTHHMMSS)
  // Input is Taiwan time ISO string (with +08:00), use it directly
  // Using ctz=Asia/Taipei parameter so Google Calendar handles timezone conversion correctly
  // This avoids DST issues when converting to user's local timezone
  const formatGoogleCalendarDate = (date: Date | string): string => {
    // Parse as Taiwan time to ensure correct timezone handling
    // Always use moment.tz to explicitly set Taiwan timezone
    const twMoment = moment.tz(date, 'Asia/Taipei');
    
    // Format as YYYYMMDDTHHMMSS (no timezone suffix when using ctz parameter)
    return twMoment.format('YYYYMMDDTHHmmss');
  };

  const start = formatGoogleCalendarDate(start_time);
  const end = formatGoogleCalendarDate(end_time);

  // Use translations for calendar event
  const defaultClinicName = i18n.t('success.clinicName');
  const clinicNameDisplay = clinic_name || defaultClinicName;
  const practitionerLabel = i18n.t('calendar.eventDescription.practitioner', { practitioner: practitionerDisplayName });
  const appointmentTypeLabel = i18n.t('calendar.eventDescription.appointmentType', { appointmentType: appointment_type_name });
  const notesLabel = i18n.t('calendar.eventDescription.notes');

  // Build description
  // Use \n (single backslash) to create actual newline characters
  // These will be properly URL encoded for Google Calendar
  let description = `${clinicNameDisplay}\n`;
  description += `${practitionerLabel}\n`;
  description += `${appointmentTypeLabel}`;

  // Add address to description if available
  if (clinic_address) {
    description += `\n\n${i18n.t('calendar.eventDescription.address', { address: clinic_address })}`;
  }

  // Add phone number to description if available
  if (clinic_phone_number) {
    description += `\n${i18n.t('calendar.eventDescription.phone', { phone: clinic_phone_number })}`;
  }

  if (notes) {
    description += `\n\n${notesLabel}\n${notes}`;
  }

  // Create event title
  const eventTitle = i18n.t('calendar.eventTitle', { appointmentType: appointment_type_name, practitioner: practitionerDisplayName });

  // Encode parameters
  const title = encodeURIComponent(eventTitle);
  const location = encodeURIComponent(clinic_address || clinicNameDisplay);
  const details = encodeURIComponent(description);

  // Google Calendar URL format with timezone parameter
  // Using ctz=Asia/Taipei so Google Calendar knows the event is in Taiwan time
  // Google Calendar will convert from Taiwan time to user's local timezone (handles DST automatically)
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}&ctz=Asia/Taipei`;
};
