import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { logger } from '../../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { liffApiService } from '../../services/liffApi';
import { Practitioner } from '../../types';
import { useModal } from '../../contexts/ModalContext';
import { useLiffBackButton } from '../../hooks/useLiffBackButton';
import { useAppointmentStore } from '../../stores/appointmentStore';
import {
  formatTo12Hour,
  groupTimeSlots,
  generateCalendarDays,
  formatMonthYear,
  formatDateString,
  buildDatesToCheckForMonth,
  isToday,
} from '../../utils/calendarUtils';
import moment from 'moment-timezone';
import { checkCancellationConstraint } from '../../utils/appointmentConstraints';

const RescheduleFlow: React.FC = () => {
  const { t } = useTranslation();
  const { alert: showAlert } = useModal();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointmentId');
  const { clinicId } = useAppointmentStore();

  // Enable back button navigation
  useLiffBackButton('query');

  // Loading states
  const [isLoadingDetails, setIsLoadingDetails] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimumCancellationHours, setMinimumCancellationHours] = useState<number | null>(null);

  // Appointment details
  const [appointmentDetails, setAppointmentDetails] = useState<{
    id: number;
    calendar_event_id?: number;
    patient_id: number;
    patient_name: string;
    practitioner_id: number;
    practitioner_name: string;
    appointment_type_id: number;
    appointment_type_name: string;
    start_time: string;
    end_time: string;
    status: string;
    notes?: string;
    is_auto_assigned?: boolean;
  } | null>(null);

  // Form state
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(null);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [datesWithSlots, setDatesWithSlots] = useState<Set<string>>(new Set());
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [cachedAvailabilityData, setCachedAvailabilityData] = useState<Map<string, { slots: any[] }>>(new Map());

  // Load clinic info for minimum cancellation hours
  useEffect(() => {
    const loadClinicInfo = async () => {
      try {
        const clinicInfo = await liffApiService.getClinicInfo();
        setMinimumCancellationHours(clinicInfo.minimum_cancellation_hours_before || 24);
      } catch (err) {
        logger.error('Failed to load clinic info:', err);
        // Use default if failed to load
        setMinimumCancellationHours(24);
      }
    };

    loadClinicInfo();
  }, []);

  // Load appointment details
  useEffect(() => {
    const loadAppointmentDetails = async () => {
      if (!appointmentId) {
        setError(t('appointment.errors.missingAppointmentId'));
        setIsLoadingDetails(false);
        return;
      }

      try {
        setIsLoadingDetails(true);
        setError(null);
        const details = await liffApiService.getAppointmentDetails(parseInt(appointmentId));
        setAppointmentDetails(details);
        // If appointment is auto-assigned, set to null (不指定) in the UI
        // Otherwise, set to the current practitioner ID
        setSelectedPractitionerId(details.is_auto_assigned ? null : details.practitioner_id);
        setNotes(details.notes || '');
        
        // Set initial date/time from existing appointment
        const startMoment = moment(details.start_time).tz('Asia/Taipei');
        setSelectedDate(startMoment.format('YYYY-MM-DD'));
        setSelectedTime(startMoment.format('HH:mm'));
        setCurrentMonth(startMoment.toDate());
      } catch (err) {
        logger.error('Failed to load appointment details:', err);
        setError(t('appointment.errors.loadDetailsFailed'));
      } finally {
        setIsLoadingDetails(false);
      }
    };

    loadAppointmentDetails();
  }, [appointmentId]);

  // Load practitioners
  useEffect(() => {
    const loadPractitioners = async () => {
      if (!clinicId || !appointmentDetails?.appointment_type_id) return;

      try {
        const response = await liffApiService.getPractitioners(clinicId, appointmentDetails.appointment_type_id);
        setPractitioners(response.practitioners);
      } catch (err) {
        logger.error('Failed to load practitioners:', err);
      }
    };

    loadPractitioners();
  }, [clinicId, appointmentDetails?.appointment_type_id]);

  // Load availability for month
  useEffect(() => {
    if (!clinicId || !appointmentDetails?.appointment_type_id) return;

    const loadMonthAvailability = async () => {
      setLoadingAvailability(true);
      try {
        const datesToCheck = buildDatesToCheckForMonth(currentMonth);
        const batchResponse = await liffApiService.getAvailabilityBatch({
          dates: datesToCheck,
          appointment_type_id: appointmentDetails.appointment_type_id,
          practitioner_id: selectedPractitionerId ?? undefined,
          exclude_calendar_event_id: appointmentDetails.calendar_event_id || appointmentDetails.id,
        });

        const newCache = new Map<string, { slots: any[] }>();
        batchResponse.results.forEach(result => {
          newCache.set(result.date, { slots: result.slots });
        });
        setCachedAvailabilityData(newCache);

        const datesWithAvailableSlots = new Set<string>(
          batchResponse.results
            .filter(result => result.slots && result.slots.length > 0)
            .map(result => result.date)
        );
        setDatesWithSlots(datesWithAvailableSlots);
      } catch (err) {
        logger.error('Failed to load month availability:', err);
        setDatesWithSlots(new Set());
      } finally {
        setLoadingAvailability(false);
      }
    };

    loadMonthAvailability();
  }, [currentMonth, clinicId, appointmentDetails?.appointment_type_id, selectedPractitionerId]);

  // Load available slots for selected date
  useEffect(() => {
    if (!selectedDate || !clinicId || !appointmentDetails?.appointment_type_id) {
      setAvailableSlots([]);
      return;
    }

    const loadSlots = async () => {
      try {
        const cachedData = cachedAvailabilityData.get(selectedDate);
        if (cachedData && cachedData.slots && cachedData.slots.length > 0) {
          const slots = cachedData.slots.map((slot: any) => slot.start_time);
          setAvailableSlots(slots);
          return;
        }

        // If not in cache, fetch from API
        const response = await liffApiService.getAvailability({
          date: selectedDate,
          appointment_type_id: appointmentDetails.appointment_type_id,
          practitioner_id: selectedPractitionerId ?? undefined,
          exclude_calendar_event_id: appointmentDetails.calendar_event_id || appointmentDetails.id,
        });
        const slots = response.slots.map(slot => slot.start_time);
        setAvailableSlots(slots);
      } catch (err) {
        logger.error('Failed to load available slots:', err);
        setAvailableSlots([]);
      }
    };

    loadSlots();
    // Note: cachedAvailabilityData is intentionally not in deps to avoid re-running when cache updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedPractitionerId, appointmentDetails?.appointment_type_id, clinicId]);

  const handleSubmit = async () => {
    if (!appointmentId || !selectedDate || !selectedTime || !appointmentDetails) {
      await showAlert(t('appointment.errors.selectDateTime'), t('appointment.rescheduleFailedTitle'));
      return;
    }

    // Check constraint immediately before submitting
    if (!checkCancellationConstraint(appointmentDetails.start_time, minimumCancellationHours)) {
      await showAlert(
        t('appointment.errors.rescheduleTooSoon', { hours: minimumCancellationHours || 24 }),
        t('appointment.rescheduleFailedTitle')
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      // Combine date and time into ISO datetime string
      const newStartTime = moment.tz(`${selectedDate}T${selectedTime}`, 'Asia/Taipei').toISOString();

      // Determine practitioner ID to send:
      // - If same as original, send the ID to keep it
      // - If different (and not null), send the new ID
      // - If null (不指定 selected), send -1 for auto-assignment
      // - If undefined (not changed), send undefined to keep current
      let practitionerIdToSend: number | undefined;
      if (selectedPractitionerId === null) {
        // "不指定" selected - request auto-assignment
        practitionerIdToSend = -1;
      } else if (selectedPractitionerId === appointmentDetails.practitioner_id) {
        // Same as original - send ID to keep it
        practitionerIdToSend = appointmentDetails.practitioner_id;
      } else if (selectedPractitionerId !== null) {
        // Different practitioner selected
        practitionerIdToSend = selectedPractitionerId;
      }
      // else: undefined means keep current (shouldn't happen in normal flow)

      await liffApiService.rescheduleAppointment(parseInt(appointmentId), {
        new_practitioner_id: practitionerIdToSend ?? null,
        new_start_time: newStartTime,
        new_notes: notes || null,
      });

      // Show success message
      await showAlert(
        t('appointment.reschedule.success'),
        t('appointment.reschedule.successTitle')
      );

      // Navigate back to appointment list
      navigate('/liff?mode=query');
    } catch (err: any) {
      logger.error('Failed to reschedule appointment:', err);
      
      // Check for structured error response
      const errorDetail = err?.response?.data?.detail;
      if (errorDetail && typeof errorDetail === 'object' && errorDetail.error === 'reschedule_too_soon') {
        // Use structured error response
        const hours = errorDetail.minimum_hours || 24;
        await showAlert(t('appointment.errors.rescheduleTooSoon', { hours }), t('appointment.rescheduleFailedTitle'));
      } else {
        // Fallback: try to extract from error message (for backward compatibility)
        const errorMessage = typeof errorDetail === 'string' ? errorDetail : errorDetail?.message || '';
        // Check for numeric pattern that works across languages
        const hoursMatch = errorMessage.match(/(\d+)/);
        if (hoursMatch && (
          errorMessage.includes('改期') || 
          errorMessage.includes('reschedule') || 
          errorMessage.includes('変更')
        )) {
          const hours = hoursMatch[1];
          await showAlert(t('appointment.errors.rescheduleTooSoon', { hours }), t('appointment.rescheduleFailedTitle'));
        } else {
          await showAlert(t('appointment.errors.rescheduleFailed'), t('appointment.rescheduleFailedTitle'));
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate original time and date (must be before early returns for hooks)
  const originalTime = appointmentDetails ? moment(appointmentDetails.start_time).tz('Asia/Taipei').format('HH:mm') : null;
  const originalDate = appointmentDetails ? moment(appointmentDetails.start_time).tz('Asia/Taipei').format('YYYY-MM-DD') : null;
  
  // Build time slots list - include original time if editing and date/practitioner match
  // Must be before early returns to maintain hook order
  const allTimeSlots = useMemo(() => {
    if (!selectedDate || !appointmentDetails) return availableSlots;
    
    const slots = [...availableSlots];
    
    // If editing and original time/date match, include original time even if not available
    if (originalTime && originalDate) {
      const isOriginalDate = selectedDate === originalDate;
      
      // For auto-assigned appointments, include original time if date matches (regardless of practitioner selection)
      // For specific appointments, include original time if both date and practitioner match
      const originalWasAutoAssigned = appointmentDetails.is_auto_assigned ?? false;
      const shouldIncludeOriginalTime = isOriginalDate && (
        originalWasAutoAssigned || 
        selectedPractitionerId === appointmentDetails.practitioner_id
      );
      
      if (shouldIncludeOriginalTime && !slots.includes(originalTime)) {
        slots.push(originalTime);
        slots.sort();
      }
    }
    
    return slots;
  }, [availableSlots, originalTime, originalDate, selectedDate, selectedPractitionerId, appointmentDetails]);
  
  // Check if anything changed (must be before early returns for hooks)
  const hasChanges = useMemo(() => {
    if (!appointmentDetails || !selectedDate || !selectedTime) return false;
    
    const originalNotes = appointmentDetails.notes || '';
    
    // For practitioner: compare selectedPractitionerId with original
    // If original was auto-assigned, selectedPractitionerId should be null to match
    // If original was specific, selectedPractitionerId should match the ID
    const originalWasAutoAssigned = appointmentDetails.is_auto_assigned ?? false;
    const practitionerChanged = originalWasAutoAssigned
      ? selectedPractitionerId !== null  // Was auto-assigned, now specific = changed
      : selectedPractitionerId !== appointmentDetails.practitioner_id;  // Was specific, check if different
    
    const dateChanged = selectedDate !== originalDate;
    const timeChanged = selectedTime !== originalTime;
    const notesChanged = notes !== originalNotes;
    
    return practitionerChanged || dateChanged || timeChanged || notesChanged;
  }, [appointmentDetails, selectedDate, selectedTime, selectedPractitionerId, notes, originalDate, originalTime]);

  if (isLoadingDetails) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
          </div>
        </div>
      </div>
    );
  }

  if (error || !appointmentDetails) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <div className="my-8">
            <ErrorMessage message={error || t('appointment.errors.loadDetailsFailed')} onRetry={() => navigate('/liff?mode=query')} />
          </div>
        </div>
      </div>
    );
  }

  const calendarDays = generateCalendarDays(currentMonth);
  const { amSlots, pmSlots } = selectedDate ? groupTimeSlots(allTimeSlots) : { amSlots: [], pmSlots: [] };
  
  // Day names - use translation
  const dayNames = t('datetime.dayNames', { returnObjects: true }) as string[];
  
  // Helper to check if date is available
  const isDateAvailable = (date: Date): boolean => {
    const dateString = formatDateString(date);
    return datesWithSlots.has(dateString);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('appointment.reschedule.title')}</h1>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
          {/* Patient name (read-only, grayed out) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('appointment.reschedule.patientName')}
            </label>
            <input
              type="text"
              value={appointmentDetails.patient_name}
              disabled
              className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 text-gray-600"
            />
          </div>

          {/* Appointment type (read-only, grayed out) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('appointment.reschedule.appointmentType')}
            </label>
            <input
              type="text"
              value={appointmentDetails.appointment_type_name}
              disabled
              className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 text-gray-600"
            />
          </div>

          {/* Practitioner selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('appointment.reschedule.practitioner')}
            </label>
            <select
              value={selectedPractitionerId !== null ? selectedPractitionerId : ''}
              onChange={(e) => {
                const newPractitionerId = e.target.value ? parseInt(e.target.value) : null;
                setSelectedPractitionerId(newPractitionerId);
                // Reset date/time when practitioner changes
                setSelectedDate(null);
                setSelectedTime(null);
              }}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
              <option value="">{t('practitioner.notSpecified')}</option>
            </select>
          </div>

          {/* Date/Time Picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('appointment.reschedule.selectDateTime')}
            </label>

            {/* Calendar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => {
                    const prevMonth = new Date(currentMonth);
                    prevMonth.setMonth(prevMonth.getMonth() - 1);
                    setCurrentMonth(prevMonth);
                  }}
                  className="p-2 hover:bg-gray-100 rounded"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h3 className="text-lg font-semibold">{formatMonthYear(currentMonth)}</h3>
                <button
                  onClick={() => {
                    const nextMonth = new Date(currentMonth);
                    nextMonth.setMonth(nextMonth.getMonth() + 1);
                    setCurrentMonth(nextMonth);
                  }}
                  className="p-2 hover:bg-gray-100 rounded"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              {/* Days of Week Header */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {dayNames.map((day) => (
                  <div key={day} className="text-center text-sm font-medium text-gray-600 py-2">
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar Grid */}
              {loadingAvailability ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner size="sm" />
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((day, index) => {
                    // Handle null days (padding days before month starts)
                    if (day === null) {
                      return <div key={`empty-${index}`} className="aspect-square" />;
                    }

                    const dateStr = formatDateString(day);
                    const available = isDateAvailable(day);
                    const isSelected = selectedDate === dateStr;
                    const isOriginalDate = dateStr === originalDate;
                    const todayDate = isToday(day);

                    return (
                      <button
                        key={dateStr}
                        onClick={() => {
                          if (available) {
                            setSelectedDate(dateStr);
                            setSelectedTime(null);
                          }
                        }}
                        disabled={!available}
                        className={`aspect-square text-center rounded-lg transition-colors relative ${
                          isSelected
                            ? 'bg-teal-500 text-white font-semibold'
                            : available
                            ? 'bg-white text-gray-900 font-semibold hover:bg-gray-50 border border-gray-200'
                            : 'bg-gray-50 text-gray-400 cursor-not-allowed border border-gray-100'
                        } ${isOriginalDate ? 'ring-2 ring-blue-300' : ''}`}
                      >
                        <div className="flex flex-col items-center justify-center h-full">
                          <span className={isSelected ? 'text-white' : available ? 'text-gray-900' : 'text-gray-400'}>
                            {day.getDate()}
                          </span>
                          {todayDate && (
                            <div className={`w-4 h-0.5 mt-0.5 ${isSelected ? 'bg-white' : 'bg-gray-500'}`} />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Time slots */}
            {selectedDate && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('appointment.reschedule.selectTime')}
                </label>
                {availableSlots.length > 0 ? (
                  <div className="space-y-3">
                    {amSlots.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 mb-2">{t('datetime.morning')}</div>
                        <div className="grid grid-cols-3 gap-2">
                          {amSlots.map((slot) => {
                            const isSelected = selectedTime === slot;
                            const isOriginalTime = slot === originalTime && selectedDate === originalDate;

                            return (
                              <button
                                key={slot}
                                onClick={() => setSelectedTime(slot)}
                                className={`
                                  py-2 px-3 rounded-md text-sm font-medium
                                  ${isSelected ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:border-blue-500'}
                                  ${isOriginalTime ? 'ring-2 ring-blue-300' : ''}
                                `}
                              >
                                {(() => {
                                  const formatted = formatTo12Hour(slot);
                                  // Remove leading zero from hour for display (e.g., "09:00" -> "9:00")
                                  const timeParts = formatted.time12.split(':');
                                  const hour = parseInt(timeParts[0] || '0', 10);
                                  const minutes = timeParts[1] || '00';
                                  return `${hour}:${minutes}`;
                                })()}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {pmSlots.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 mb-2">{t('datetime.afternoon')}</div>
                        <div className="grid grid-cols-3 gap-2">
                          {pmSlots.map((slot) => {
                            const isSelected = selectedTime === slot;
                            const isOriginalTime = slot === originalTime && selectedDate === originalDate;

                            return (
                              <button
                                key={slot}
                                onClick={() => setSelectedTime(slot)}
                                className={`
                                  py-2 px-3 rounded-md text-sm font-medium
                                  ${isSelected ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:border-blue-500'}
                                  ${isOriginalTime ? 'ring-2 ring-blue-300' : ''}
                                `}
                              >
                                {(() => {
                                  const formatted = formatTo12Hour(slot);
                                  // Remove leading zero from hour for display (e.g., "09:00" -> "9:00")
                                  const timeParts = formatted.time12.split(':');
                                  const hour = parseInt(timeParts[0] || '0', 10);
                                  const minutes = timeParts[1] || '00';
                                  return `${hour}:${minutes}`;
                                })()}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">{t('appointment.reschedule.noSlotsAvailable')}</p>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('notes.title')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={notes ? undefined : t('notes.placeholder')}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              maxLength={500}
            />
            <p className="text-sm text-gray-500 mt-1">{t('notes.charCount', { count: notes.length })}</p>
          </div>

          {/* Submit button */}
          <div className="pt-4 border-t border-gray-200">
            <button
              onClick={handleSubmit}
              disabled={!selectedDate || !selectedTime || isSubmitting || !hasChanges}
              className={`
                w-full py-3 px-4 rounded-md font-medium
                ${!selectedDate || !selectedTime || isSubmitting || !hasChanges
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
                }
              `}
            >
              {isSubmitting ? t('appointment.reschedule.submitting') : t('appointment.reschedule.confirmButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RescheduleFlow;

