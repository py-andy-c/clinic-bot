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
  generateCalendarDays,
  formatMonthYear,
  formatDateString,
  buildDatesToCheckForMonth,
  isToday,
  getPractitionerDisplayName,
} from '../../utils/calendarUtils';
import moment from 'moment-timezone';
import { checkCancellationConstraint } from '../../utils/appointmentConstraints';

// Type definitions for slot details
interface SlotDetail {
  is_recommended?: boolean;
}

interface AvailabilitySlot {
  start_time: string;
  end_time: string;
  is_recommended?: boolean;
}

type RescheduleStep = 'form' | 'review';

const RescheduleFlow: React.FC = () => {
  const { t } = useTranslation();
  const { alert: showAlert } = useModal();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointmentId');
  const { clinicId } = useAppointmentStore();

  // Enable back button navigation
  useLiffBackButton('query');

  // Step state
  const [step, setStep] = useState<RescheduleStep>('form');

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
    appointment_type?: {
      id: number;
      name: string;
      allow_patient_practitioner_selection: boolean;
    } | null;
    start_time: string;
    end_time: string;
    status: string;
    notes?: string;
    is_auto_assigned?: boolean;
    assigned_practitioners?: Array<{
      id: number;
      full_name: string;
      is_active?: boolean;
    }>;
  } | null>(null);

  // Form state
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(null);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  // Track slot details (e.g., recommended status) for badge display
  const [slotDetails, setSlotDetails] = useState<Map<string, SlotDetail>>(new Map());
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [datesWithSlots, setDatesWithSlots] = useState<Set<string>>(new Set());
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [cachedAvailabilityData, setCachedAvailabilityData] = useState<Map<string, { slots: AvailabilitySlot[] }>>(new Map());

  // State for assigned practitioners and restriction setting
  const [assignedPractitionerIds, setAssignedPractitionerIds] = useState<Set<number>>(new Set());
  const [restrictToAssigned, setRestrictToAssigned] = useState(false);

  // Load clinic info for minimum cancellation hours and restrict_to_assigned_practitioners
  useEffect(() => {
    const loadClinicInfo = async () => {
      try {
        const clinicInfo = await liffApiService.getClinicInfo();
        setMinimumCancellationHours(clinicInfo.minimum_cancellation_hours_before || 24);
        setRestrictToAssigned(clinicInfo.restrict_to_assigned_practitioners || false);
      } catch (err) {
        logger.error('Failed to load clinic info:', err);
        // Use default if failed to load
        setMinimumCancellationHours(24);
        setRestrictToAssigned(false);
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
  }, [appointmentId, t]);

  // Load assigned practitioners for the patient from appointment details
  useEffect(() => {
    if (!appointmentDetails?.assigned_practitioners) {
      setAssignedPractitionerIds(new Set());
      return;
    }

    try {
      // Get active assigned practitioners from appointment details
      const activeAssigned = appointmentDetails.assigned_practitioners
        .filter((p) => p.is_active !== false)
        .map((p) => p.id);
      setAssignedPractitionerIds(new Set(activeAssigned));
    } catch (err) {
      logger.error('Failed to process assigned practitioners:', err);
      setAssignedPractitionerIds(new Set());
    }
  }, [appointmentDetails?.assigned_practitioners]);

  // Load practitioners
  useEffect(() => {
    const loadPractitioners = async () => {
      if (!clinicId || !appointmentDetails?.appointment_type_id) return;

      try {
        // Get practitioners with patient_id filter if patient is known
        const response = await liffApiService.getPractitioners(
          clinicId,
          appointmentDetails.appointment_type_id,
          appointmentDetails.patient_id
        );
        
        let allPractitioners = response.practitioners;
        
        // Filter practitioners based on restrict_to_assigned_practitioners setting
        // When true, backend already filtered to assigned practitioners only
        // When false, show all practitioners (assigned ones will be highlighted using assignedPractitionerIds)
        if (restrictToAssigned && appointmentDetails.patient_id && assignedPractitionerIds.size > 0) {
          // Check if any assigned practitioners offer the selected appointment type
          const assignedPractitioners = allPractitioners.filter(p => 
            assignedPractitionerIds.has(p.id)
          );
          
          // Check if assigned practitioners offer this appointment type
          const assignedOfferingType = assignedPractitioners.filter(p =>
            p.offered_types.includes(appointmentDetails.appointment_type_id)
          );

          if (assignedOfferingType.length > 0) {
            // Show only assigned practitioners that offer this type
            allPractitioners = assignedOfferingType;
          } else {
            // Edge case: No assigned practitioners offer this type - show all
            // (including "不指定")
          }
        } else if (restrictToAssigned && appointmentDetails.patient_id && assignedPractitionerIds.size === 0) {
          // Edge case: No assigned practitioners - show all (including "不指定")
        }

        // Sort practitioners: assigned practitioners first, then others
        // Only sort if we have assigned practitioner IDs (patient is known and has assignments)
        const sortedPractitioners = assignedPractitionerIds.size > 0
          ? [...allPractitioners].sort((a, b) => {
              const aIsAssigned = assignedPractitionerIds.has(a.id);
              const bIsAssigned = assignedPractitionerIds.has(b.id);
              
              if (aIsAssigned && !bIsAssigned) return -1; // a comes first
              if (!aIsAssigned && bIsAssigned) return 1;  // b comes first
              return 0; // Keep original order for same category
            })
          : allPractitioners;

        setPractitioners(sortedPractitioners);
      } catch (err) {
        logger.error('Failed to load practitioners:', err);
      }
    };

    loadPractitioners();
    // Convert Set to array for dependency tracking (React doesn't detect Set changes well)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, appointmentDetails?.appointment_type_id, appointmentDetails?.patient_id, restrictToAssigned, Array.from(assignedPractitionerIds).join(',')]);

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

        const newCache = new Map<string, { slots: AvailabilitySlot[] }>();
        const newSlotDetails = new Map<string, SlotDetail>();
        batchResponse.results.forEach(result => {
          // Cache key includes practitioner ID to ensure cache is practitioner-specific
          const cacheKey = selectedPractitionerId ? `${selectedPractitionerId}-${result.date}` : result.date;
          newCache.set(cacheKey, { slots: result.slots });
          // Store slot details for recommended badge display
          if (result.slots) {
            result.slots.forEach((slot: AvailabilitySlot) => {
              if (slot.is_recommended !== undefined) {
                newSlotDetails.set(slot.start_time, { is_recommended: slot.is_recommended });
              }
            });
          }
        });
        setCachedAvailabilityData(newCache);
        setSlotDetails(newSlotDetails);

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
  }, [currentMonth, clinicId, appointmentDetails?.appointment_type_id, appointmentDetails?.calendar_event_id, appointmentDetails?.id, selectedPractitionerId]);

  // Load available slots for selected date
  useEffect(() => {
    if (!selectedDate || !clinicId || !appointmentDetails?.appointment_type_id) {
      setAvailableSlots([]);
      setSlotDetails(new Map());
      return;
    }

    const loadSlots = async () => {
      try {
        // Cache key includes practitioner ID to ensure we get the right practitioner's slots
        const cacheKey = selectedPractitionerId ? `${selectedPractitionerId}-${selectedDate}` : selectedDate;
        const cachedData = cachedAvailabilityData.get(cacheKey);
        if (cachedData && cachedData.slots && cachedData.slots.length > 0) {
          const slots = cachedData.slots.map((slot: AvailabilitySlot) => slot.start_time);
          setAvailableSlots(slots);
          
          // Store slot details for recommended badge display
          const detailsMap = new Map<string, SlotDetail>();
          cachedData.slots.forEach((slot: AvailabilitySlot) => {
            if (slot.is_recommended !== undefined) {
              detailsMap.set(slot.start_time, { is_recommended: slot.is_recommended });
            }
          });
          setSlotDetails(detailsMap);
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
        
        // Store slot details for recommended badge display
        const detailsMap = new Map<string, SlotDetail>();
        response.slots.forEach((slot: AvailabilitySlot) => {
          if (slot.is_recommended !== undefined) {
            detailsMap.set(slot.start_time, { is_recommended: slot.is_recommended });
          }
        });
        setSlotDetails(detailsMap);
      } catch (err) {
        logger.error('Failed to load available slots:', err);
        setAvailableSlots([]);
        setSlotDetails(new Map());
      }
    };

    loadSlots();
    // Note: cachedAvailabilityData is intentionally not in deps to avoid re-running when cache updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedPractitionerId, appointmentDetails?.appointment_type_id, clinicId]);

  const handleFormSubmit = () => {
    if (!appointmentId || !selectedDate || !selectedTime || !appointmentDetails) {
      showAlert(t('appointment.errors.selectDateTime'), t('appointment.rescheduleFailedTitle'));
      return;
    }

    // Check constraint before proceeding to review
    if (!checkCancellationConstraint(appointmentDetails.start_time, minimumCancellationHours)) {
      showAlert(
        t('appointment.errors.rescheduleTooSoon', { hours: minimumCancellationHours || 24 }),
        t('appointment.rescheduleFailedTitle')
      );
      return;
    }

    // Proceed to review step
    setStep('review');
  };

  const handleReviewSubmit = async () => {
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
      // - If practitioner selection is not allowed, always keep current practitioner
      // - If same as original, send the ID to keep it
      // - If different (and not null), send the new ID
      // - If null (不指定 selected), send -1 for auto-assignment
      // - If undefined (not changed), send undefined to keep current
      let practitionerIdToSend: number | undefined;
      
      // If practitioner selection is disabled, always keep current practitioner
      if (appointmentDetails.appointment_type?.allow_patient_practitioner_selection === false) {
        practitionerIdToSend = appointmentDetails.practitioner_id;
      } else if (selectedPractitionerId === null) {
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
    } catch (err: unknown) {
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
          errorMessage.includes('修改') || 
          errorMessage.includes('edit') || 
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

  // Helper component to render recommended badge
  const renderRecommendedBadge = (isRecommended: boolean) => {
    if (!isRecommended) return null;
    return (
      <span className="absolute -top-2 -right-2 bg-teal-500 text-white text-xs font-medium px-1.5 py-0.5 rounded shadow-sm">
        {t('datetime.recommended')}
      </span>
    );
  };
  
  // Build time slots list - include original time only if same practitioner AND same date
  // Must be before early returns to maintain hook order
  const allTimeSlots = useMemo(() => {
    if (!selectedDate || !appointmentDetails) return availableSlots;
    
    const slots = [...availableSlots];
    
    // Only include original time if same practitioner AND same date
    // (The appointment being edited holds that slot, so it won't be in available slots)
    if (originalTime && originalDate) {
      const isOriginalDate = selectedDate === originalDate;
      // For auto-assigned appointments, practitioner_id is null, so check if selectedPractitionerId is also null
      // For specific appointments, check if selectedPractitionerId matches
      const originalWasAutoAssigned = appointmentDetails.is_auto_assigned ?? false;
      const isOriginalPractitioner = originalWasAutoAssigned
        ? selectedPractitionerId === null
        : selectedPractitionerId === appointmentDetails.practitioner_id;
      
      if (isOriginalDate && isOriginalPractitioner && !slots.includes(originalTime)) {
        slots.push(originalTime);
        slots.sort();
      }
    }
    
    return slots;
  }, [availableSlots, originalTime, originalDate, selectedDate, selectedPractitionerId, appointmentDetails]);
  
  // Auto-select original time whenever it's in the displayed slots
  useEffect(() => {
    // Auto-select if:
    // 1. Original time is in the displayed slots
    // 2. No time is currently selected
    // 3. We have appointment details and a selected date
    if (
      originalTime &&
      !selectedTime &&
      appointmentDetails &&
      selectedDate &&
      allTimeSlots.length > 0 &&
      allTimeSlots.includes(originalTime)
    ) {
      setSelectedTime(originalTime);
    }
  }, [originalTime, selectedTime, appointmentDetails, selectedDate, allTimeSlots]);

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

  // Check which specific fields changed
  const changeDetails = useMemo(() => {
    if (!appointmentDetails || !selectedDate || !selectedTime) {
      return { practitionerChanged: false, timeChanged: false, dateChanged: false, notesChanged: false };
    }

    const originalNotes = appointmentDetails.notes || '';
    const originalWasAutoAssigned = appointmentDetails.is_auto_assigned ?? false;
    const practitionerChanged = originalWasAutoAssigned
      ? selectedPractitionerId !== null
      : selectedPractitionerId !== appointmentDetails.practitioner_id;
    const dateChanged = selectedDate !== originalDate;
    const timeChanged = selectedTime !== originalTime;
    const notesChanged = notes !== originalNotes;

    return { practitionerChanged, timeChanged, dateChanged, notesChanged };
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
  const sortedTimeSlots = selectedDate ? [...allTimeSlots].sort() : [];
  
  // Day names - use translation
  const dayNames = t('datetime.dayNames', { returnObjects: true }) as string[];
  
  // Helper to check if date is available
  const isDateAvailable = (date: Date): boolean => {
    const dateString = formatDateString(date);
    return datesWithSlots.has(dateString);
  };

  // Render review step
  const renderReviewStep = () => {
    if (!appointmentDetails || !selectedDate || !selectedTime) return null;

    const newDateStr = selectedDate;
    const newTimeStr = selectedTime;
    const originalDateStr = originalDate || '';
    const originalTimeStr = originalTime || '';

    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('appointment.reschedule.reviewTitle') || '確認變更'}</h1>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
            {/* Original Appointment */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('appointment.reschedule.original')}</h4>
              <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-2">
                <div>
                  <span className="text-sm text-gray-600">{t('appointment.reschedule.practitioner')}：</span>
                  <span className="text-sm text-gray-900">
                    {getPractitionerDisplayName(practitioners, appointmentDetails.practitioner_id, appointmentDetails.is_auto_assigned ?? false, { useTranslation: true, t })}
                  </span>
                </div>
                <div>
                  <span className="text-sm text-gray-600">{t('appointment.reschedule.date') || '日期'}：</span>
                  <span className="text-sm text-gray-900">{originalDateStr}</span>
                </div>
                <div>
                  <span className="text-sm text-gray-600">{t('appointment.reschedule.time') || '時間'}：</span>
                  <span className="text-sm text-gray-900">{originalTimeStr}</span>
                </div>
                {appointmentDetails.notes && (
                  <div>
                    <span className="text-sm text-gray-600">{t('notes.title')}：</span>
                    <span className="text-sm text-gray-900">{appointmentDetails.notes}</span>
                  </div>
                )}
              </div>
            </div>

            {/* New Appointment */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('appointment.reschedule.new') || '新預約'}</h4>
              <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-2">
                <div>
                  <span className="text-sm text-gray-600">{t('appointment.reschedule.practitioner')}：</span>
                  <span className="text-sm text-gray-900">
                    {getPractitionerDisplayName(practitioners, selectedPractitionerId, false, { useTranslation: true, t })}
                    {changeDetails.practitionerChanged && <span className="ml-2 text-blue-600">✏️</span>}
                  </span>
                </div>
                <div>
                  <span className="text-sm text-gray-600">{t('appointment.reschedule.date') || '日期'}：</span>
                  <span className="text-sm text-gray-900">
                    {newDateStr}
                    {changeDetails.dateChanged && <span className="ml-2 text-blue-600">✏️</span>}
                  </span>
                </div>
                <div>
                  <span className="text-sm text-gray-600">{t('appointment.reschedule.time') || '時間'}：</span>
                  <span className="text-sm text-gray-900">
                    {newTimeStr}
                    {changeDetails.timeChanged && <span className="ml-2 text-blue-600">✏️</span>}
                  </span>
                </div>
                {changeDetails.notesChanged && notes && (
                  <div>
                    <span className="text-sm text-gray-600">{t('notes.title')}：</span>
                    <span className="text-sm text-gray-900">
                      {notes}
                      <span className="ml-2 text-blue-600">✏️</span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="pt-4 border-t border-gray-200 space-y-2">
              <button
                onClick={() => setStep('form')}
                disabled={isSubmitting}
                className="w-full py-3 px-4 rounded-md font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                {t('appointment.reschedule.backButton') || '返回修改'}
              </button>
              <button
                onClick={handleReviewSubmit}
                disabled={isSubmitting}
                className={`
                  w-full py-3 px-4 rounded-md font-medium
                  ${isSubmitting
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

  // Render based on current step
  if (step === 'review') {
    return renderReviewStep();
  }

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

          {/* Practitioner selection - only show if allowed */}
          {appointmentDetails?.appointment_type?.allow_patient_practitioner_selection !== false && (
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
                {practitioners.map((p) => {
                  const isOriginalPractitioner = !appointmentDetails?.is_auto_assigned && p.id === appointmentDetails?.practitioner_id;
                  const isAssigned = assignedPractitionerIds.has(p.id);
                  return (
                    <option 
                      key={p.id} 
                      value={p.id}
                      className={isAssigned ? 'bg-primary-50 text-primary-900' : ''}
                    >
                      {p.full_name}
                      {isAssigned ? ` (${t('practitioner.assignedPractitioner')})` : ''}
                      {isOriginalPractitioner ? ` (${t('appointment.reschedule.originalPractitioner')})` : ''}
                    </option>
                  );
                })}
                <option value="">{t('practitioner.notSpecified')}</option>
              </select>
            </div>
          )}

          {/* Date/Time Picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('appointment.reschedule.selectDateTime')}
            </label>

            {/* Display original appointment time */}
            {originalDate && originalTime && (
              <div className="mb-4 bg-blue-50 border border-blue-200 rounded-md p-3">
                <p className="text-sm font-medium text-blue-900">
                  <span className="font-semibold">{t('appointment.reschedule.original')}：</span>
                  {originalDate} {originalTime}
                </p>
              </div>
            )}

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
                        className={`aspect-square text-center rounded-lg transition-colors ${
                          isSelected
                            ? 'bg-teal-500 text-white font-semibold'
                            : available
                            ? 'bg-white text-gray-900 font-semibold hover:bg-gray-50 border border-gray-200'
                            : 'bg-gray-50 text-gray-400 cursor-not-allowed border border-gray-100'
                        }`}
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
                  <div className="grid grid-cols-3 gap-2">
                    {sortedTimeSlots.map((slot) => {
                      const isSelected = selectedTime === slot;
                      const isRecommended = slotDetails.get(slot)?.is_recommended === true;

                      return (
                        <button
                          key={slot}
                          onClick={() => setSelectedTime(slot)}
                          className={`
                            py-2 px-3 rounded-md text-sm font-medium relative
                            ${isSelected ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:border-blue-500'}
                            ${isRecommended ? 'border-teal-400 border-2' : ''}
                          `}
                        >
                          {renderRecommendedBadge(isRecommended)}
                          {slot}
                        </button>
                      );
                    })}
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
              onClick={handleFormSubmit}
              disabled={!selectedDate || !selectedTime || isSubmitting || !hasChanges}
              className={`
                w-full py-3 px-4 rounded-md font-medium
                ${!selectedDate || !selectedTime || isSubmitting || !hasChanges
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
                }
              `}
            >
              {t('appointment.reschedule.nextButton') || '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RescheduleFlow;

