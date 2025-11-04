import React from 'react';
import moment from 'moment-timezone';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { downloadAppointmentICS, generateGoogleCalendarURL } from '../../utils/icsGenerator';
import { useModal } from '../../contexts/ModalContext';

const Step7Success: React.FC = () => {
  const {
    appointmentType,
    practitioner,
    isAutoAssigned,
    createdAppointment,
    patient,
    notes,
    reset,
    clinicDisplayName,
    clinicAddress
  } = useAppointmentStore();
  const { alert: showAlert } = useModal();

  const handleAddToCalendar = () => {
    if (!appointmentType || !createdAppointment || !patient) {
      console.error('Missing appointment data for calendar:', {
        appointmentType,
        createdAppointment,
        patient
      });
      return;
    }

    try {
      // Use the created appointment's start_time and end_time
      const startDateTimeTaiwan = moment(createdAppointment.start_time);
      const endDateTimeTaiwan = moment(createdAppointment.end_time);

      if (!startDateTimeTaiwan.isValid() || !endDateTimeTaiwan.isValid()) {
        console.error('Invalid date/time from created appointment:', createdAppointment);
        showAlert('無法建立行事曆事件：日期時間格式錯誤', '日期時間錯誤');
        return;
      }

      // Pass Taiwan time directly (ISO format with timezone indicator)
    const appointmentData = {
      id: Date.now(), // Temporary ID for ICS generation
      appointment_type_name: appointmentType.name,
      practitioner_name: practitioner?.full_name || '待安排',
      patient_name: patient.full_name,
        start_time: startDateTimeTaiwan.format(), // Taiwan time with +08:00
        end_time: endDateTimeTaiwan.format(), // Taiwan time with +08:00
      notes: notes || undefined,
      clinic_name: clinicDisplayName || '診所',
      ...(clinicAddress && { clinic_address: clinicAddress }),
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
        console.log('window.open failed, using location.href:', error);
        window.location.href = googleCalendarURL;
      }
    } catch (error) {
      console.error('Failed to open Google Calendar:', error);
      // Fallback to ICS download if Google Calendar URL fails
      try {
        const appointmentData = {
          id: createdAppointment.appointment_id,
          appointment_type_name: appointmentType.name,
          practitioner_name: practitioner?.full_name || '待安排',
          patient_name: patient.full_name,
          start_time: createdAppointment.start_time,
          end_time: createdAppointment.end_time,
          notes: notes || undefined,
          clinic_name: clinicDisplayName || '診所',
          ...(clinicAddress && { clinic_address: clinicAddress }),
        };
    downloadAppointmentICS(appointmentData);
      } catch (fallbackError) {
        console.error('Failed to download ICS as fallback:', fallbackError);
        showAlert('無法加入行事曆，請稍後再試', '行事曆錯誤');
      }
    }
  };

  const formatDateTime = () => {
    if (!createdAppointment) return '';

    // Parse the start_time from created appointment (already in Taiwan timezone)
    const taiwanMoment = moment(createdAppointment.start_time);

    if (!taiwanMoment.isValid()) {
      return '';
    }

    // Format weekday as (日), (一), (二), etc.
    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = weekdayNames[taiwanMoment.day()];

    // Format using Taiwan timezone
    const dateStr = taiwanMoment.format('YYYY/MM/DD');
    const timeStr = taiwanMoment.format('HH:mm');

    return `${dateStr} (${weekday}) ${timeStr}`;
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
          預約成功
        </h2>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-600">預約類型：</span>
            <span className="font-medium">{appointmentType?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">治療師：</span>
            <span className="font-medium">
              {practitioner?.full_name || '不指定'}
              {isAutoAssigned && <span className="text-sm text-blue-600 ml-2">(系統安排)</span>}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">日期時間：</span>
            <span className="font-medium">{formatDateTime()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">就診人：</span>
            <span className="font-medium">{patient?.full_name}</span>
          </div>
          {notes && (
            <div>
              <span className="text-gray-600">備註：</span>
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
          加入行事曆
        </button>

        <button
          onClick={handleClose}
          className="w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-md hover:bg-gray-200"
        >
          完成
        </button>
      </div>
    </div>
  );
};

export default Step7Success;
