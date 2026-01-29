/**
 * Default message templates for appointment confirmations and reminders.
 * These match the backend constants in core/message_template_constants.py
 */

export const DEFAULT_PATIENT_CONFIRMATION_MESSAGE = `{病患姓名}，您的預約已建立：

{預約時間} - 【{服務項目}】{治療師姓名}

期待為您服務！`;

export const DEFAULT_CLINIC_CONFIRMATION_MESSAGE = `{病患姓名}，您的預約已建立：

{預約時間} - 【{服務項目}】{治療師姓名}

期待為您服務！`;

export const DEFAULT_REMINDER_MESSAGE = `提醒您，您預約的【{服務項目}】預計於【{預約時間}】開始，由【{治療師姓名}】為您服務。

請準時前往診所，期待為您服務！`;

export const DEFAULT_RECURRING_CLINIC_CONFIRMATION_MESSAGE = `{病患姓名}，已為您建立{預約數量}個預約：

{日期範圍}

{預約列表}

【{服務項目}】{治療師姓名}

期待為您服務！`;

/**
 * Available placeholders for each message type
 */
export const PLACEHOLDERS = {
  // Common to all messages
  common: [
    { key: '{病患姓名}', label: '病患姓名', description: '病患的完整姓名' },
    { key: '{服務項目}', label: '服務項目', description: '服務項目名稱' },
    { key: '{預約時間}', label: '預約時間', description: '格式化的日期時間（例如：12/25 (三) 1:30 PM）' },
    { key: '{預約結束時間}', label: '預約結束時間', description: '格式化的結束日期時間（例如：12/25 (三) 2:30 PM）' },
    { key: '{治療師姓名}', label: '治療師姓名', description: '治療師姓名（或「不指定」）' },
    { key: '{診所名稱}', label: '診所名稱', description: '診所顯示名稱' },
    { key: '{診所地址}', label: '診所地址', description: '診所地址（如果已設定）', optional: true },
    { key: '{診所電話}', label: '診所電話', description: '診所電話（如果已設定）', optional: true },
  ],
  // Common placeholders for recurring messages (excludes time-specific ones)
  commonRecurring: [
    { key: '{病患姓名}', label: '病患姓名', description: '病患的完整姓名' },
    { key: '{服務項目}', label: '服務項目', description: '服務項目名稱' },
    { key: '{治療師姓名}', label: '治療師姓名', description: '治療師姓名（或「不指定」）' },
    { key: '{診所名稱}', label: '診所名稱', description: '診所顯示名稱' },
    { key: '{診所地址}', label: '診所地址', description: '診所地址（如果已設定）', optional: true },
    { key: '{診所電話}', label: '診所電話', description: '診所電話（如果已設定）', optional: true },
  ],
  // Confirmation-specific (none now)
  confirmation: [],
  // Reminder uses same placeholders as confirmation
  reminder: [],
  // Recurring-specific placeholders
  recurring: [
    { key: '{預約數量}', label: '預約數量', description: '建立的預約總數（例如：3）' },
    { key: '{日期範圍}', label: '日期範圍', description: '預約日期範圍（例如：2026-02-03(二) 至 2026-02-17(二)）' },
    { key: '{預約列表}', label: '預約列表', description: '編號的預約時間清單' },
  ],
} as const;

export type MessageType = 'patient_confirmation' | 'clinic_confirmation' | 'reminder' | 'recurring_clinic_confirmation';

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  patient_confirmation: '預約確認訊息（病患自行預約）',
  clinic_confirmation: '預約確認訊息（診所建立預約）',
  reminder: '提醒訊息',
  recurring_clinic_confirmation: '重複預約確認訊息（診所建立預約）',
};

export const MESSAGE_TYPE_DESCRIPTIONS: Record<MessageType, string> = {
  patient_confirmation: '當病患自行預約時發送',
  clinic_confirmation: '當診所人員建立預約時發送',
  reminder: '預約前發送的提醒',
  recurring_clinic_confirmation: '當診所人員建立重複預約時發送',
};

