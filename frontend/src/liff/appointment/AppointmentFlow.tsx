import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { useAppointmentBackButton } from '../../hooks/useAppointmentBackButton';
import { LanguageSelector } from '../components/LanguageSelector';
import { LoadingSpinner } from '../../components/shared';
import { liffApiService } from '../../services/liffApi';
import { logger } from '../../utils/logger';
import { Patient } from '../../types';

// Import step components
import Step1SelectType from './Step1SelectType';
import Step2SelectPractitioner from './Step2SelectPractitioner';
import Step3SelectPractitioner from './Step3SelectPractitioner';
import Step3SelectDateTime from './Step3SelectDateTime';
import Step4SelectDateTime from './Step4SelectDateTime';
import Step4SelectPatient from './Step4SelectPatient';
import Step5AddNotes from './Step5AddNotes';
import Step6Confirmation from './Step6Confirmation';
import Step7Success from './Step7Success';

type FlowType = 'flow1' | 'flow2' | 'loading' | 'error';

const AppointmentFlow: React.FC = () => {
  const { step, appointmentType, setStep, clinicId } = useAppointmentStore();
  const { t } = useTranslation();
  const [flowType, setFlowType] = useState<FlowType>('loading');
  const [flowError, setFlowError] = useState<string | null>(null);

  // Enable back button navigation during appointment flow
  useAppointmentBackButton(true);

  const { setFlowType: setStoreFlowType } = useAppointmentStore();

  // Query patients on mount to determine flow
  useEffect(() => {
    const determineFlow = async () => {
      if (!clinicId) {
        setFlowType('error');
        setFlowError(t('appointment.errors.clinicInfoNotLoaded'));
        return;
      }

      try {
        // Set timeout to default to Flow 1 if query takes too long
        const timeoutPromise = new Promise<{ patients: Patient[] }>((resolve) => {
          setTimeout(() => resolve({ patients: [] }), 3000);
        });

        const queryPromise = liffApiService.getPatients();
        const response = await Promise.race([queryPromise, timeoutPromise]);

        // Determine flow based on whether user has existing patients
        if (response.patients && response.patients.length > 0) {
          setFlowType('flow2');
          setStoreFlowType('flow2');
          // For Flow 2, start at step 1 (patient selection)
          // Step is already 1, no need to change
        } else {
          setFlowType('flow1');
          setStoreFlowType('flow1');
          // For Flow 1, start at step 1 (appointment type selection)
          // Step is already 1, no need to change
        }
      } catch (err) {
        logger.error('Failed to query patients for flow detection:', err);
        // Default to Flow 1 on error
        setFlowType('flow1');
        setStoreFlowType('flow1');
        setFlowError(t('appointment.errors.patientDataLoadFailed'));
      }
    };

    determineFlow();
  }, [clinicId, setStoreFlowType, t]);

  // Prevent accessing step 2 if practitioner selection is disabled
  React.useEffect(() => {
    if (flowType === 'flow1' && step === 2 && appointmentType?.allow_patient_practitioner_selection === false) {
      // Redirect to step 3 (skip step 2)
      setStep(3);
    }
    if (flowType === 'flow2' && step === 3 && appointmentType?.allow_patient_practitioner_selection === false) {
      // Redirect to step 4 (skip step 3)
      setStep(4);
    }
  }, [step, appointmentType, setStep, flowType]);

  // Handle patient change - reset dependent fields
  const { patientId } = useAppointmentStore();
  const prevPatientIdRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (patientId !== prevPatientIdRef.current && prevPatientIdRef.current !== null) {
      // Patient changed - reset dependent fields
      useAppointmentStore.setState({
        practitionerId: null,
        practitioner: null,
        date: null,
        startTime: null,
        // Keep appointmentTypeId and appointmentType
      });
    }
    prevPatientIdRef.current = patientId;
  }, [patientId]);

  const renderCurrentStep = () => {
    if (flowType === 'loading') {
      return (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>
      );
    }

    if (flowType === 'error') {
      return (
        <div className="px-4 py-8">
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-600">{flowError || t('appointment.errors.loadError')}</p>
          </div>
        </div>
      );
    }

    // Flow 1: New LINE Users (No Existing Patients)
    // Step 1: Appointment Type
    // Step 2: Practitioner
    // Step 3: Date/Time
    // Step 4: Patient
    // Step 5: Notes
    // Step 6: Confirmation
    if (flowType === 'flow1') {
      switch (step) {
        case 1:
          return <Step1SelectType />;
        case 2:
          return <Step2SelectPractitioner />;
        case 3:
          return <Step3SelectDateTime />;
        case 4:
          return <Step4SelectPatient />;
        case 5:
          return <Step5AddNotes />;
        case 6:
          return <Step6Confirmation />;
        case 7:
          return <Step7Success />;
        default:
          return <Step1SelectType />;
      }
    }

    // Flow 2: Existing LINE Users (Has Patients)
    // Step 1: Patient
    // Step 2: Appointment Type
    // Step 3: Practitioner
    // Step 4: Date/Time
    // Step 5: Notes
    // Step 6: Confirmation
    if (flowType === 'flow2') {
      switch (step) {
        case 1:
          return <Step4SelectPatient />; // Reuse patient selection component
        case 2:
          return <Step1SelectType />; // Reuse appointment type selection
        case 3:
          return <Step3SelectPractitioner />; // New component for Flow 2 practitioner selection
        case 4:
          return <Step4SelectDateTime />; // New component for Flow 2 date/time selection
        case 5:
          return <Step5AddNotes />;
        case 6:
          return <Step6Confirmation />;
        case 7:
          return <Step7Success />;
        default:
          return <Step4SelectPatient />;
      }
    }

    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header - removed progress bar and step numbers */}
      <div className="bg-white shadow-sm">
        <div className="max-w-md mx-auto px-4 py-4">
          {/* Title with language selector inline */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex-1">
              <h1 className="text-lg font-semibold text-gray-900">{t('appointment.title')}</h1>
            </div>
            <LanguageSelector />
          </div>
          <p className="text-sm text-gray-500 mb-2">{t('home.newAppointmentDesc')}</p>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-md mx-auto">
        {renderCurrentStep()}
      </div>
    </div>
  );
};

export default AppointmentFlow;
