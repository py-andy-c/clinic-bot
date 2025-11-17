import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { useAppointmentBackButton } from '../../hooks/useAppointmentBackButton';
import { liffApiService } from '../../services/liffApi';
import { logger } from '../../utils/logger';

// Import step components (we'll create these next)
import Step1SelectType from './Step1SelectType';
import Step2SelectPractitioner from './Step2SelectPractitioner';
import Step3SelectDateTime from './Step3SelectDateTime';
import Step4SelectPatient from './Step4SelectPatient';
import Step5AddNotes from './Step5AddNotes';
import Step6Confirmation from './Step6Confirmation';
import Step7Success from './Step7Success';

const AppointmentFlow: React.FC = () => {
  const { step, setAppointmentType, setPractitioner, setDateTime, setStep, clinicId, appointmentTypeId } = useAppointmentStore();
  const [searchParams] = useSearchParams();
  const [hasPrefilled, setHasPrefilled] = React.useState(false);

  // Handle URL parameters for pre-filling booking form (from notification links)
  useEffect(() => {
    const urlAppointmentTypeId = searchParams.get('appointment_type_id');
    const urlPractitionerId = searchParams.get('practitioner_id');
    const urlDate = searchParams.get('date');

    // Only pre-fill if we're starting fresh (step 1), have clinicId, URL params exist, and haven't prefilled yet
    if (step === 1 && clinicId && urlAppointmentTypeId && urlDate && !hasPrefilled && !appointmentTypeId) {
      const prefillFromUrl = async () => {
        try {
          setHasPrefilled(true);
          
          // Pre-select appointment type
          const appointmentTypesResponse = await liffApiService.getAppointmentTypes(clinicId);
          const appointmentType = appointmentTypesResponse.appointment_types.find(
            (at) => at.id === Number(urlAppointmentTypeId)
          );
          if (appointmentType) {
            // Add clinic_id to match AppointmentType interface
            const fullAppointmentType = {
              ...appointmentType,
              clinic_id: clinicId,
              is_deleted: false,
            };
            setAppointmentType(fullAppointmentType.id, fullAppointmentType);
          }

          // Pre-select practitioner if specified
          if (urlPractitionerId) {
            const practitionersResponse = await liffApiService.getPractitioners(clinicId, Number(urlAppointmentTypeId));
            const practitioner = practitionersResponse.practitioners.find(
              (p) => p.id === Number(urlPractitionerId)
            );
            if (practitioner) {
              setPractitioner(practitioner.id, practitioner);
            }
          } else {
            // Set to "不指定" if no practitioner_id
            setPractitioner(null);
          }

          // Pre-select date (time will be selected by user)
          setDateTime(urlDate, '');
          setStep(3); // Jump to date/time selection step
        } catch (err) {
          logger.error('Failed to pre-fill from URL params:', err);
          setHasPrefilled(false); // Allow retry
          // Continue with normal flow if pre-fill fails
        }
      };

      prefillFromUrl();
    }
  }, [searchParams, step, clinicId, hasPrefilled, appointmentTypeId, setAppointmentType, setPractitioner, setDateTime, setStep]);

  // Enable back button navigation during appointment flow
  // The back button will navigate to previous steps or home as appropriate
  useAppointmentBackButton(true);

  // Progress indicator
  const steps = [
    { id: 1, name: '選擇類型' },
    { id: 2, name: '選擇治療師' },
    { id: 3, name: '選擇時間' },
    { id: 4, name: '選擇就診人' },
    { id: 5, name: '備註' },
    { id: 6, name: '確認預約' },
  ];

  const currentStepIndex = steps.findIndex(s => s.id === step);

  const renderCurrentStep = () => {
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
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with progress */}
      <div className="bg-white shadow-sm">
        <div className="max-w-md mx-auto px-4 py-4">
          <div className="mb-2">
            <h1 className="text-lg font-semibold text-gray-900">新增預約</h1>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-primary-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
            />
          </div>

          {/* Step indicators */}
          <div className="flex justify-between mt-2">
            {steps.slice(0, 6).map((stepInfo, index) => (
              <div
                key={stepInfo.id}
                className={`flex flex-col items-center ${
                  index <= currentStepIndex ? 'text-primary-600' : 'text-gray-400'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    index <= currentStepIndex
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {index < currentStepIndex ? '✓' : stepInfo.id}
                </div>
                <span className="text-xs mt-1 hidden sm:block">{stepInfo.name}</span>
              </div>
            ))}
          </div>
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
