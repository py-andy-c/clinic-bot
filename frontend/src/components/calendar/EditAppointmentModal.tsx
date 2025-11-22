/**
 * EditAppointmentModal Component
 * 
 * Modal for editing appointment details (practitioner, time, notes).
 * Handles all steps (form, note input, preview) within a single modal.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { BaseModal } from './BaseModal';
import { DateTimePicker } from './DateTimePicker';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { apiService } from '../../services/api';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';
import moment from 'moment-timezone';

type EditStep = 'form' | 'note' | 'preview';

export interface EditAppointmentModalProps {
  event: CalendarEvent;
  practitioners: { id: number; full_name: string }[];
  appointmentTypes: { id: number; name: string; duration_minutes: number }[];
  onClose: () => void;
  onConfirm: (formData: { practitioner_id: number | null; start_time: string; notes?: string; notification_note?: string }) => Promise<void>;
  formatAppointmentTime: (start: Date, end: Date) => string;
  errorMessage?: string | null; // Error message to display (e.g., from failed save)
  showReadOnlyFields?: boolean; // If false, skip patient name, appointment type, and notes fields (default: true)
  formSubmitButtonText?: string; // Custom text for the form submit button (default: "下一步")
  allowConfirmWithoutChanges?: boolean; // If true, allow confirmation even when nothing changed (default: false)
}

export const EditAppointmentModal: React.FC<EditAppointmentModalProps> = React.memo(({
  event,
  practitioners,
  appointmentTypes,
  onClose,
  onConfirm,
  errorMessage: externalErrorMessage,
  showReadOnlyFields = true,
  formSubmitButtonText = '下一步',
  allowConfirmWithoutChanges = false,
}) => {
  // Step state: 'form' | 'note' | 'preview'
  const [step, setStep] = useState<EditStep>('form');
  
  // Form data
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(() => {
    if (event.resource.practitioner_id) {
      return event.resource.practitioner_id;
    }
    return practitioners.length > 0 && practitioners[0] ? practitioners[0].id : null;
  });
  const [selectedDate, setSelectedDate] = useState<string>(
    moment(event.start).tz('Asia/Taipei').format('YYYY-MM-DD')
  );
  const [selectedTime, setSelectedTime] = useState<string>(
    moment(event.start).tz('Asia/Taipei').format('HH:mm')
  );
  // Store original notes (from patient) - cannot be edited by clinic
  const originalNotes = event.resource.notes || '';
  const [customNote, setCustomNote] = useState<string>(''); // Custom note for notification
  
  // Check if appointment was originally auto-assigned
  const originallyAutoAssigned = event.resource.originally_auto_assigned ?? false;
  
  // UI state
  const [error, setError] = useState<string | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const appointmentType = appointmentTypes.find(
    at => at.id === event.resource.appointment_type_id
  );
  
  // Use appointment_type_id directly from event if available, even if appointmentType not found yet
  const appointmentTypeId = event.resource.appointment_type_id || appointmentType?.id || null;

  // Get original appointment details for DateTimePicker
        const originalTime = moment(event.start).tz('Asia/Taipei').format('HH:mm');
        const originalDate = moment(event.start).tz('Asia/Taipei').format('YYYY-MM-DD');
  const originalPractitionerId = event.resource.practitioner_id ?? null;

  // Check if any changes have been made
  const hasChanges = useMemo(() => {
    if (!selectedPractitionerId || !selectedTime) {
      return false;
    }
    
    const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
    const originalStartTime = moment(event.start).tz('Asia/Taipei');
    const timeChanged = !newStartTime.isSame(originalStartTime, 'minute');
    const practitionerChanged = selectedPractitionerId !== originalPractitionerId;
    
    return timeChanged || practitionerChanged;
  }, [selectedDate, selectedTime, selectedPractitionerId, originalPractitionerId, event.start]);

  // Reset step when modal closes or error occurs
  useEffect(() => {
    if (externalErrorMessage) {
      setStep('form');
      setError(externalErrorMessage);
    }
  }, [externalErrorMessage]);

  const handleFormSubmit = async () => {
    // Validate practitioner is selected (required for edit)
    if (!selectedPractitionerId) {
      setError('請選擇治療師');
      return;
    }

    // Validate time is selected
    if (!selectedTime) {
      setError('請選擇時間');
      return;
    }

    // Check if any changes were made
    const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
    const originalStartTime = moment(event.start).tz('Asia/Taipei');
    const timeChanged = !newStartTime.isSame(originalStartTime, 'minute');
    const practitionerChanged = selectedPractitionerId !== (event.resource.practitioner_id || null);

    if (!timeChanged && !practitionerChanged && !allowConfirmWithoutChanges) {
      // No changes - just close (unless allowConfirmWithoutChanges is true)
      onClose();
      return;
    }

    // For originally auto-assigned appointments: only show note step if time changed
    // (patients don't need to know about practitioner reassignment, only time changes)
    if (originallyAutoAssigned && !timeChanged) {
      // Time didn't change - skip note step and go directly to save
      setError(null);
      const newStartTimeISO = newStartTime.toISOString();
      // Don't send notes or notification_note to preserve original patient notes
      // and avoid notifying the patient (omit properties instead of setting to undefined)
      const formData: { practitioner_id: number | null; start_time: string; notes?: string; notification_note?: string } = {
        practitioner_id: selectedPractitionerId,
        start_time: newStartTimeISO,
      };
      await onConfirm(formData);
      return;
    }

    // Time changed (or not originally auto-assigned) - proceed to note step
    setError(null);
    setStep('note');
  };

  const handleNoteSubmit = async () => {
    // Generate preview
    setIsLoadingPreview(true);
    setError(null);
    
    try {
      const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei').toISOString();
      const response = await apiService.previewEditNotification(
        event.resource.calendar_event_id,
        {
          new_practitioner_id: selectedPractitionerId,
          new_start_time: newStartTime,
          ...(customNote.trim() ? { note: customNote.trim() } : {}),
        }
      );

      setPreviewMessage(response.preview_message || '');
      setStep('preview');
    } catch (err) {
      logger.error('Error generating edit preview:', err);
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      // Stay on note step to show error
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    
    try {
      const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei').toISOString();
      const formData: { practitioner_id: number | null; start_time: string; notes?: string; notification_note?: string } = {
        practitioner_id: selectedPractitionerId,
        start_time: newStartTime,
        // Don't send notes to preserve original patient notes
        // Send customNote as notification_note for the one-time notification only
        ...(customNote.trim() ? { notification_note: customNote.trim() } : {}),
      };
      await onConfirm(formData);
      // onConfirm will handle closing the modal and refreshing data
    } catch (err) {
      logger.error('Error saving appointment:', err);
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      // Return to form step to show error
      setStep('form');
    } finally {
      setIsSaving(false);
    }
  };

  // Get practitioners who offer this appointment type
  const availablePractitioners = practitioners;

  // Render form step
  const renderFormStep = () => (
    <>
      <div className="space-y-4 mb-6">
        {/* Read-only fields - only show if showReadOnlyFields is true */}
        {showReadOnlyFields && (
          <>
            {/* Patient name (read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                病患姓名
              </label>
              <input
                type="text"
                value={event.resource.patient_name || event.title}
                disabled
                className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 text-gray-600"
              />
            </div>

            {/* Appointment type (read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                預約類型
              </label>
              <input
                type="text"
                value={appointmentType?.name || event.resource.appointment_type_name || '未知'}
                disabled
                className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 text-gray-600"
              />
            </div>

            {/* Patient Notes - Read-only, only show if patient provided notes */}
            {originalNotes && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  病患備註
                </label>
                <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 text-gray-700 whitespace-pre-wrap">
                  {originalNotes}
                </div>
              </div>
            )}
          </>
        )}

        {/* Practitioner selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            治療師
          </label>
          <select
            value={selectedPractitionerId || ''}
            onChange={(e) => {
              const newPractitionerId = e.target.value ? parseInt(e.target.value) : null;
              setSelectedPractitionerId(newPractitionerId);
            }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          >
            <option value="">請選擇治療師</option>
            {availablePractitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}{p.id === originalPractitionerId ? ' (原)' : ''}
              </option>
            ))}
          </select>
          {!selectedPractitionerId && (
            <p className="text-sm text-red-600 mt-1">請選擇治療師</p>
          )}
        </div>

        {/* Date/Time Picker */}
        {appointmentTypeId && (
          <DateTimePicker
            selectedDate={selectedDate}
            selectedTime={selectedTime}
            selectedPractitionerId={selectedPractitionerId}
            appointmentTypeId={appointmentTypeId}
            onDateSelect={setSelectedDate}
            onTimeSelect={setSelectedTime}
            originalTime={originalTime}
            originalDate={originalDate}
            originalPractitionerId={originalPractitionerId}
            excludeCalendarEventId={event.resource.calendar_event_id}
            error={error && !externalErrorMessage ? error : null}
          />
        )}
      </div>

      <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-200 flex-shrink-0">
        <button
          onClick={handleFormSubmit}
          disabled={!selectedPractitionerId || !selectedTime || (!hasChanges && !allowConfirmWithoutChanges)}
          className={`btn-primary ${(!selectedPractitionerId || !selectedTime || (!hasChanges && !allowConfirmWithoutChanges)) ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {formSubmitButtonText}
        </button>
      </div>
    </>
  );

  // Render note step
  const renderNoteStep = () => (
    <>
      <div className="space-y-4 mb-6">
        <div>
          <textarea
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            placeholder="例如：因治療師調度，已為您調整預約時間"
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            maxLength={200}
          />
          <p className="text-sm text-gray-500 mt-1">
            {customNote.length}/200 字元
          </p>
        </div>
      </div>

      <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-200 flex-shrink-0">
        <button
          onClick={() => {
            setStep('form');
            setError(null);
          }}
          className="btn-secondary"
        >
          返回
        </button>
        <button
          onClick={handleNoteSubmit}
          disabled={isLoadingPreview}
          className="btn-primary"
        >
          {isLoadingPreview ? '產生預覽中...' : '下一步'}
        </button>
      </div>
    </>
  );

  // Render preview step
  const renderPreviewStep = () => (
    <>
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            病患將收到此LINE訊息
          </label>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-700 whitespace-pre-line">
              {previewMessage}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-200 flex-shrink-0">
        <button
          onClick={() => {
            setStep('note');
            setError(null);
          }}
          className="btn-secondary"
          disabled={isSaving}
        >
          返回修改
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="btn-primary"
        >
          {isSaving ? '儲存中...' : '確認並發送'}
        </button>
      </div>
    </>
  );

  return (
    <BaseModal
      onClose={onClose}
      aria-label="編輯預約"
      className="!p-0"
    >
      <div className="sticky top-0 bg-white z-10 px-6 py-3 flex items-center justify-between flex-shrink-0 border-b border-gray-200 rounded-t-lg">
        <div className="flex items-center">
          <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-2">
            <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
        </div>
          <h3 className="text-base font-semibold text-blue-800">
          {step === 'form' && '編輯預約'}
          {step === 'note' && '編輯預約備註(選填)'}
          {step === 'preview' && 'LINE訊息預覽'}
        </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          aria-label="關閉"
        >
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-6 pt-4 pb-6">
      {/* Display error message */}
      {(error || externalErrorMessage) && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm text-red-800">{error || externalErrorMessage}</p>
        </div>
      )}

      {/* Render current step */}
      {step === 'form' && renderFormStep()}
      {step === 'note' && renderNoteStep()}
      {step === 'preview' && renderPreviewStep()}
      </div>
    </BaseModal>
  );
});
