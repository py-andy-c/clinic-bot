/**
 * EditAppointmentModal Component
 * 
 * Modal for editing appointment details (practitioner, time, notes).
 * Handles all steps (form, note input, preview) within a single modal.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BaseModal } from './BaseModal';
import { ServiceItemSelectionModal } from './ServiceItemSelectionModal';
import { DateTimePicker } from './DateTimePicker';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { apiService } from '../../services/api';
import { Resource, Patient, AppointmentType, ServiceTypeGroup, SchedulingConflictResponse } from '../../types';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';
import { getPractitionerDisplayName, formatAppointmentDateTime } from '../../utils/calendarUtils';
import moment from 'moment-timezone';
import { ClinicNotesTextarea } from '../shared/ClinicNotesTextarea';
import { ConflictDisplay, ConflictWarningButton } from '../shared';
import { useBatchPractitionerConflicts, usePractitionerConflicts } from '../../hooks/queries/usePractitionerConflicts';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ResourceSelection } from '../ResourceSelection';
import { useAppointmentForm } from '../../hooks/useAppointmentForm';
import {
  AppointmentReferenceHeader,
  AppointmentTypeSelector,
  AppointmentFormSkeleton
} from './form';
import { PractitionerSelectionModal } from './PractitionerSelectionModal';
import { shouldPromptForAssignment } from '../../hooks/usePractitionerAssignmentPrompt';
import { PractitionerAssignmentPromptModal } from '../PractitionerAssignmentPromptModal';
import { PractitionerAssignmentConfirmationModal } from '../PractitionerAssignmentConfirmationModal';
import { getAssignedPractitionerIds } from '../../utils/patientUtils';
import { useModalQueue } from '../../contexts/ModalQueueContext';
import { useModal } from '../../contexts/ModalContext';

type EditStep = 'form' | 'review' | 'note' | 'preview';

export interface EditAppointmentModalProps {
  event: CalendarEvent;
  practitioners: { id: number; full_name: string }[];
  appointmentTypes: AppointmentType[];
  onClose: () => void; // User cancellation → return to previous modal (if applicable)
  onComplete?: () => void; // Successful completion → close everything completely
  onConfirm: (formData: { appointment_type_id?: number | null; practitioner_id: number | null; start_time: string; clinic_notes?: string; notification_note?: string; selected_resource_ids?: number[] }) => Promise<void>;
  formatAppointmentTime: (start: Date, end: Date) => string;
  errorMessage?: string | null; // Error message to display (e.g., from failed save)
  showReadOnlyFields?: boolean; // If false, skip patient name, appointment type, and notes fields (default: true)
  formSubmitButtonText?: string; // Custom text for the form submit button (default: "下一步")
  saveButtonText?: string; // Custom text for the final save button (default: "確認更動")
  allowConfirmWithoutChanges?: boolean; // If true, allow confirmation even when nothing changed (default: false)
  skipAssignmentCheck?: boolean; // If true, skip assignment check in this modal (assignment will be handled externally) (default: false)
  isTimeConfirmation?: boolean; // If true, this is a time confirmation modal with alternative slots display
  alternativeSlots?: string[] | null; // Alternative time slots available for time confirmation
}

export const EditAppointmentModal: React.FC<EditAppointmentModalProps> = React.memo(({
  event,
  practitioners,
  appointmentTypes,
  onClose,
  onComplete,
  onConfirm,
  errorMessage: externalErrorMessage,
  showReadOnlyFields = true,
  formSubmitButtonText = '下一步',
  saveButtonText = '確認更動',
  allowConfirmWithoutChanges = false,
  skipAssignmentCheck = false,
  isTimeConfirmation = false,
  alternativeSlots = null,
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
  const [groups, setGroups] = useState<ServiceTypeGroup[]>([]);
  const [isServiceItemModalOpen, setIsServiceItemModalOpen] = useState(false);

  // Practitioner selection modal state
  const [isPractitionerModalOpen, setIsPractitionerModalOpen] = useState(false);

  // Conflict checking state
  const [conflictInfo, setConflictInfo] = useState<any>(null);
  const [conflictCheckError, setConflictCheckError] = useState<string | null>(null);

  // Batch practitioner conflicts for modal
  const practitionerConflictsQuery = useBatchPractitionerConflicts(
    availablePractitioners.length > 0 ? availablePractitioners.map(p => ({ user_id: p.id })) : null,
    selectedDate,
    selectedTime,
    selectedAppointmentTypeId,
    !!selectedDate && !!selectedTime && !!selectedAppointmentTypeId && availablePractitioners.length > 0
  ) || { data: null, isLoading: false };

  // Single practitioner conflicts for form validation
  const singlePractitionerConflictsQuery = usePractitionerConflicts(
    selectedPractitionerId,
    selectedDate,
    selectedTime,
    selectedAppointmentTypeId,
    event.resource.calendar_event_id,
    !!selectedPractitionerId && !!selectedDate && !!selectedTime && !!selectedAppointmentTypeId
  );

  // Assignment prompt state
  const [currentPatient, setCurrentPatient] = useState<Patient | null>(null);
  const { enqueueModal, showNext } = useModalQueue();
  const { alert } = useModal();

  // Fetch patient data on mount to get assigned practitioners
  useEffect(() => {
    const loadPatient = async () => {
      if (event.resource.patient_id) {
        try {
          const patient = await apiService.getPatient(event.resource.patient_id);
          setCurrentPatient(patient);
        } catch (err) {
          logger.error('Failed to fetch patient for assignment check:', err);
        }
      }
    };
    loadPatient();
  }, [event.resource.patient_id]);

  // Fetch groups on mount
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const response = await apiService.getServiceTypeGroups();
        setGroups(response.groups || []);
      } catch (err) {
        logger.error('Error loading service type groups:', err);
        setGroups([]);
      }
    };
    fetchGroups();
  }, []);

  // Update conflict info from hook result
  useEffect(() => {
    if (singlePractitionerConflictsQuery?.data) {
      setConflictInfo(singlePractitionerConflictsQuery.data);
      setConflictCheckError(null);
    } else if (singlePractitionerConflictsQuery?.error) {
      logger.error('Failed to check conflicts:', singlePractitionerConflictsQuery.error);
      setConflictCheckError('無法檢查時間衝突，請稍後再試');
      setConflictInfo(null);
    }
  }, [singlePractitionerConflictsQuery?.data, singlePractitionerConflictsQuery?.error]);


  const hasGrouping = groups.length > 0;

  // Handle service item selection from modal
  const handleServiceItemSelect = useCallback((serviceItemId: number | undefined) => {
    setSelectedAppointmentTypeId(serviceItemId ?? null);
    setIsServiceItemModalOpen(false);
  }, [setSelectedAppointmentTypeId]);

  // Track original appointment type ID to detect user changes
  const originalAppointmentTypeId = event.resource.appointment_type_id;
  const originalPractitionerId = event.resource.practitioner_id;

  // Memoize assigned practitioner IDs for PractitionerSelector
  const assignedPractitionerIdsSet = useMemo(() => {
    if (!currentPatient) return undefined;
    const ids = getAssignedPractitionerIds(currentPatient);
    return ids.length > 0 ? new Set(ids) : undefined;
  }, [currentPatient]);

  // Auto-select first assigned practitioner when user changes appointment type and original practitioner cannot handle it
  useEffect(() => {
    // Only auto-select if:
    // 1. Patient is loaded
    // 2. Appointment type is selected
    // 3. Available practitioners are loaded
    // 4. User has changed appointment type (not initial load)
    // 5. Original practitioner is not available for the new appointment type
    const appointmentTypeChanged = selectedAppointmentTypeId !== originalAppointmentTypeId;
    const originalPractitionerUnavailable = !availablePractitioners.some(p => p.id === originalPractitionerId);
    const shouldAutoSelect = appointmentTypeChanged &&
      currentPatient &&
      selectedAppointmentTypeId &&
      availablePractitioners.length > 0 &&
      !isLoadingPractitioners &&
      originalPractitionerUnavailable;

    if (shouldAutoSelect) {
      const assignedIds = getAssignedPractitionerIds(currentPatient);

      if (assignedIds.length > 0) {
        // Find the first assigned practitioner that is available for the selected appointment type
        const firstAssignedAvailable = availablePractitioners.find((p) => assignedIds.includes(p.id));

        if (firstAssignedAvailable) {
          setSelectedPractitionerId(firstAssignedAvailable.id);
        }
      }
    }
  }, [
    currentPatient,
    selectedAppointmentTypeId,
    availablePractitioners,
    isLoadingPractitioners,
    originalAppointmentTypeId,
    originalPractitionerId,
  ]);

  // Store original notes (from patient) - cannot be edited by clinic
  const originalNotes = event.resource.notes || '';
  const originalClinicNotes = event.resource.clinic_notes || '';
  
  // Check if appointment was originally auto-assigned
  const originallyAutoAssigned = event.resource.originally_auto_assigned ?? false;
  
  // Determine if this appointment has an associated LINE user.
  const hasLineUser = !!event.resource.line_display_name;

  const [customNote, setCustomNote] = useState<string>(''); // Custom note for notification
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
      
      // Check for assignment prompt after successful save (unless skipped)
      if (!skipAssignmentCheck) {
        const assignmentPromptShown = await checkAndHandleAssignment();
        if (assignmentPromptShown) {
          return; // Assignment flow will handle completion
        }
      }
      
      // No assignment needed - close completely
      if (onComplete) {
        onComplete();
      } else {
        onClose();
      }
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
        
        // Check for assignment prompt after successful save (unless skipped)
        if (!skipAssignmentCheck) {
          const assignmentPromptShown = await checkAndHandleAssignment();
          if (assignmentPromptShown) {
            return; // Assignment flow will handle completion
          }
        }
        
        // No assignment needed - close completely
        if (onComplete) {
          onComplete();
        } else {
          onClose();
        }
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
      
      // Check for assignment prompt after successful save (unless skipped)
      if (!skipAssignmentCheck) {
        const assignmentPromptShown = await checkAndHandleAssignment();
        if (assignmentPromptShown) {
          return; // Assignment flow will handle completion
        }
      }
      
      // No assignment needed - close completely
      if (onComplete) {
        onComplete();
      } else {
        onClose();
      }
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

  // Helper function to check and handle assignment prompt after appointment is saved
  const checkAndHandleAssignment = useCallback(async () => {
    // Check if:
    // 1. Practitioner changed (normal edit flow), OR
    // 2. allowConfirmWithoutChanges is true (pending review - always check even if practitioner didn't change)
    // AND new practitioner is not null (not "不指定")
    const shouldCheckAssignment = (changeDetails.practitionerChanged || allowConfirmWithoutChanges) && 
                                   selectedPractitionerId !== null && 
                                   event.resource.patient_id;
    
    if (!shouldCheckAssignment || !event.resource.patient_id) {
      return false; // No assignment check needed
    }

    try {
      const patient = await apiService.getPatient(event.resource.patient_id);
      setCurrentPatient(patient);
      
      // Check if we need to prompt for assignment
      const shouldPrompt = shouldPromptForAssignment(patient, selectedPractitionerId);
      
      if (!shouldPrompt) {
        return false; // No prompt needed
      }

      const practitionerName = availablePractitioners.find(p => p.id === selectedPractitionerId)?.full_name || '';
      
      // Capture callbacks in closure before component unmounts
      const capturedOnComplete = onComplete;
      const capturedOnClose = onClose;
      
      // Get current assigned practitioners to display
      let currentAssigned: Array<{ id: number; full_name: string }> = [];
      if (patient.assigned_practitioners && patient.assigned_practitioners.length > 0) {
        currentAssigned = patient.assigned_practitioners
          .filter((p) => p.is_active !== false)
          .map((p) => ({ id: p.id, full_name: p.full_name }));
      } else if (patient.assigned_practitioner_ids && patient.assigned_practitioner_ids.length > 0) {
        currentAssigned = patient.assigned_practitioner_ids
          .map((id) => {
            const practitioner = practitioners.find(p => p.id === id);
            return practitioner ? { id: practitioner.id, full_name: practitioner.full_name } : null;
          })
          .filter((p): p is { id: number; full_name: string } => p !== null);
      }
      
      // Enqueue the assignment prompt modal (defer until this modal closes)
      enqueueModal<React.ComponentProps<typeof PractitionerAssignmentPromptModal>>({
        id: 'assignment-prompt',
        component: PractitionerAssignmentPromptModal,
        defer: true,
        props: {
          practitionerName,
          currentAssignedPractitioners: currentAssigned,
          onConfirm: async () => {
            if (!patient || !selectedPractitionerId) return;
            
            try {
              const updatedPatient = await apiService.assignPractitionerToPatient(
                patient.id,
                selectedPractitionerId
              );
              
              const allAssigned = updatedPatient.assigned_practitioners || [];
              const activeAssigned = allAssigned
                .filter((p) => p.is_active !== false)
                .map((p) => ({ id: p.id, full_name: p.full_name }));
              
              setCurrentPatient(updatedPatient);
              
              // Enqueue confirmation modal
              enqueueModal<React.ComponentProps<typeof PractitionerAssignmentConfirmationModal>>({
                id: 'assignment-confirmation',
                component: PractitionerAssignmentConfirmationModal,
                defer: true,
                props: {
                  assignedPractitioners: activeAssigned,
                  excludePractitionerId: selectedPractitionerId,
                  onClose: () => {
                    // After confirmation modal closes, close everything completely
                    // Assignment confirmation already shows success message, so we don't
                    // need to show the "預約已重新指派" alert again
                    if (capturedOnComplete) {
                      capturedOnComplete();
                    } else {
                      // Fallback: close normally if onComplete not provided
                      capturedOnClose();
                    }
                  },
                },
              });
              
              // Show the confirmation modal after the prompt modal closes
              setTimeout(() => {
                showNext();
              }, 250);
            } catch (err) {
              logger.error('Failed to add practitioner assignment:', err);
              const errorMessage = getErrorMessage(err) || '無法將治療師設為負責人員';
              await alert(errorMessage, '錯誤');
              if (capturedOnComplete) {
                capturedOnComplete();
              } else {
                capturedOnClose();
              }
            }
          },
          onCancel: () => {
            // User declined assignment, close everything completely
            // This includes closing the EditAppointmentModal
            if (capturedOnComplete) {
              capturedOnComplete();
            } else {
              // Fallback: close normally if onComplete not provided
              capturedOnClose();
            }
          },
        },
      });
      
      // Close this modal, then show the queued prompt modal
      // Don't call onComplete here - it will be called by:
      // 1. Assignment confirmation modal's onClose (if user confirms assignment)
      // 2. Assignment prompt's onCancel (if user declines assignment)
      capturedOnClose();
      
      // Delay to ensure this modal closes before showing next
      setTimeout(() => {
        showNext();
      }, 250);
      
      return true; // Assignment prompt was shown
    } catch (err) {
      logger.error('Failed to fetch patient for assignment check:', err);
      return false; // Continue - onConfirm already closed the modal
    }
  }, [changeDetails.practitionerChanged, allowConfirmWithoutChanges, selectedPractitionerId, event.resource.patient_id, availablePractitioners, practitioners, enqueueModal, showNext, onComplete, onClose, alert]);

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
      
      // Check for assignment prompt after successful save (unless skipped)
      if (!skipAssignmentCheck) {
        const assignmentPromptShown = await checkAndHandleAssignment();
        if (assignmentPromptShown) {
          return; // Assignment flow will handle completion
        }
      }
      
      // Success - close completely using onComplete if provided, otherwise onClose
      if (onComplete) {
        onComplete();
      } else {
        onClose();
      }
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

        {/* Alternative slots display for time confirmations */}
        {isTimeConfirmation && alternativeSlots && alternativeSlots.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              可選時段
            </label>
            <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
              <div className="text-sm text-amber-800 mb-2">
                以下是系統提供給病患的可用時段選項：
              </div>
              <div className="space-y-2">
                {alternativeSlots.map((slot) => {
                  const slotDate = moment.tz(slot, 'Asia/Taipei');
                  const isCurrentSlot = slot === event.start.toISOString();
                  return (
                    <div
                      key={slot}
                      className={`flex items-center text-sm ${
                        isCurrentSlot ? 'text-amber-900 font-medium' : 'text-amber-800'
                      }`}
                    >
                      <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span>{slotDate.format('YYYY年M月D日 HH:mm')}</span>
                      {isCurrentSlot && (
                        <span className="ml-2 text-xs bg-amber-200 text-amber-900 px-2 py-1 rounded">
                          目前選擇
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {hasGrouping ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              預約類型 <span className="text-red-500">*</span>
            </label>
            <button
              type="button"
              onClick={() => setIsServiceItemModalOpen(true)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-left bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {selectedAppointmentTypeId ? (() => {
                const selectedType = appointmentTypes.find(at => at.id === selectedAppointmentTypeId);
                if (!selectedType) return '選擇預約類型';
                const duration = selectedType.duration_minutes ? `(${selectedType.duration_minutes}分鐘)` : '';
                const original = selectedType.id === event.resource.appointment_type_id ? ' (原)' : '';
                return `${selectedType.name} ${duration}${original}`.trim();
              })() : (
                '選擇預約類型'
              )}
            </button>
          </div>
        ) : (
          <AppointmentTypeSelector
            value={selectedAppointmentTypeId}
            options={appointmentTypes}
            onChange={setSelectedAppointmentTypeId}
            originalTypeId={event.resource.appointment_type_id}
          />
        )}

        {/* Practitioner Selection Button */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            治療師 <span className="text-red-500">*</span>
          </label>
          <button
            type="button"
            onClick={() => setIsPractitionerModalOpen(true)}
            disabled={!selectedAppointmentTypeId || isLoadingPractitioners}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
          >
            {isLoadingPractitioners ? (
              '載入中...'
            ) : selectedPractitionerId ? (
              availablePractitioners.find(p => p.id === selectedPractitionerId)?.full_name || '未知治療師'
            ) : (
              '選擇治療師'
            )}
          </button>
          {selectedAppointmentTypeId && !isLoadingPractitioners && availablePractitioners.length === 0 && (
            <p className="text-sm text-gray-500 mt-1">此預約類型目前沒有可用的治療師</p>
          )}
        </div>

        {/* Practitioner Selection Modal */}
        <PractitionerSelectionModal
          isOpen={isPractitionerModalOpen}
          onClose={() => setIsPractitionerModalOpen(false)}
          onSelect={(practitionerId) => {
            setSelectedPractitionerId(practitionerId);
            setIsPractitionerModalOpen(false);
          }}
          practitioners={availablePractitioners}
          selectedPractitionerId={selectedPractitionerId}
          originalPractitionerId={event.resource.practitioner_id || null}
          assignedPractitionerIds={assignedPractitionerIdsSet || []}
          practitionerConflicts={practitionerConflictsQuery?.data?.results?.reduce((acc: Record<number, SchedulingConflictResponse>, result: any) => {
            if (result.practitioner_id) {
              acc[result.practitioner_id] = result;
            }
            return acc;
          }, {}) || {}}
          isLoadingConflicts={practitionerConflictsQuery.isLoading}
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
            onPractitionerError={handlePractitionerError}
            allowOverride={true}
            onOverrideChange={setOverrideMode}
          />
        )}

        {/* Conflict Display - show conflicts when they exist */}
        {conflictCheckError ? (
          <div className="mt-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
            {conflictCheckError}
          </div>
        ) : conflictInfo && conflictInfo.has_conflict ? (
          <div className="mt-2">
            <ConflictDisplay
              conflictInfo={conflictInfo}
            />
          </div>
        ) : null}

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
    <div className="flex justify-end items-center space-x-2 pt-4 border-t border-gray-200 flex-shrink-0">
      <ConflictWarningButton conflictInfo={conflictInfo} />
      <button
        onClick={handleFormSubmit}
        disabled={!isValid || isInitialLoading}
        className={`btn-primary ${
          (!isValid || isInitialLoading)
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
      {/* Changes Summary */}
      {(changeDetails.appointmentTypeChanged || changeDetails.practitionerChanged || changeDetails.timeChanged || changeDetails.dateChanged || changeDetails.resourcesChanged) && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            變更內容
          </label>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
            {changeDetails.appointmentTypeChanged && (
              <div className="text-sm text-gray-700">
                <span className="font-medium">預約類型：</span>
                <span className="text-red-600 line-through">{changeDetails.originalAppointmentTypeName}</span>
                <span className="mx-2">→</span>
                <span className="text-green-600">{changeDetails.newAppointmentTypeName}</span>
              </div>
            )}
            {changeDetails.practitionerChanged && (
              <div className="text-sm text-gray-700">
                <span className="font-medium">治療師：</span>
                <span className="text-red-600 line-through">{changeDetails.originalPractitionerName}</span>
                <span className="mx-2">→</span>
                <span className="text-green-600">{changeDetails.newPractitionerName}</span>
              </div>
            )}
            {(changeDetails.timeChanged || changeDetails.dateChanged) && (
              <div className="text-sm text-gray-700">
                <span className="font-medium">時間：</span>
                <span className="text-red-600 line-through">{changeDetails.originalStartTime}</span>
                <span className="mx-2">→</span>
                <span className="text-green-600">{changeDetails.newStartTime}</span>
              </div>
            )}
            {changeDetails.resourcesChanged && (
              <div className="text-sm text-gray-700">
                <span className="font-medium">資源：</span>
                <span className="text-blue-600">已變更</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* LINE Message Preview */}
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

  const modalTitle = step === 'form' ? (isTimeConfirmation ? '確認預約時段' : '調整預約') : step === 'review' ? '確認變更' : step === 'note' ? '調整預約備註(選填)' : 'LINE訊息預覽';

  return (
    <>
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

    {/* Service Item Selection Modal */}
    <ServiceItemSelectionModal
      isOpen={isServiceItemModalOpen}
      onClose={() => setIsServiceItemModalOpen(false)}
      onSelect={handleServiceItemSelect}
      serviceItems={appointmentTypes}
      groups={groups}
      selectedServiceItemId={selectedAppointmentTypeId || undefined}
      originalTypeId={event.resource.appointment_type_id}
      title="選擇預約類型"
    />

    </>
  );
});

EditAppointmentModal.displayName = 'EditAppointmentModal';
