/**
 * Message formatting utilities for consistent message formatting
 * across frontend preview and backend actual messages
 */

export interface ClinicInfo {
  name: string;
  display_name?: string | null;
  address?: string | null;
  phone_number?: string | null;
}

export interface ReminderMessageData {
  patient_name: string;
  appointment_type: string;
  appointment_time: string;
  therapist_name: string;
  clinic: ClinicInfo;
}

/**
 * Format a LINE reminder message - matches backend reminder_service.py format
 */
export const formatReminderMessage = (data: ReminderMessageData): string => {
  const { patient_name, appointment_type, appointment_time, therapist_name, clinic } = data;

  // Add clinic information if available (matches backend logic)
  const clinic_info: string[] = [];
  const effective_display_name = clinic.display_name || clinic.name;

  if (effective_display_name !== clinic.name) {
    clinic_info.push(`診所：${effective_display_name}`);
  }
  if (clinic.address) {
    clinic_info.push(`地址：${clinic.address}`);
  }
  if (clinic.phone_number) {
    clinic_info.push(`電話：${clinic.phone_number}`);
  }

  const clinic_info_str = clinic_info.length > 0 ? "\n\n" + clinic_info.join("\n") : "";

  return (
    `提醒您，您預約的【${appointment_type}】預計於【${appointment_time}】` +
    `開始，由【${therapist_name}治療師】為您服務。${clinic_info_str}` +
    `\n\n請準時前往診所，期待為您服務！`
  );
};

/**
 * Generate dummy data for reminder message preview
 */
export const generateDummyReminderData = (clinic: ClinicInfo): ReminderMessageData => {
  return {
    patient_name: "張小美",
    appointment_type: "一般診療",
    appointment_time: "12/25 (三) 14:30",
    therapist_name: "王大明",
    clinic,
  };
};
