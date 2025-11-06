import moment from 'moment-timezone';

export interface AppointmentData {
  id: number;
  appointment_type_name: string;
  practitioner_name: string;
  patient_name: string;
  start_time: string;
  end_time: string;
  notes: string | undefined;
  clinic_name?: string;
  clinic_address?: string;
}

export const downloadAppointmentICS = (appointment: AppointmentData) => {
  const {
    id,
    appointment_type_name,
    practitioner_name,
    start_time,
    end_time,
    notes,
    clinic_name = '診所',
    clinic_address
  } = appointment;

  // Build description with appointment details
  let description = `${clinic_name}\\n`;
  description += `治療師：${practitioner_name}\\n`;
  description += `預約類型：${appointment_type_name}`;

  if (notes) {
    description += `\\n\\n備註：\\n${notes}`;
  }

  // Create ICS content
  // DTSTAMP should be current UTC time
  const nowUTC = moment().utc().format('YYYYMMDDTHHmmss') + 'Z';
  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//診所小幫手//Appointment//EN
BEGIN:VEVENT
UID:appointment-${id}@clinicbot.com
DTSTAMP:${nowUTC}
DTSTART:${formatICSDate(start_time)}
DTEND:${formatICSDate(end_time)}
SUMMARY:${appointment_type_name} - ${practitioner_name}
DESCRIPTION:${description}
LOCATION:${clinic_address || clinic_name}
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
    console.error('Failed to create ICS download:', error);
    throw error;
  }
};

// Helper function to format date for ICS format
// Input is Taiwan time ISO string (with +08:00), convert to UTC for ICS format
const formatICSDate = (date: Date | string): string => {
  // Parse as Taiwan time and convert to UTC for ICS format
  const twMoment = moment(date);
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
    clinic_name = '診所',
    clinic_address
  } = appointment;

  // Format dates for Google Calendar (YYYYMMDDTHHMMSS)
  // Input is Taiwan time ISO string (with +08:00), use it directly
  // Using ctz=Asia/Taipei parameter so Google Calendar handles timezone conversion correctly
  // This avoids DST issues when converting to user's local timezone
  const formatGoogleCalendarDate = (date: Date | string): string => {
    // Parse Taiwan time ISO string (with timezone indicator)
    let twMoment;
    
    if (typeof date === 'string') {
      // Parse as Taiwan time (already in Taiwan timezone with +08:00)
      twMoment = moment(date);
    } else {
      // If Date object, assume it's in Taiwan time (shouldn't happen with our flow)
      twMoment = moment.tz(date, 'Asia/Taipei');
    }
    
    // Format as YYYYMMDDTHHMMSS (no timezone suffix when using ctz parameter)
    return twMoment.format('YYYYMMDDTHHmmss');
  };

  const start = formatGoogleCalendarDate(start_time);
  const end = formatGoogleCalendarDate(end_time);

  // Build description
  let description = `${clinic_name}\\n`;
  description += `治療師：${practitioner_name}\\n`;
  description += `預約類型：${appointment_type_name}`;
  if (notes) {
    description += `\\n\\n備註：\\n${notes}`;
  }

  // Encode parameters
  const title = encodeURIComponent(`${appointment_type_name} - ${practitioner_name}`);
  const location = encodeURIComponent(clinic_address || clinic_name);
  const details = encodeURIComponent(description);

  // Google Calendar URL format with timezone parameter
  // Using ctz=Asia/Taipei so Google Calendar knows the event is in Taiwan time
  // Google Calendar will convert from Taiwan time to user's local timezone (handles DST automatically)
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}&ctz=Asia/Taipei`;
};
