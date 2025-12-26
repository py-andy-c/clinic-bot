import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppointmentStore } from '../../stores/appointmentStore';

const Step5AddNotes: React.FC = () => {
  const { t } = useTranslation();
  // Note: setStep is used in the next step button onClick handler below
  const { notes, updateNotesOnly, setStep, appointmentNotesInstructions, appointmentType } = useAppointmentStore();

  const handleNotesChange = (value: string) => {
    updateNotesOnly(value);
  };

  // Determine which instructions to show: service-specific first, then global, then nothing
  const instructionsToShow = appointmentType?.notes_instructions 
    ? appointmentType.notes_instructions 
    : appointmentNotesInstructions;

  // Check if notes are required
  const isNotesRequired = appointmentType?.require_notes === true;
  const canProceed = !isNotesRequired || (notes && notes.trim().length > 0);

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {isNotesRequired ? '備註' : t('notes.title')}
          {isNotesRequired && <span className="text-red-500 ml-1">*</span>}
        </h2>
        {instructionsToShow && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-blue-700 whitespace-pre-line">
                  {instructionsToShow}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mb-6">
        <textarea
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          placeholder={t('notes.placeholder')}
          className={`w-full px-3 py-2 border rounded-md h-32 resize-none ${
            isNotesRequired && !notes.trim() ? 'border-red-300' : 'border-gray-300'
          }`}
          maxLength={500}
        />
        <div className="flex items-center justify-between mt-1">
          {isNotesRequired && !notes.trim() && (
            <p className="text-sm text-red-600">此服務項目需要填寫備註</p>
          )}
          <p className={`text-sm ${isNotesRequired && !notes.trim() ? 'text-red-500' : 'text-gray-500'} ml-auto`}>
            {t('notes.charCount', { count: notes.length })}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <button
          onClick={() => {
            if (canProceed) {
              setStep(6);
            }
          }}
          disabled={!canProceed}
          className={`w-full py-3 px-4 rounded-md ${
            canProceed
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {t('notes.next')}
        </button>
      </div>
    </div>
  );
};

export default Step5AddNotes;
