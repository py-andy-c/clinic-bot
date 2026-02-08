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

export const DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE = `{病患姓名}，已為您建立 {預約數量} 個預約：

{預約時段列表}

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
    { key: '{治療師姓名}', label: '治療師姓名', description: '治療師姓名（或「不指定」）' },
    { key: '{診所名稱}', label: '診所名稱', description: '診所顯示名稱' },
    { key: '{診所地址}', label: '診所地址', description: '診所地址（如果已設定）', optional: true },
    { key: '{診所電話}', label: '診所電話', description: '診所電話（如果已設定）', optional: true },
  ],
  standard: [
    { key: '{預約時間}', label: '預約時間', description: '格式化的日期時間（例如：12/25 (三) 1:30 PM）' },
    { key: '{預約結束時間}', label: '預約結束時間', description: '格式化的結束日期時間（例如：12/25 (三) 2:30 PM）' },
    { key: '{預約日期}', label: '預約日期', description: '預約日期（例如：12/25）' },
  ],
  patient_form: [
    { key: '{表單連結}', label: '表單連結', description: '病患填寫表單的專屬連結（必填）' },
  ],
  recurrent: [
    { key: '{預約數量}', label: '預約數量', description: '總預約次數' },
    { key: '{預約時段列表}', label: '預約清單', description: '所有預約時段的詳細清單' },
  ],
} as const;

export type MessageType = 'patient_confirmation' | 'clinic_confirmation' | 'reminder' | 'recurrent_clinic_confirmation' | 'patient_form';

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  patient_confirmation: '預約確認訊息（病患自行預約）',
  clinic_confirmation: '預約確認訊息（診所建立單次預約）',
  reminder: '提醒訊息',
  recurrent_clinic_confirmation: '預約確認訊息（診所建立重複預約）',
  patient_form: '患者表單訊息',
};

export const MESSAGE_TYPE_DESCRIPTIONS: Record<MessageType, string> = {
  patient_confirmation: '當病患自行預約時發送',
  clinic_confirmation: '當診所人員建立單次預約時發送',
  reminder: '預約前發送的提醒',
  recurrent_clinic_confirmation: '當診所人員建立重複預約（多時段）時發送',
  patient_form: '發送患者表單時的訊息',
};

