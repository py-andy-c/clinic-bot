import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../../utils/logger';
import moment from 'moment-timezone';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';
import { formatAppointmentDateTime, formatAppointmentDateOnly } from '../../utils/calendarUtils';
import { getErrorMessage } from '../../types/api';

const Step6Confirmation: React.FC = () => {
  const { t } = useTranslation();
  const { appointmentType, practitioner, practitionerId, isAutoAssigned, date, startTime, selectedTimeSlots, isMultipleSlotMode, patient, notes, clinicId, setCreatedAppointment, isEffectiveMultipleSlotMode } = useAppointmentStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    // Validate required data based on mode
    const missingData: string[] = [];
    if (!appointmentType) missingData.push('appointmentType');
    if (!patient) missingData.push('patient');
    if (!clinicId) missingData.push('clinicId');

    if (isMultipleSlotMode) {
      if (!selectedTimeSlots || selectedTimeSlots.length === 0) {
        missingData.push('selectedTimeSlots');
      }
    } else {
      if (!date) missingData.push('date');
      if (!startTime) missingData.push('startTime');
    }

    if (missingData.length > 0) {
      console.error(`Missing required data: ${missingData.join(', ')}`);
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      // Prepare appointment creation data
      const appointmentData: any = {
        patient_id: patient!.id,
        appointment_type_id: appointmentType!.id,
        practitioner_id: practitioner?.id ?? undefined,
        notes: notes || undefined,
      };

      // Determine effective multiple slot mode based on actual slots selected
      const effectiveAllowMultiple = isEffectiveMultipleSlotMode();

      if (effectiveAllowMultiple) {
        // Multiple slots (2+) selected - use pending confirmation flow
        const taiwanTimezone = 'Asia/Taipei';
        appointmentData.selected_time_slots = selectedTimeSlots!.map(slot => {
          const timeWithSeconds = slot.time.includes(':') && slot.time.split(':').length === 2 ? `${slot.time}:00` : slot.time;
          const dateTimeTaiwan = moment.tz(`${slot.date}T${timeWithSeconds}`, taiwanTimezone);
          return dateTimeTaiwan.format();
        });
        appointmentData.allow_multiple_time_slot_selection = true;
      } else {
        // Single slot or regular appointment - use immediate confirmation
        const taiwanTimezone = 'Asia/Taipei';
        let timeWithSeconds: string;
        let slotDate: string;

        if (isMultipleSlotMode && selectedTimeSlots && selectedTimeSlots.length === 1) {
          // Single slot in multiple slot mode - use the selected slot
          const slot = selectedTimeSlots[0];
          if (!slot) {
            setError(t('confirmation.dateTimeError'));
            return;
          }
          timeWithSeconds = slot.time.includes(':') && slot.time.split(':').length === 2 ? `${slot.time}:00` : slot.time;
          slotDate = slot.date;
        } else {
          // Regular single slot mode
          if (!startTime || !date) {
            setError(t('confirmation.dateTimeError'));
            return;
          }
          timeWithSeconds = startTime.includes(':') && startTime.split(':').length === 2
            ? `${startTime}:00`
            : startTime;
          slotDate = date;
        }

        // Parse as Taiwan time using moment-timezone
        const startDateTimeTaiwan = moment.tz(`${slotDate}T${timeWithSeconds}`, taiwanTimezone);

        if (!startDateTimeTaiwan.isValid()) {
          setError(t('confirmation.dateTimeError'));
          return;
        }

        appointmentData.start_time = startDateTimeTaiwan.format();
      }

      const response = await liffApiService.createAppointment(appointmentData);

      // For auto-assigned appointments, don't update practitioner in store
      // Patient should continue to see "不指定" even after appointment is created
      // Response will have practitioner_name as "不指定" from backend for auto-assigned appointments
      // We don't need to update the store since patient shouldn't see the practitioner

      // Store created appointment data for Step 7
      setCreatedAppointment({
        appointment_id: response.appointment_id,
        calendar_event_id: response.calendar_event_id,
        start_time: response.start_time,
        end_time: response.end_time,
      });

      // Success - move to step 7
      useAppointmentStore.setState({ step: 7 });
    } catch (err) {
      logger.error('Failed to create appointment:', err);
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDateTime = () => {
    if (isEffectiveMultipleSlotMode()) {
      // Multiple slots (2+) - show "待安排"
      return '待安排';
    }

    // For single slot appointments (including single slots in multiple mode), show the actual time
    if (isMultipleSlotMode && selectedTimeSlots && selectedTimeSlots.length === 1) {
      // Single slot in multiple slot mode - show actual time
      const slot = selectedTimeSlots[0];
      if (!slot) {
        return '';
      }
      const taiwanTimezone = 'Asia/Taipei';
      const timeWithSeconds = slot.time.includes(':') && slot.time.split(':').length === 2 ? `${slot.time}:00` : slot.time;
      const dateTimeTaiwan = moment.tz(`${slot.date}T${timeWithSeconds}`, taiwanTimezone);

      if (!dateTimeTaiwan.isValid()) {
        return '';
      }

      return formatAppointmentDateTime(dateTimeTaiwan.toDate());
    }

    if (!date || !startTime) return '';

    // Parse as Taiwan time for display
    const taiwanTimezone = 'Asia/Taipei';
    const timeWithSeconds = startTime.includes(':') && startTime.split(':').length === 2
      ? `${startTime}:00`
      : startTime;
    const dateTimeTaiwan = moment.tz(`${date}T${timeWithSeconds}`, taiwanTimezone);

    if (!dateTimeTaiwan.isValid()) {
      return '';
    }

    // Use shared formatting utility
    return formatAppointmentDateTime(dateTimeTaiwan.toDate());
  };

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {t('confirmation.title')}
        </h2>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-600">{t('confirmation.appointmentType')}</span>
            <span className="font-medium">{appointmentType?.name}</span>
          </div>
          {/* Only show practitioner field if appointment type allows patient to specify practitioner */}
          {appointmentType?.allow_patient_practitioner_selection !== false && (
            <div className="flex justify-between">
              <span className="text-gray-600">{t('confirmation.practitioner')}</span>
              <span className="font-medium">
                {/* For auto-assigned appointments, always show "不指定" (patient doesn't see practitioner name) */}
                {practitionerId === null || isAutoAssigned ? t('confirmation.notSpecified') : (practitioner?.full_name || t('confirmation.notSpecified'))}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-600">{t('confirmation.dateTime')}</span>
            <span className="font-medium">{formatDateTime()}</span>
          </div>
          {isEffectiveMultipleSlotMode() && (
            <div>
              <span className="text-gray-600">{t('confirmation.selectedSlots')}</span>
              <div className="mt-2">
                {(() => {
                  // Group slots by date
                  const groupedSlots = selectedTimeSlots.reduce((acc, slot) => {
                    if (!acc[slot.date]) {
                      acc[slot.date] = [];
                    }
                    acc[slot.date]!.push(slot);
                    return acc;
                  }, {} as Record<string, Array<{date: string, time: string}>>);

                  // Format date for display using standardized LIFF format

                  return Object.entries(groupedSlots)
                    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
                    .map(([date, slots]) => (
                      <div key={date} className="mb-3 last:mb-0">
                        <div className="text-sm text-gray-700 font-medium mb-2">
                          {formatAppointmentDateOnly(date)}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {slots.sort((a, b) => a.time.localeCompare(b.time)).map((slot) => (
                            <span key={`${slot.date}-${slot.time}`} className="inline-flex items-center px-2 py-1 bg-primary-100 text-primary-800 text-xs font-medium rounded">
                              {slot.time}
                            </span>
                          ))}
                        </div>
                      </div>
                    ));
                })()}
              </div>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-600">{t('confirmation.patient')}</span>
            <span className="font-medium">{patient?.full_name}</span>
          </div>
          {notes && (
            <div>
              <span className="text-gray-600">{t('confirmation.notes')}</span>
              <p className="mt-1 text-sm bg-gray-50 p-2 rounded">{notes}</p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        <button
          onClick={handleConfirm}
          disabled={isSubmitting}
          className="w-full bg-primary-600 text-white py-3 px-4 rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSubmitting ? t('confirmation.submitting') : t('confirmation.confirmButton')}
        </button>
      </div>
    </div>
  );
};

export default Step6Confirmation;
