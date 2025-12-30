import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { Practitioner } from '../../types';
import { liffApiService } from '../../services/liffApi';

const Step3SelectPractitioner: React.FC = () => {
  const { t } = useTranslation();
  const { appointmentTypeId, setPractitioner, clinicId, patient } = useAppointmentStore();
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [assignedPractitionerIds, setAssignedPractitionerIds] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restrictToAssigned, setRestrictToAssigned] = useState(false);

  // Load clinic info to get restrict_to_assigned_practitioners setting
  useEffect(() => {
    const loadClinicInfo = async () => {
      if (!clinicId) return;
      try {
        const info = await liffApiService.getClinicInfo();
        setRestrictToAssigned(info.restrict_to_assigned_practitioners || false);
      } catch (err) {
        logger.error('Failed to load clinic info:', err);
        // Default to false if we can't load settings
        setRestrictToAssigned(false);
      }
    };
    loadClinicInfo();
  }, [clinicId]);

  // Load assigned practitioners for the patient
  useEffect(() => {
    const loadAssignedPractitioners = async () => {
      if (!patient?.id) {
        setAssignedPractitionerIds(new Set());
        return;
      }

      try {
        // Get assigned practitioners from patient data
        // Backend should include assigned_practitioners in patient response
        if (patient.assigned_practitioners) {
          const activeAssigned = patient.assigned_practitioners
            .filter((p) => p.is_active !== false)
            .map((p) => p.id);
          setAssignedPractitionerIds(new Set(activeAssigned));
        } else {
          setAssignedPractitionerIds(new Set());
        }
      } catch (err) {
        logger.error('Failed to load assigned practitioners:', err);
        setAssignedPractitionerIds(new Set());
      }
    };

    loadAssignedPractitioners();
  }, [patient]);

  useEffect(() => {
    const loadPractitioners = async () => {
      if (!clinicId || !appointmentTypeId) return;

      try {
        setIsLoading(true);
        setError(null);

        // Get practitioners with patient_id filter if patient is known
        const response = await liffApiService.getPractitioners(
          clinicId,
          appointmentTypeId,
          patient?.id
        );
        
        let allPractitioners = response.practitioners;

        // Filter practitioners based on restrict_to_assigned_practitioners setting
        if (restrictToAssigned && patient?.id && assignedPractitionerIds.size > 0) {
          // Check if any assigned practitioners offer the selected appointment type
          const assignedPractitioners = allPractitioners.filter(p => 
            assignedPractitionerIds.has(p.id)
          );
          
          // Check if assigned practitioners offer this appointment type
          const assignedOfferingType = assignedPractitioners.filter(p =>
            p.offered_types.includes(appointmentTypeId)
          );

          if (assignedOfferingType.length > 0) {
            // Show only assigned practitioners that offer this type
            allPractitioners = assignedOfferingType;
          } else {
            // Edge case: No assigned practitioners offer this type - show all
            // (including "不指定")
          }
        } else if (restrictToAssigned && patient?.id && assignedPractitionerIds.size === 0) {
          // Edge case: No assigned practitioners - show all (including "不指定")
        }

        setPractitioners(allPractitioners);
      } catch (err) {
        logger.error('Failed to load practitioners:', err);
        setError(t('practitioner.errors.loadFailed'));
      } finally {
        setIsLoading(false);
      }
    };

    loadPractitioners();
  }, [clinicId, appointmentTypeId, patient?.id, restrictToAssigned, assignedPractitionerIds]);

  const handlePractitionerSelect = (practitionerId: number | null, practitioner?: Practitioner) => {
    setPractitioner(practitionerId, practitioner, false); // false because user explicitly selected
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-8">
        <ErrorMessage message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {t('practitioner.selectTitle')}
        </h2>
      </div>

      <div className="space-y-3">
        {/* 不指定治療師 option - only show when there are multiple practitioners */}
        {practitioners.length > 1 && (
          <button
            onClick={() => handlePractitionerSelect(null)}
            className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-md transition-all duration-200 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{t('practitioner.notSpecified')}</h3>
                <p className="text-sm text-gray-500">
                  {t('practitioner.notSpecifiedDesc')}
                </p>
              </div>
              <div className="text-primary-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>
        )}

        {/* Practitioner options */}
        {practitioners.map((practitioner) => {
          const isAssigned = assignedPractitionerIds.has(practitioner.id);
          return (
            <button
              key={practitioner.id}
              onClick={() => handlePractitionerSelect(practitioner.id, practitioner)}
              className={`w-full bg-white border rounded-lg p-4 hover:border-primary-300 hover:shadow-md transition-all duration-200 text-left ${
                isAssigned ? 'border-primary-400 border-2 bg-primary-50' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {practitioner.picture_url ? (
                    <img
                      src={practitioner.picture_url}
                      alt={practitioner.full_name}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                      <span className="text-gray-600 font-medium">
                        {practitioner.full_name.charAt(0)}
                      </span>
                    </div>
                  )}
                  <div>
                    <h3 className="font-medium text-gray-900">{practitioner.full_name}</h3>
                    {isAssigned && (
                      <p className="text-sm text-primary-600 font-medium">指定治療師</p>
                    )}
                  </div>
                </div>
                <div className="text-primary-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </button>
          );
        })}

        {practitioners.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">{t('practitioner.noPractitioners')}</p>
            <p className="text-sm text-gray-400 mt-2">
              {t('practitioner.noPractitionersDesc')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Step3SelectPractitioner;

