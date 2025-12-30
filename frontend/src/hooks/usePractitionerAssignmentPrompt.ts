import { useState, useCallback } from 'react';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { Patient } from '../types';
import { useModal } from '../contexts/ModalContext';
import { getErrorMessage } from '../types/api';

interface UsePractitionerAssignmentPromptOptions {
  patient: Patient | null;
  practitionerId: number | null;
  onAssignmentAdded?: (patient: Patient) => void;
}

/**
 * Utility function to check if we should prompt to assign a practitioner to a patient.
 * 
 * Returns true if we should prompt, false otherwise.
 * 
 * Logic:
 * 1. If patient has no active assigned practitioners → prompt (first assignment)
 * 2. If patient has active assigned practitioners:
 *    - Selected practitioner is NOT in the list → prompt (new assignment)
 *    - Selected practitioner IS in the list → don't prompt (already assigned)
 * 
 * Filters out inactive/deleted practitioners from the assigned list.
 */
export const shouldPromptForAssignment = (
  patient: Patient | null,
  practitionerId: number | null
): boolean => {
  if (!patient || !practitionerId) return false;

  const assignedPractitioners = patient.assigned_practitioners || [];
  // Filter out inactive/deleted practitioners
  const activeAssigned = assignedPractitioners.filter(
    (p) => p.is_active !== false
  );

  // If patient has no active assigned practitioners, prompt to assign
  // This is the first assignment for this patient
  if (activeAssigned.length === 0) return true;

  // Check if practitioner is already in the active assigned list
  // If not assigned, we should prompt
  return !activeAssigned.some((p) => p.id === practitionerId);
};

/**
 * Hook to handle practitioner assignment prompt flow
 */
export const usePractitionerAssignmentPrompt = ({
  patient,
  practitionerId,
  onAssignmentAdded,
}: UsePractitionerAssignmentPromptOptions) => {
  const { alert } = useModal();
  const [showPrompt, setShowPrompt] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [assignedPractitioners, setAssignedPractitioners] = useState<
    Array<{ id: number; full_name: string }>
  >([]);

  const checkAndPrompt = useCallback(() => {
    if (shouldPromptForAssignment(patient, practitionerId)) {
      setShowPrompt(true);
      return true;
    }
    return false;
  }, [patient, practitionerId]);

  const handleConfirm = useCallback(async () => {
    if (!patient || !practitionerId) return;

    try {
      setIsAdding(true);
      const updatedPatient = await apiService.assignPractitionerToPatient(
        patient.id,
        practitionerId
      );

      // Get all assigned practitioners (including the newly added one)
      const allAssigned = updatedPatient.assigned_practitioners || [];
      const activeAssigned = allAssigned
        .filter((p) => p.is_active !== false)
        .map((p) => ({ id: p.id, full_name: p.full_name }));

      setAssignedPractitioners(activeAssigned);
      setShowPrompt(false);
      setShowConfirmation(true);

      if (onAssignmentAdded) {
        onAssignmentAdded(updatedPatient);
      }
    } catch (err) {
      logger.error('Failed to add practitioner assignment:', err);
      // Show error to user but still close prompt (assignment is optional)
      const errorMessage = getErrorMessage(err) || '無法將治療師設為負責人員';
      await alert(errorMessage, '錯誤');
      setShowPrompt(false);
    } finally {
      setIsAdding(false);
    }
  }, [patient, practitionerId, onAssignmentAdded, alert]);

  const handleCancel = useCallback(() => {
    setShowPrompt(false);
  }, []);

  const handleConfirmationClose = useCallback(() => {
    setShowConfirmation(false);
  }, []);

  return {
    showPrompt,
    showConfirmation,
    isAdding,
    assignedPractitioners,
    checkAndPrompt,
    handleConfirm,
    handleCancel,
    handleConfirmationClose,
  };
};

