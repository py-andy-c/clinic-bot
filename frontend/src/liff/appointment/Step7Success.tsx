import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import moment from 'moment-timezone';
import { logger } from '../../utils/logger';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { downloadAppointmentICS, generateGoogleCalendarURL } from '../../utils/icsGenerator';
import { useModal } from '../../contexts/ModalContext';
import { formatAppointmentDateTime } from '../../utils/calendarUtils';
import { liffApiService } from '../../services/liffApi';

const Step7Success: React.FC = () => {
  const { t } = useTranslation();
  const {
    appointmentType,
    practitioner,
    isAutoAssigned,
    createdAppointment,
    patient,
    notes,
    reset,
    clinicId,
    clinicDisplayName,
    clinicAddress,
    clinicPhoneNumber,
    setClinicInfo
  } = useAppointmentStore();
  const { alert: showAlert } = useModal();

  // Fetch clinic info if not already loaded (handles timing issue where Step7Success
  // might render before LiffApp's useEffect completes)
  // Note: setClinicInfo is stable (Zustand action), so we can omit it from deps
  // Race condition note: If user clicks "Add to Calendar" before fetch completes,
  // calendar event will use fallback values (clinic name from translation), which is acceptable
  useEffect(() => {
    const fetchClinicInfoIfNeeded = async () => {
      if (clinicId && !clinicDisplayName) {
        try {
          const clinicInfo = await liffApiService.getClinicInfo();
          setClinicInfo(
            clinicInfo.clinic_name,
            clinicInfo.display_name,
            clinicInfo.address,
            clinicInfo.phone_number
          );
        } catch (error) {
          logger.error('Failed to fetch clinic info in Step7Success:', error);
          // Clinic info is not critical for calendar events (we have fallbacks),
          // so we only log the error rather than showing user-facing feedback
        }
      }
    };

    fetchClinicInfoIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, clinicDisplayName]);

  const handleAddToCalendar = () => {
    if (!appointmentType || !createdAppointment || !patient) {
      logger.error('Missing appointment data for calendar:', {
        appointmentType,
        createdAppointment,
        patient
      });
      return;
    }

    try {
      // Use the created appointment's start_time and end_time
      // Parse as Taiwan time to ensure correct timezone handling
      const startDateTimeTaiwan = moment.tz(createdAppointment.start_time, 'Asia/Taipei');
      const endDateTimeTaiwan = moment.tz(createdAppointment.end_time, 'Asia/Taipei');

      if (!startDateTimeTaiwan.isValid() || !endDateTimeTaiwan.isValid()) {
        logger.error('Invalid date/time from created appointment:', createdAppointment);
        showAlert(t('success.calendarError'), t('success.calendarErrorTitle'));
        return;
      }

      // Pass Taiwan time directly (ISO format with timezone indicator)
      // For auto-assigned appointments, use "不指定" instead of practitioner name
    const appointmentData = {
      id: Date.now(), // Temporary ID for ICS generation
      appointment_type_name: appointmentType.name,
      practitioner_name: isAutoAssigned ? t('practitioner.notSpecified') : (practitioner?.full_name || t('success.practitionerPending')),
      patient_name: patient.full_name,
        start_time: startDateTimeTaiwan.format(), // Taiwan time with +08:00
        end_time: endDateTimeTaiwan.format(), // Taiwan time with +08:00
      notes: notes || undefined,
      clinic_name: clinicDisplayName || t('success.clinicName'),
      // Use explicit undefined instead of conditional spread for clarity and type safety
      // This ensures the property exists even when null, making the data structure predictable
      clinic_address: clinicAddress || undefined,
      clinic_phone_number: clinicPhoneNumber || undefined,
      is_auto_assigned: isAutoAssigned, // Pass flag for defensive check in ICS generator
    };

      // Use Google Calendar URL (works on all platforms - iOS, Android, Desktop)
      const googleCalendarURL = generateGoogleCalendarURL(appointmentData);
      
      // Try to open in default/system browser
      // On mobile/LIFF: window.open with _blank may open in external browser depending on OS/browser
      // We try window.open first, then fall back to location.href if popup is blocked
      try {
        // Try opening in new window/tab
        // On mobile, many browsers will open external URLs in system browser automatically
        const opened = window.open(googleCalendarURL, '_blank', 'noopener,noreferrer');
        
        // If popup was blocked (opened is null), navigate current window
        // This will open in external browser on mobile, but navigates away from LIFF app
        if (!opened) {
          // Popup blocker active, navigate current window to ensure external browser opens
          window.location.href = googleCalendarURL;
        }
      } catch (error) {
        // If window.open fails completely, navigate current window
        logger.log('window.open failed, using location.href:', error);
        window.location.href = googleCalendarURL;
      }
    } catch (error) {
      logger.error('Failed to open Google Calendar:', error);
      // Fallback to ICS download if Google Calendar URL fails
      try {
        const appointmentData = {
          id: createdAppointment.appointment_id,
          appointment_type_name: appointmentType.name,
          // For auto-assigned appointments, use "不指定" instead of practitioner name
          practitioner_name: isAutoAssigned ? t('practitioner.notSpecified') : (practitioner?.full_name || t('success.practitionerPending')),
          patient_name: patient.full_name,
          start_time: createdAppointment.start_time,
          end_time: createdAppointment.end_time,
          notes: notes || undefined,
          clinic_name: clinicDisplayName || t('success.clinicName'),
          // Use explicit undefined instead of conditional spread for clarity and type safety
          clinic_address: clinicAddress || undefined,
          clinic_phone_number: clinicPhoneNumber || undefined,
        };
    downloadAppointmentICS(appointmentData);
      } catch (fallbackError) {
        logger.error('Failed to download ICS as fallback:', fallbackError);
        showAlert(t('success.calendarErrorGeneric'), t('success.calendarErrorGenericTitle'));
      }
    }
  };

  const formatDateTime = () => {
    if (!createdAppointment) return '';

    // Parse the start_time from created appointment as Taiwan time
    // The ISO string from API has timezone info, but we need to ensure it's interpreted as Taiwan time
    const taiwanMoment = moment.tz(createdAppointment.start_time, 'Asia/Taipei');

    if (!taiwanMoment.isValid()) {
      return '';
    }

    // Use shared formatting utility
    return formatAppointmentDateTime(taiwanMoment.toDate());
  };

  const handleClose = () => {
    reset();
    // In LIFF, user can close the browser window
    // For web version, we might want to redirect or show a message
    if (window.liff) {
      // LIFF close
      window.liff.closeWindow();
    }
  };

  return (
    <div className="px-4 py-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          {t('success.title')}
        </h2>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-600">{t('success.appointmentType')}</span>
            <span className="font-medium">{appointmentType?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">{t('success.practitioner')}</span>
            <span className="font-medium">
              {/* For auto-assigned appointments, always show "不指定" (patient doesn't see practitioner name) */}
              {isAutoAssigned ? t('success.notSpecified') : (practitioner?.full_name || t('success.notSpecified'))}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">{t('success.dateTime')}</span>
            <span className="font-medium">{formatDateTime()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">{t('success.patient')}</span>
            <span className="font-medium">{patient?.full_name}</span>
          </div>
          {notes && (
            <div>
              <span className="text-gray-600">{t('success.notes')}</span>
              <p className="mt-1 text-sm bg-gray-50 p-2 rounded">{notes}</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <button
          onClick={handleAddToCalendar}
          className="w-full bg-primary-600 text-white py-3 px-4 rounded-md hover:bg-primary-700 flex items-center justify-center"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {t('success.addToCalendar')}
        </button>

        <button
          onClick={handleClose}
          className="w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-md hover:bg-gray-200"
        >
          {t('success.done')}
        </button>
      </div>
    </div>
  );
};

export default Step7Success;
