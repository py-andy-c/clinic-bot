/**
 * EditAppointmentModal Component
 * 
 * Modal for editing appointment details (practitioner, time, notes).
 * Handles all steps (form, note input, preview) within a single modal.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { BaseModal } from './BaseModal';
import { DateTimePicker } from './DateTimePicker';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { apiService } from '../../services/api';
import { Resource } from '../../types';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';
import { getPractitionerDisplayName, formatAppointmentDateTime } from '../../utils/calendarUtils';
import moment from 'moment-timezone';
import { ClinicNotesTextarea } from '../shared/ClinicNotesTextarea';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ResourceSelection } from '../ResourceSelection';
import { useAppointmentForm } from '../../hooks/useAppointmentForm';
import { 
  AppointmentReferenceHeader, 
  AppointmentTypeSelector, 
  PractitionerSelector, 
  AppointmentFormSkeleton 
} from './form';

type EditStep = 'form' | 'review' | 'note' | 'preview';

export interface EditAppointmentModalProps {
  event: CalendarEvent;
  practitioners: { id: number; full_name: string }[];
  appointmentTypes: { id: number; name: string; duration_minutes: number }[];
  onClose: () => void;
  onConfirm: (formData: { appointment_type_id?: number | null; practitioner_id: number | null; start_time: string; clinic_notes?: string; notification_note?: string; selected_resource_ids?: number[] }) => Promise<void>;
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
  allowConfirmWithoutChanges: _allowConfirmWithoutChanges = false,
}) => {
  const isMobile = useIsMobile();
  const [step, setStep] = useState<EditStep>('form');
  const [, setOverrideMode] = useState<boolean>(false);
  
  const {
    selectedAppointmentTypeId,
    setSelectedAppointmentTypeId,
    selectedPractitionerId,
    setSelectedPractitionerId,
    selectedDate,
    setSelectedDate,
    selectedTime,
    setSelectedTime,
    clinicNotes,
    setClinicNotes,
    selectedResourceIds,
    setSelectedResourceIds,
    initialResources,
    initialAvailability,
    availablePractitioners,
    isInitialLoading,
    isLoadingPractitioners,
    error,
    setError,
    isValid,
    referenceDateTime,
    hasChanges: _hasChanges,
    changeDetails,
  } = useAppointmentForm({
    mode: 'edit',
    event,
    appointmentTypes,
    practitioners,
  });

  // UI state
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Store original notes (from patient) - cannot be edited by clinic
  const originalNotes = event.resource.notes || '';
  const originalClinicNotes = event.resource.clinic_notes || '';
  
  // Check if appointment was originally auto-assigned
  const originallyAutoAssigned = event.resource.originally_auto_assigned ?? false;
  
  // Determine if this appointment has an associated LINE user.
  const hasLineUser = !!event.resource.line_display_name;

  const [customNote, setCustomNote] = useState<string>(''); // Custom note for notification
  const [hasAvailableSlots, setHasAvailableSlots] = useState<boolean>(true);
  const [resourceNamesMap, setResourceNamesMap] = useState<Record<number, string>>({});
  const [cachedPreviewResponse, setCachedPreviewResponse] = useState<{
    will_send_notification: boolean;
    preview_message: string | null;
  } | null>(null);

  const handleResourcesFound = useCallback((resources: Resource[]) => {
    setResourceNamesMap(prev => {
      const newMap = { ...prev };
      resources.forEach(r => {
        newMap[r.id] = r.name;
      });
      return newMap;
    });
  }, []);

  // Reset step when modal closes or error occurs
  useEffect(() => {
    if (externalErrorMessage) {
      setStep('form');
      setError(externalErrorMessage);
    }
  }, [externalErrorMessage, setError]);

  // Clear cached preview response when form changes
  useEffect(() => {
    setCachedPreviewResponse(null);
  }, [selectedPractitionerId, selectedDate, selectedTime]);

  // Handle practitioner error from DateTimePicker (404 errors) - just deselect practitioner
  const handlePractitionerError = (_errorMessage: string) => {
    setSelectedPractitionerId(null);
    setSelectedTime('');
    setHasAvailableSlots(false);
  };

  const handleFormSubmit = async () => {
    if (!isValid) {
      if (!selectedAppointmentTypeId) setError('請選擇預約類型');
      else if (!selectedPractitionerId) setError('請選擇治療師');
      else if (!selectedTime) setError('請選擇時間');
      return;
    }

    // We always allow proceeding to review step as long as form is valid
    setError(null);
    setStep('review');
  };

  const handleReviewNext = async () => {
    const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
    const newStartTimeISO = newStartTime.toISOString();

    // No LINE user - skip notification flow entirely
    if (!hasLineUser) {
      const formData: any = {
        practitioner_id: selectedPractitionerId,
        start_time: newStartTimeISO,
      };
      if (changeDetails.appointmentTypeChanged && selectedAppointmentTypeId) {
        formData.appointment_type_id = selectedAppointmentTypeId;
      }
      if (clinicNotes.trim() !== originalClinicNotes.trim()) {
        formData.clinic_notes = clinicNotes.trim();
      }
      if (selectedResourceIds.length > 0) {
        formData.selected_resource_ids = selectedResourceIds;
      } else if (changeDetails.resourcesChanged) {
        formData.selected_resource_ids = [];
      }
      await onConfirm(formData);
      return;
    }

    // Check with backend if notification will be sent (single source of truth)
    try {
      const previewResponse = await apiService.previewEditNotification(
        event.resource.calendar_event_id,
        {
          new_practitioner_id: selectedPractitionerId,
          new_start_time: newStartTimeISO,
          // No note yet - just checking if notification will be sent
        }
      );

      // Cache the preview response for reuse in handleNoteSubmit
      setCachedPreviewResponse({
        will_send_notification: previewResponse.will_send_notification,
        preview_message: previewResponse.preview_message || null
      });

      // Backend decides: only show note/preview if notification will be sent
      if (!previewResponse.will_send_notification) {
        // No notification needed - save directly without note/preview steps
        const formData: any = {
          practitioner_id: selectedPractitionerId,
          start_time: newStartTimeISO,
        };
        if (changeDetails.appointmentTypeChanged && selectedAppointmentTypeId) {
          formData.appointment_type_id = selectedAppointmentTypeId;
        }
        if (clinicNotes.trim() !== originalClinicNotes.trim()) {
          formData.clinic_notes = clinicNotes.trim();
        }
        if (selectedResourceIds.length > 0) {
          formData.selected_resource_ids = selectedResourceIds;
        } else if (changeDetails.resourcesChanged) {
          formData.selected_resource_ids = [];
        }
        await onConfirm(formData);
        return;
      }

      // Notification will be sent - show note step
      setStep('note');
    } catch (err) {
      logger.error('Error checking notification requirements:', err);
      // If preview check fails, allow direct save without notification as fallback
      // This prevents blocking the user from saving their changes
      logger.warn('Preview check failed, proceeding with direct save (no notification)');
      const formData: any = {
        practitioner_id: selectedPractitionerId,
        start_time: newStartTimeISO,
      };
      if (changeDetails.appointmentTypeChanged && selectedAppointmentTypeId) {
        formData.appointment_type_id = selectedAppointmentTypeId;
      }
      if (clinicNotes.trim() !== originalClinicNotes.trim()) {
        formData.clinic_notes = clinicNotes.trim();
      }
      if (selectedResourceIds.length > 0) {
        formData.selected_resource_ids = selectedResourceIds;
      } else if (changeDetails.resourcesChanged) {
        formData.selected_resource_ids = [];
      }
      await onConfirm(formData);
    }
  };

  const handleNoteSubmit = async () => {
    setIsLoadingPreview(true);
    setError(null);
    
    try {
      const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei').toISOString();
      
      // Reuse cached preview response if available and no note was added
      // Otherwise, fetch fresh preview with the custom note
      let response;
      if (cachedPreviewResponse && !customNote.trim()) {
        // Reuse cached response (no note added, so preview should be the same)
        response = {
          preview_message: cachedPreviewResponse.preview_message,
          will_send_notification: cachedPreviewResponse.will_send_notification
        };
      } else {
        // Fetch fresh preview with custom note
        response = await apiService.previewEditNotification(
          event.resource.calendar_event_id,
          {
            new_practitioner_id: selectedPractitionerId,
            new_start_time: newStartTime,
            ...(customNote.trim() ? { note: customNote.trim() } : {}),
          }
        );
      }

      // Only show preview step if there's a preview message
      // (should always be true if will_send_notification is true, but check for safety)
      if (response.preview_message) {
        setPreviewMessage(response.preview_message);
        setStep('preview');
      } else {
        // No preview message - this shouldn't happen if will_send_notification is true,
        // but if it does, skip preview and save directly
        logger.warn('Preview response has no message but will_send_notification was true');
        await handleSave();
      }
    } catch (err) {
      logger.error('Error generating edit preview:', err);
      setError(getErrorMessage(err));
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    
    try {
      const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei').toISOString();
      const formData: any = {
        practitioner_id: selectedPractitionerId,
        start_time: newStartTime,
      };
      if (changeDetails.appointmentTypeChanged && selectedAppointmentTypeId) {
        formData.appointment_type_id = selectedAppointmentTypeId;
      }
      if (clinicNotes.trim() !== originalClinicNotes.trim()) {
        formData.clinic_notes = clinicNotes.trim();
      }
      if (customNote.trim()) {
        formData.notification_note = customNote.trim();
      }
      if (selectedResourceIds.length > 0) {
        formData.selected_resource_ids = selectedResourceIds;
      } else if (changeDetails.resourcesChanged) {
        formData.selected_resource_ids = [];
      }
      await onConfirm(formData);
    } catch (err) {
      logger.error('Error saving appointment:', err);
      setError(getErrorMessage(err));
      setStep('form');
    } finally {
      setIsSaving(false);
    }
  };

  // Render form step content (without buttons)
  const renderFormStepContent = () => {
    if (isInitialLoading) {
      return <AppointmentFormSkeleton />;
    }

    return (
      <div className="space-y-4">
        {showReadOnlyFields && (
          <>
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

        <AppointmentTypeSelector
          value={selectedAppointmentTypeId}
          options={appointmentTypes}
          onChange={setSelectedAppointmentTypeId}
          originalTypeId={event.resource.appointment_type_id}
        />

        <PractitionerSelector
          value={selectedPractitionerId}
          options={availablePractitioners}
          onChange={setSelectedPractitionerId}
          isLoading={isLoadingPractitioners}
          originalPractitionerId={event.resource.practitioner_id}
          appointmentTypeSelected={!!selectedAppointmentTypeId}
        />

        <AppointmentReferenceHeader referenceDateTime={referenceDateTime} />

        {selectedAppointmentTypeId && selectedPractitionerId && (
          <DateTimePicker
            selectedDate={selectedDate}
            selectedTime={selectedTime}
            selectedPractitionerId={selectedPractitionerId}
            appointmentTypeId={selectedAppointmentTypeId}
            onDateSelect={(date) => {
              if (date !== null) setSelectedDate(date);
            }}
            onTimeSelect={setSelectedTime}
            excludeCalendarEventId={event.resource.calendar_event_id}
            error={error && !externalErrorMessage ? error : null}
            onHasAvailableSlotsChange={setHasAvailableSlots}
            onPractitionerError={handlePractitionerError}
            allowOverride={true}
            onOverrideChange={setOverrideMode}
          />
        )}

        {selectedAppointmentTypeId && selectedPractitionerId && selectedDate && selectedTime && (
          <ResourceSelection
            appointmentTypeId={selectedAppointmentTypeId}
            practitionerId={selectedPractitionerId}
            date={selectedDate}
            startTime={selectedTime}
            durationMinutes={appointmentTypes.find(t => t.id === selectedAppointmentTypeId)?.duration_minutes || 30}
            excludeCalendarEventId={event.resource.calendar_event_id}
            selectedResourceIds={selectedResourceIds}
            onSelectionChange={setSelectedResourceIds}
            onResourcesFound={handleResourcesFound}
            skipInitialDebounce={true}
            initialResources={initialResources}
            initialAvailability={initialAvailability}
          />
        )}

        {showReadOnlyFields && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              診所備註
            </label>
            <ClinicNotesTextarea
              value={clinicNotes}
              onChange={(e) => setClinicNotes(e.target.value)}
              rows={4}
            />
          </div>
        )}
      </div>
    );
  };

  const renderFormStepFooter = () => (
    <div className="flex justify-end space-x-2 pt-4 border-t border-gray-200 flex-shrink-0">
      <button
        onClick={handleFormSubmit}
        disabled={!isValid || !hasAvailableSlots || isInitialLoading}
        className={`btn-primary ${
          (!isValid || !hasAvailableSlots || isInitialLoading)
            ? 'opacity-50 cursor-not-allowed'
            : ''
        }`}
      >
        {formSubmitButtonText}
      </button>
    </div>
  );

  // Render review step content (without buttons)
  const renderReviewStepContent = () => {
    const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei');
    const originalStartTime = moment(event.start).tz('Asia/Taipei');
    const newFormattedDateTime = formatAppointmentDateTime(newStartTime.toDate());
    const originalFormattedDateTime = formatAppointmentDateTime(originalStartTime.toDate());
    const showTimeWarning = changeDetails.timeChanged || changeDetails.dateChanged;

    const originalAppointmentType = appointmentTypes.find(at => at.id === event.resource.appointment_type_id);
    const newAppointmentType = appointmentTypes.find(at => at.id === selectedAppointmentTypeId);

    return (
      <div className="space-y-4">
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
                  {getPractitionerDisplayName(availablePractitioners, event.resource.practitioner_id ?? null, originallyAutoAssigned)}
                </span>
              </div>
              <div>
                <span className="text-sm text-gray-600">日期時間：</span>
                <span className="text-sm text-gray-900">{originalFormattedDateTime}</span>
              </div>
              {event.resource.resource_names && event.resource.resource_names.length > 0 && (
                <div>
                  <span className="text-sm text-gray-600">資源：</span>
                  <span className="text-sm text-gray-900">
                    {event.resource.resource_names.join('、')}
                  </span>
                </div>
              )}
            </div>
          </div>

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
              {selectedResourceIds.length > 0 && (
                <div>
                  <span className="text-sm text-gray-600">資源：</span>
                  <span className="text-sm text-gray-900">
                    {selectedResourceIds.map(id => resourceNamesMap[id] || `資源 #${id}`).join('、')}
                    {changeDetails.resourcesChanged && <span className="ml-2 text-blue-600">✏️</span>}
                  </span>
                </div>
              )}
            </div>
          </div>

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
    );
  };

  // Render review step footer buttons
  const renderReviewStepFooter = () => {
    const isFinalStep = !hasLineUser || (originallyAutoAssigned && !changeDetails.timeChanged);
    const reviewButtonText = isFinalStep ? saveButtonText : '下一步';

    return (
      <div className="flex justify-end space-x-2 pt-4 border-t border-gray-200 flex-shrink-0">
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
    );
  };

  // Render note step content (without buttons)
  const renderNoteStepContent = () => (
    <div className="space-y-4">
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
  );

  // Render note step footer buttons
  const renderNoteStepFooter = () => (
    <div className="flex justify-end space-x-2 pt-4 border-t border-gray-200 flex-shrink-0">
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
  );

  // Render preview step content (without buttons)
  const renderPreviewStepContent = () => (
    <div className="space-y-4">
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
  );

  // Render preview step footer buttons
  const renderPreviewStepFooter = () => (
    <div className="flex justify-end space-x-2 pt-4 border-t border-gray-200 flex-shrink-0">
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
  );

  const modalTitle = step === 'form' ? '調整預約' : step === 'review' ? '確認變更' : step === 'note' ? '調整預約備註(選填)' : 'LINE訊息預覽';

  return (
    <BaseModal
      onClose={onClose}
      aria-label={modalTitle}
      className="!p-0"
      fullScreen={isMobile}
    >
      <div className={`flex flex-col h-full ${isMobile ? 'px-4 pt-4 pb-0' : 'px-6 pt-6 pb-6'}`}>
        {/* Header */}
        <div className="flex items-center mb-4 flex-shrink-0">
          <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-2">
            <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-blue-800">
            {modalTitle}
          </h3>
        </div>
        
        {/* Error messages */}
        {(error || externalErrorMessage) && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3 flex-shrink-0">
            <p className="text-sm text-red-800">{error || externalErrorMessage}</p>
          </div>
        )}

        {/* Scrollable content area */}
        <div className={`flex-1 overflow-y-auto ${isMobile ? 'px-0' : ''}`}>
          {step === 'form' && renderFormStepContent()}
          {step === 'review' && renderReviewStepContent()}
          {step === 'note' && renderNoteStepContent()}
          {step === 'preview' && renderPreviewStepContent()}
        </div>
        
        {/* Footer with buttons - always visible at bottom */}
        <div 
          className={`flex-shrink-0 ${isMobile ? 'px-4' : ''}`}
          style={isMobile ? {
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          } : undefined}
        >
          {step === 'form' && renderFormStepFooter()}
          {step === 'review' && renderReviewStepFooter()}
          {step === 'note' && renderNoteStepFooter()}
          {step === 'preview' && renderPreviewStepFooter()}
        </div>
      </div>
    </BaseModal>
  );
});

EditAppointmentModal.displayName = 'EditAppointmentModal';
