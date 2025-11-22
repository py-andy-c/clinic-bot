import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppointmentStore } from '../../stores/appointmentStore';

const Step5AddNotes: React.FC = () => {
  const { t } = useTranslation();
  // Note: setStep is used in the next step button onClick handler below
  const { notes, updateNotesOnly, setStep, appointmentNotesInstructions } = useAppointmentStore();

  const handleNotesChange = (value: string) => {
    updateNotesOnly(value);
  };

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {t('notes.title')}
        </h2>
        {appointmentNotesInstructions && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-blue-700 whitespace-pre-line">
                  {appointmentNotesInstructions}
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
          className="w-full px-3 py-2 border border-gray-300 rounded-md h-32 resize-none"
          maxLength={500}
        />
        <p className="text-sm text-gray-500 mt-1">
          {t('notes.charCount', { count: notes.length })}
        </p>
      </div>

      <div className="space-y-3">
        <button
          onClick={() => setStep(6)}
          className="w-full bg-primary-600 text-white py-3 px-4 rounded-md hover:bg-primary-700"
        >
          {t('notes.next')}
        </button>
      </div>
    </div>
  );
};

export default Step5AddNotes;
