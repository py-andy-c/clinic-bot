import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppointmentStore } from '../../stores/appointmentStore';

const Step5AddNotes: React.FC = () => {
  const { t } = useTranslation();
  // Note: setStep is used in the next step button onClick handler below
  const { notes, updateNotesOnly, setStep } = useAppointmentStore();

  const handleNotesChange = (value: string) => {
    updateNotesOnly(value);
  };

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {t('notes.title')}
        </h2>
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
