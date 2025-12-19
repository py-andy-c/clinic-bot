/**
 * EditAppointmentModal Component
 * 
 * Modal for editing appointment details (practitioner, time, notes).
 * Handles multi-step flow: Form -> Review -> Success.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { BaseModal } from './BaseModal';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
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
  AppointmentTypeSelector, 
  PractitionerSelector, 
  AppointmentFormSkeleton 
} from './form';
import { DateTimePicker } from './DateTimePicker';

type EditStep = 'form' | 'review' | 'success';

export interface EditAppointmentModalProps {
  event: CalendarEvent;
  practitioners: { id: number; full_name: string }[];
  appointmentTypes: { id: number; name: string; duration_minutes: number }[];
  onClose: (preview?: any) => void;
  onConfirm: (formData: { appointment_type_id?: number | null; practitioner_id: number | null; start_time: string; clinic_notes?: string; notification_note?: string; selected_resource_ids?: number[] }) => Promise<any>;
  formatAppointmentTime: (start: Date, end: Date) => string;
  errorMessage?: string | null; // Error message to display (e.g., from failed save)
  showReadOnlyFields?: boolean; // If false, skip patient name, appointment type, and notes fields (default: true)
  formSubmitButtonText?: string; // Custom text for the form submit button (default: "下一步")
  saveButtonText?: string; // Custom text for the final save button (default: "確認更動")
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
}) => {
  const isMobile = useIsMobile();
  const [step, setStep] = useState<EditStep>('form');
  
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
    availablePractitioners,
    isInitialLoading,
    isLoadingPractitioners,
    error,
    setError,
    isValid,
    changeDetails,
  } = useAppointmentForm({
    mode: 'edit',
    event,
    appointmentTypes,
    practitioners,
  });

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [notificationPreview, setNotificationPreview] = useState<any | null>(null);

  // Store original notes (from patient) - cannot be edited by clinic
  const originalClinicNotes = event.resource.clinic_notes || '';
  
  // Check if appointment was originally auto-assigned
  const originallyAutoAssigned = event.resource.originally_auto_assigned ?? false;
  
  const [hasAvailableSlots, setHasAvailableSlots] = useState<boolean>(true);
  const [resourceNamesMap, setResourceNamesMap] = useState<Record<number, string>>({});

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

  const handleFormSubmit = async () => {
    if (!isValid) {
      if (!selectedAppointmentTypeId) setError('請選擇預約類型');
      else if (!selectedPractitionerId) setError('請選擇治療師');
      else if (!selectedTime) setError('請選擇時間');
      return;
    }

    setError(null);
    setStep('review');
  };

  const handleReviewNext = async () => {
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
      if (selectedResourceIds.length > 0) {
        formData.selected_resource_ids = selectedResourceIds;
      }
      
      const result = await onConfirm(formData);
      setNotificationPreview(result?.notification_preview || null);
      setStep('success');
    } catch (err) {
      logger.error('Error saving appointment:', err);
      setError(getErrorMessage(err));
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
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-sm font-medium text-blue-900">
              <span className="font-semibold">病患：</span>
              {event.resource.patient_name || '未知'}
            </p>
            <p className="text-sm text-blue-900 mt-1">
              <span className="font-semibold">原預約時間：</span>
              {formatAppointmentDateTime(moment(event.start).tz('Asia/Taipei').toDate())}
            </p>
            {event.resource.notes && (
              <p className="text-sm text-blue-800 mt-1 italic">
                {event.resource.notes}
              </p>
            )}
          </div>
        )}

        <AppointmentTypeSelector
          options={appointmentTypes}
          value={selectedAppointmentTypeId}
          onChange={setSelectedAppointmentTypeId}
          originalTypeId={event.resource.appointment_type_id}
        />

        <PractitionerSelector
          options={availablePractitioners}
          value={selectedPractitionerId}
          onChange={setSelectedPractitionerId}
          isLoading={isLoadingPractitioners}
          appointmentTypeSelected={!!selectedAppointmentTypeId}
          originalPractitionerId={event.resource.practitioner_id}
        />

        <div className="pt-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            預約時間
          </label>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <DateTimePicker
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onDateSelect={setSelectedDate}
              onTimeSelect={setSelectedTime}
              selectedPractitionerId={selectedPractitionerId}
              appointmentTypeId={selectedAppointmentTypeId}
              onHasAvailableSlotsChange={setHasAvailableSlots}
              excludeCalendarEventId={event.resource.calendar_event_id}
              allowOverride={true}
            />
          </div>
        </div>

        <ResourceSelection
          appointmentTypeId={selectedAppointmentTypeId}
          practitionerId={selectedPractitionerId}
          date={selectedDate}
          startTime={selectedTime}
          durationMinutes={appointmentTypes.find(at => at.id === selectedAppointmentTypeId)?.duration_minutes || 0}
          selectedResourceIds={selectedResourceIds}
          onSelectionChange={setSelectedResourceIds}
          excludeCalendarEventId={event.resource.calendar_event_id}
          onResourcesFound={handleResourcesFound}
        />

        <ClinicNotesTextarea
          value={clinicNotes}
          onChange={(e) => setClinicNotes(e.target.value)}
        />
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
  const renderReviewStepFooter = () => (
    <div className="flex justify-end space-x-2 pt-4 border-t border-gray-200 flex-shrink-0">
      <button
        onClick={() => {
          setStep('form');
          setError(null);
        }}
        className="btn-secondary"
        disabled={isSaving}
      >
        返回修改
      </button>
      <button
        onClick={handleReviewNext}
        className="btn-primary"
        disabled={isSaving}
      >
        {isSaving ? '處理中...' : saveButtonText}
      </button>
    </div>
  );

  // Success step content
  const renderSuccessStepContent = () => (
    <div className="flex flex-col items-center justify-center py-8 space-y-4">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
        <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-xl font-medium text-gray-900">預約已成功更新！</h3>
    </div>
  );

  const modalTitle = step === 'form' ? '調整預約' : step === 'review' ? '確認變更' : '成功';

  return (
    <BaseModal
      onClose={() => onClose(notificationPreview)}
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
          {step === 'success' && renderSuccessStepContent()}
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
        </div>
      </div>
    </BaseModal>
  );
});

EditAppointmentModal.displayName = 'EditAppointmentModal';
