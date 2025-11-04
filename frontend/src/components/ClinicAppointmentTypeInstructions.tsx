import React from 'react';

interface ClinicAppointmentTypeInstructionsProps {
  appointmentTypeInstructions: string | null;
  onAppointmentTypeInstructionsChange: (instructions: string | null) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
  isClinicAdmin?: boolean;
}

const ClinicAppointmentTypeInstructions: React.FC<ClinicAppointmentTypeInstructionsProps> = ({
  appointmentTypeInstructions,
  onAppointmentTypeInstructionsChange,
  showSaveButton = false,
  onSave,
  saving = false,
  isClinicAdmin = false,
}) => {
  const handleInstructionsChange = (value: string) => {
    onAppointmentTypeInstructionsChange(value || null);
  };

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900">預約類型選擇指引</h2>
        {showSaveButton && onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? '儲存中...' : '儲存更變'}
          </button>
        )}
      </div>

      <div className="space-y-4 max-w-2xl">
        <div>
          <textarea
            value={appointmentTypeInstructions || ''}
            onChange={(e) => handleInstructionsChange(e.target.value)}
            className="input min-h-[120px] resize-vertical"
            placeholder={`例如：初診請一律選擇「初診評估」。
例如：服務項目細節請參考診所官網。`}
            disabled={!isClinicAdmin}
            rows={4}
          />
          <p className="text-sm text-gray-500 mt-1">
            病患在透過Line預約，選擇預約類別時，將會看到此指引
          </p>
        </div>

      </div>
    </div>
  );
};

export default ClinicAppointmentTypeInstructions;
