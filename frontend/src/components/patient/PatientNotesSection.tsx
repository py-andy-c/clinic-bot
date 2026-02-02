import React, { useState, useEffect } from 'react';
import { Patient } from '../../types';

interface PatientNotesSectionProps {
  patient: Patient;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onUpdate: (data: {
    notes?: string | null;
  }) => Promise<void>;
  canEdit: boolean;
}

export const PatientNotesSection: React.FC<PatientNotesSectionProps> = ({
  patient,
  isEditing,
  onEdit,
  onCancel,
  onUpdate,
  canEdit,
}) => {
  const [notes, setNotes] = useState(patient.notes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update form when patient changes
  useEffect(() => {
    setNotes(patient.notes || '');
  }, [patient]);

  const handleSave = async () => {
    setError(null);

    try {
      setIsSaving(true);
      await onUpdate({
        notes: notes.trim(),
      });
    } catch (err) {
      // Error is handled by parent component
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">備註</h2>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 resize-y"
              placeholder="請輸入備註"
              rows={6}
            />
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? '儲存中...' : '儲存'}
            </button>
            <button
              onClick={onCancel}
              disabled={isSaving}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white -mx-4 sm:mx-0 sm:rounded-lg shadow-none sm:shadow-md border-b sm:border-none border-gray-200 p-4 sm:p-6 mb-0 sm:mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900">備註</h2>
        {canEdit && (
          <button
            onClick={onEdit}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            編輯
          </button>
        )}
      </div>

      <div className="text-sm text-gray-900 whitespace-pre-wrap min-h-[100px]">
        {patient.notes && patient.notes.trim() ? patient.notes : <span className="text-gray-400">無備註</span>}
      </div>
    </div>
  );
};

