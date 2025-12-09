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
import { getPractitionerDisplayName, formatAppointmentDateTime } from '../../utils/calendarUtils';
import moment from 'moment-timezone';
import { ClinicNotesTextarea } from '../shared/ClinicNotesTextarea';

type EditStep = 'form' | 'review' | 'note' | 'preview';

export interface EditAppointmentModalProps {
  event: CalendarEvent;
  practitioners: { id: number; full_name: string }[];
  appointmentTypes: { id: number; name: string; duration_minutes: number }[];
  onClose: () => void;
  onConfirm: (formData: { appointment_type_id?: number | null; practitioner_id: number | null; start_time: string; clinic_notes?: string; notification_note?: string }) => Promise<void>;
  formatAppointmentTime: (start: Date, end: Date) => string;
  errorMessage?: string | null; // Error message to display (e.g., from failed save)
  showReadOnlyFields?: boolean; // If false, skip patient name, appointment type, and notes fields (default: true)
  formSubmitButtonText?: string; // Custom text for the form submit button (default: "下一步")
  saveButtonText?: string; // Custom text for the final save button (default: "確認更動")
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
  saveButtonText = '確認更動',
  allowConfirmWithoutChanges = false,
}) => {
  // Step state: 'form' | 'review' | 'note' | 'preview'
  const [step, setStep] = useState<EditStep>('form');
  
  // Form data
  const [selectedAppointmentTypeId, setSelectedAppointmentTypeId] = useState<number | null>(() => {
    return event.resource.appointment_type_id || null;
  });
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
  const originalClinicNotes = event.resource.clinic_notes || '';
  const [clinicNotes, setClinicNotes] = useState<string>(originalClinicNotes);
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

  // Determine if this appointment has an associated LINE user.
  // If there's no LINE user, we should not ask for notification notes or show LINE preview.
  const hasLineUser = !!event.resource.line_display_name;

  // Track whether the currently selected date has any available time slots
  const [hasAvailableSlots, setHasAvailableSlots] = useState<boolean>(true);
  
  // Note: We no longer show practitioner errors - we just deselect the practitioner
  
  // Conditional practitioner fetching
  const [availablePractitioners, setAvailablePractitioners] = useState<{ id: number; full_name: string }[]>(practitioners);
  const [isLoadingPractitioners, setIsLoadingPractitioners] = useState(false);
  
  // Use selectedAppointmentTypeId, fallback to event's appointment_type_id
  const appointmentTypeId = selectedAppointmentTypeId || event.resource.appointment_type_id || appointmentType?.id || null;

  // Get original appointment details for DateTimePicker
        const originalTime = moment(event.start).tz('Asia/Taipei').format('HH:mm');
        const originalDate = moment(event.start).tz('Asia/Taipei').format('YYYY-MM-DD');
  const originalPractitionerId = event.resource.practitioner_id ?? null;

  // Get original appointment type ID
  const originalAppointmentTypeId = event.resource.appointment_type_id || null;

  // Check if any changes have been made
  const hasChanges = useMemo(() => {
    if (!selectedAppointmentTypeId || !selectedPractitionerId || !selectedTime) {
      return false;
    }
    
    const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
    const originalStartTime = moment(event.start).tz('Asia/Taipei');
    const timeChanged = !newStartTime.isSame(originalStartTime, 'minute');
    const practitionerChanged = selectedPractitionerId !== originalPractitionerId;
    const appointmentTypeChanged = selectedAppointmentTypeId !== originalAppointmentTypeId;
    
    return timeChanged || practitionerChanged || appointmentTypeChanged;
  }, [selectedDate, selectedTime, selectedPractitionerId, selectedAppointmentTypeId, originalPractitionerId, originalAppointmentTypeId, event.start]);

  // Check which specific fields changed
  const changeDetails = useMemo(() => {
    if (!selectedAppointmentTypeId || !selectedPractitionerId || !selectedTime) {
      return { appointmentTypeChanged: false, practitionerChanged: false, timeChanged: false, dateChanged: false };
    }

    const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
    const originalStartTime = moment(event.start).tz('Asia/Taipei');
    const timeChanged = !newStartTime.isSame(originalStartTime, 'minute');
    const dateChanged = !newStartTime.isSame(originalStartTime, 'day');
    const practitionerChanged = selectedPractitionerId !== originalPractitionerId;
    const appointmentTypeChanged = selectedAppointmentTypeId !== originalAppointmentTypeId;

    return { appointmentTypeChanged, practitionerChanged, timeChanged, dateChanged };
  }, [selectedDate, selectedTime, selectedPractitionerId, selectedAppointmentTypeId, originalPractitionerId, originalAppointmentTypeId, event.start]);

  // Reset step when modal closes or error occurs
  useEffect(() => {
    if (externalErrorMessage) {
      setStep('form');
      setError(externalErrorMessage);
    }
  }, [externalErrorMessage]);

  // Fetch practitioners when appointment type is selected
  useEffect(() => {
    const fetchPractitioners = async () => {
      if (!selectedAppointmentTypeId) {
        // No appointment type selected - use all practitioners
        setAvailablePractitioners(practitioners);
        return;
      }

      setIsLoadingPractitioners(true);
      try {
        const fetchedPractitioners = await apiService.getPractitioners(selectedAppointmentTypeId);
        // Sort alphabetically by name (supports Chinese)
        const sorted = [...fetchedPractitioners].sort((a, b) => a.full_name.localeCompare(b.full_name, 'zh-TW'));
        setAvailablePractitioners(sorted);
        
        // Auto-deselect practitioner if current selection is not in the filtered list
        if (selectedPractitionerId && !sorted.find(p => p.id === selectedPractitionerId)) {
          setSelectedPractitionerId(null);
          setSelectedTime('');
        }
      } catch (err) {
        logger.error('Failed to fetch practitioners:', err);
        setError('無法載入治療師列表，請稍後再試');
        setAvailablePractitioners([]);
        // Clear selections
        setSelectedPractitionerId(null);
        setSelectedTime('');
      } finally {
        setIsLoadingPractitioners(false);
      }
    };

    fetchPractitioners();
  }, [selectedAppointmentTypeId, practitioners, selectedPractitionerId]);

  // Auto-deselection: When appointment type changes, clear practitioner, date, time
  useEffect(() => {
    if (selectedAppointmentTypeId === null && (selectedPractitionerId !== null || selectedTime !== '')) {
      // Appointment type was cleared - clear dependent fields
      setSelectedPractitionerId(null);
      setSelectedTime('');
    }
  }, [selectedAppointmentTypeId, selectedPractitionerId, selectedTime]);

  // Auto-deselection: When practitioner changes, clear date, time
  useEffect(() => {
    if (selectedPractitionerId === null && selectedTime !== '') {
      // Practitioner was cleared - clear dependent fields
      setSelectedTime('');
    }
  }, [selectedPractitionerId, selectedTime]);

  // Check practitioner status when practitioner is selected
  useEffect(() => {
    const checkPractitionerStatus = async () => {
      // Don't clear selectedTime here - let it be auto-selected if available
      setHasAvailableSlots(false); // Reset until availability is loaded
      
      if (!selectedPractitionerId || !appointmentTypeId) {
        return;
      }

      try {
        // Check if practitioner has availability configured
        const status = await apiService.getPractitionerStatus(selectedPractitionerId);
        
        if (!status.has_availability) {
          setHasAvailableSlots(false);
          setSelectedTime(''); // Clear selected time when no availability
          return;
        }
        
        // If has availability, DateTimePicker will make batch call automatically
        // via its useEffect that depends on selectedPractitionerId
      } catch (err) {
        logger.error('Failed to check practitioner status:', err);
        // Don't block user - let DateTimePicker try batch call anyway
        // The batch call will handle 404 errors if practitioner doesn't offer appointment type
      }
    };

    checkPractitionerStatus();
  }, [selectedPractitionerId, appointmentTypeId]);

  // Handle practitioner error from DateTimePicker (404 errors) - just deselect practitioner
  const handlePractitionerError = (_errorMessage: string) => {
    // Simply deselect the practitioner - no error message needed
    setSelectedPractitionerId(null);
    setSelectedTime('');
    setHasAvailableSlots(false);
  };

  // Handle appointment type change - clear dependent fields
  const handleAppointmentTypeChange = (appointmentTypeId: number | null) => {
    setSelectedAppointmentTypeId(appointmentTypeId);
    // Auto-deselection handled by useEffect
  };

  // Handle practitioner change - clear dependent fields
  const handlePractitionerChange = (practitionerId: number | null) => {
    setSelectedPractitionerId(practitionerId);
    // Auto-deselection handled by useEffect
  };

  const handleFormSubmit = async () => {
    // Validate appointment type is selected
    if (!selectedAppointmentTypeId) {
      setError('請選擇預約類型');
      return;
    }

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
    if (!hasChanges && !allowConfirmWithoutChanges) {
      // No changes - just close (unless allowConfirmWithoutChanges is true)
      onClose();
      return;
    }

    // Proceed to review step
    setError(null);
    setStep('review');
  };

  const handleReviewNext = async () => {
    // Calculate new start time once for all code paths
    const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
    const newStartTimeISO = newStartTime.toISOString();

    // If there is no LINE user attached to this appointment, skip the note/preview flow
    // and just save the updated practitioner/time without sending any notification.
    if (!hasLineUser) {
      const formData: { appointment_type_id?: number | null; practitioner_id: number | null; start_time: string; clinic_notes?: string; notification_note?: string } = {
        practitioner_id: selectedPractitionerId,
        start_time: newStartTimeISO,
      };
      // Include appointment_type_id if it changed
      if (changeDetails.appointmentTypeChanged && selectedAppointmentTypeId) {
        formData.appointment_type_id = selectedAppointmentTypeId;
      }
      // Always send clinic_notes if it has changed from original (allows clearing notes)
      if (clinicNotes.trim() !== originalClinicNotes.trim()) {
        formData.clinic_notes = clinicNotes.trim();
      }
      await onConfirm(formData);
      return;
    }

    // For originally auto-assigned appointments: only show note step if time changed
    // (patients don't need to know about practitioner reassignment, only time changes)
    if (originallyAutoAssigned && !changeDetails.timeChanged) {
      // Time didn't change - skip note step and go directly to save
      // Don't send notes or notification_note to preserve original patient notes
      // and avoid notifying the patient (omit properties instead of setting to undefined)
      const formData: { appointment_type_id?: number | null; practitioner_id: number | null; start_time: string; clinic_notes?: string; notification_note?: string } = {
        practitioner_id: selectedPractitionerId,
        start_time: newStartTimeISO,
      };
      // Include appointment_type_id if it changed
      if (changeDetails.appointmentTypeChanged && selectedAppointmentTypeId) {
        formData.appointment_type_id = selectedAppointmentTypeId;
      }
      // Always send clinic_notes if it has changed from original (allows clearing notes)
      if (clinicNotes.trim() !== originalClinicNotes.trim()) {
        formData.clinic_notes = clinicNotes.trim();
      }
      await onConfirm(formData);
      return;
    }

    // Time changed (or not originally auto-assigned) - proceed to note step
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
      const formData: { appointment_type_id?: number | null; practitioner_id: number | null; start_time: string; clinic_notes?: string; notification_note?: string } = {
        practitioner_id: selectedPractitionerId,
        start_time: newStartTime,
      };
      // Include appointment_type_id if it changed
      if (changeDetails.appointmentTypeChanged && selectedAppointmentTypeId) {
        formData.appointment_type_id = selectedAppointmentTypeId;
      }
      // Always send clinic_notes if it has changed from original (allows clearing notes)
      if (clinicNotes.trim() !== originalClinicNotes.trim()) {
        formData.clinic_notes = clinicNotes.trim();
      }
      // Send customNote as notification_note for the one-time notification only
      if (customNote.trim()) {
        formData.notification_note = customNote.trim();
      }
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

  // Sort appointment types alphabetically
  const sortedAppointmentTypes = useMemo(() => {
    return [...appointmentTypes].sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
  }, [appointmentTypes]);

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

        {/* Appointment type selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            預約類型 <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedAppointmentTypeId || ''}
            onChange={(e) => handleAppointmentTypeChange(e.target.value ? parseInt(e.target.value) : null)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          >
            <option value="">選擇預約類型</option>
            {sortedAppointmentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name} ({type.duration_minutes}分鐘){type.id === originalAppointmentTypeId ? ' (原)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Practitioner selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            治療師 <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedPractitionerId || ''}
            onChange={(e) => handlePractitionerChange(e.target.value ? parseInt(e.target.value) : null)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            required
            disabled={!selectedAppointmentTypeId || isLoadingPractitioners}
          >
            <option value="">選擇治療師</option>
            {isLoadingPractitioners ? (
              <option value="" disabled>載入中...</option>
            ) : (
              availablePractitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}{p.id === originalPractitionerId ? ' (原)' : ''}
                </option>
              ))
            )}
          </select>
          {selectedAppointmentTypeId && !isLoadingPractitioners && availablePractitioners.length === 0 && (
            <p className="text-sm text-gray-500 mt-1">此預約類型目前沒有可用的治療師</p>
          )}
        </div>

        {/* Date/Time Picker */}
        {/* Display original appointment time */}
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-md p-3">
          <p className="text-sm font-medium text-blue-900">
            <span className="font-semibold">原預約時間：</span>
            {originalDate && originalTime ? formatAppointmentDateTime(moment.tz(`${originalDate}T${originalTime}`, 'Asia/Taipei').toDate()) : ''}
          </p>
        </div>
        {appointmentTypeId && selectedPractitionerId && (
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
            onHasAvailableSlotsChange={setHasAvailableSlots}
            onPractitionerError={handlePractitionerError}
          />
        )}

        {/* Clinic Notes - Editable, moved to bottom */}
        {showReadOnlyFields && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              診所備注
            </label>
            <ClinicNotesTextarea
              value={clinicNotes}
              onChange={(e) => setClinicNotes(e.target.value)}
              rows={4}
            />
          </div>
        )}
      </div>

      <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-200 flex-shrink-0">
        <button
          onClick={handleFormSubmit}
          disabled={
            !selectedAppointmentTypeId ||
            !selectedPractitionerId ||
            !selectedTime ||
            (!hasChanges && !allowConfirmWithoutChanges) ||
            !hasAvailableSlots
          }
          className={`btn-primary ${
            (!selectedAppointmentTypeId ||
              !selectedPractitionerId ||
              !selectedTime ||
              (!hasChanges && !allowConfirmWithoutChanges) ||
              !hasAvailableSlots)
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        >
          {formSubmitButtonText}
        </button>
      </div>
    </>
  );

  // Render review step
  const renderReviewStep = () => {
    const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
    const originalStartTime = moment(event.start).tz('Asia/Taipei');
    const newFormattedDateTime = formatAppointmentDateTime(newStartTime.toDate());
    const originalFormattedDateTime = formatAppointmentDateTime(originalStartTime.toDate());
    const showTimeWarning = changeDetails.timeChanged || changeDetails.dateChanged;

    const originalAppointmentType = appointmentTypes.find(at => at.id === originalAppointmentTypeId);
    const newAppointmentType = appointmentTypes.find(at => at.id === selectedAppointmentTypeId);

    // Determine if this is the final step (will go directly to save)
    const isFinalStep = !hasLineUser || (originallyAutoAssigned && !changeDetails.timeChanged);
    const reviewButtonText = isFinalStep ? saveButtonText : '下一步';

    return (
      <>
        <div className="space-y-4 mb-6">
          {/* Original Appointment */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">原預約</h4>
            <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-2">
              <div>
                <span className="text-sm text-gray-600">預約類型：</span>
                <span className="text-sm text-gray-900">
                  {originalAppointmentType?.name || event.resource.appointment_type_name || '未知'}
                </span>
              </div>
              <div>
                <span className="text-sm text-gray-600">治療師：</span>
                <span className="text-sm text-gray-900">
                  {getPractitionerDisplayName(availablePractitioners, originalPractitionerId, originallyAutoAssigned)}
                </span>
              </div>
              <div>
                <span className="text-sm text-gray-600">日期時間：</span>
                <span className="text-sm text-gray-900">{originalFormattedDateTime}</span>
              </div>
            </div>
          </div>

          {/* New Appointment */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">新預約</h4>
            <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-2">
              <div>
                <span className="text-sm text-gray-600">預約類型：</span>
                <span className="text-sm text-gray-900">
                  {newAppointmentType?.name || '未知'}
                  {changeDetails.appointmentTypeChanged && <span className="ml-2 text-blue-600">✏️</span>}
                </span>
              </div>
              <div>
                <span className="text-sm text-gray-600">治療師：</span>
                <span className="text-sm text-gray-900">
                  {getPractitionerDisplayName(availablePractitioners, selectedPractitionerId, false)}
                  {changeDetails.practitionerChanged && <span className="ml-2 text-blue-600">✏️</span>}
                </span>
              </div>
              <div>
                <span className="text-sm text-gray-600">日期時間：</span>
                <span className="text-sm text-gray-900">
                  {newFormattedDateTime}
                  {(changeDetails.timeChanged || changeDetails.dateChanged) && <span className="ml-2 text-blue-600">✏️</span>}
                </span>
              </div>
            </div>
          </div>

          {/* Time Change Warning */}
          {showTimeWarning && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-yellow-600 mt-0.5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-yellow-800">
                  時間已變更，請確認病患可配合此時間
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={() => {
              setStep('form');
              setError(null);
            }}
            className="btn-secondary"
          >
            返回修改
          </button>
          <button
            onClick={handleReviewNext}
            className="btn-primary"
          >
            {reviewButtonText}
          </button>
        </div>
      </>
    );
  };

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
          {isSaving ? '儲存中...' : saveButtonText}
        </button>
      </div>
    </>
  );

  return (
    <BaseModal
      onClose={onClose}
      aria-label="調整預約"
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
          {step === 'form' && '調整預約'}
          {step === 'review' && '確認變更'}
          {step === 'note' && '調整預約備註(選填)'}
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
      {step === 'review' && renderReviewStep()}
      {step === 'note' && renderNoteStep()}
      {step === 'preview' && renderPreviewStep()}
      </div>
    </BaseModal>
  );
});
