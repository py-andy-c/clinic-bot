import React from 'react';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { downloadAppointmentICS, generateGoogleCalendarURL } from '../../utils/icsGenerator';

const Step7Success: React.FC = () => {
  const { appointmentType, practitioner, date, startTime, patient, notes, reset } = useAppointmentStore();

  const handleAddToCalendar = () => {
    if (!appointmentType || !date || !startTime || !patient) {
      console.error('Missing appointment data for calendar:', {
        appointmentType,
        date,
        startTime,
        patient
      });
      return;
    }

    try {
      // Parse date and time, ensuring proper timezone handling
      const startDateTime = new Date(`${date}T${startTime}:00`);
      
      // Check if date is valid
      if (isNaN(startDateTime.getTime())) {
        console.error('Invalid date/time:', `${date}T${startTime}`);
        alert('無法建立行事曆事件：日期時間格式錯誤');
        return;
      }

      const endTime = new Date(startDateTime);
      endTime.setMinutes(endTime.getMinutes() + (appointmentType?.duration_minutes || 60));

      const appointmentData = {
        id: Date.now(), // Temporary ID for ICS generation
        appointment_type_name: appointmentType.name,
        practitioner_name: practitioner?.full_name || '待安排',
        patient_name: patient.full_name,
        start_time: startDateTime.toISOString(),
        end_time: endTime.toISOString(),
        notes: notes || undefined,
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
          id: Date.now(),
          appointment_type_name: appointmentType.name,
          practitioner_name: practitioner?.full_name || '待安排',
          patient_name: patient.full_name,
          start_time: new Date(`${date}T${startTime}:00`).toISOString(),
          end_time: new Date(new Date(`${date}T${startTime}:00`).getTime() + (appointmentType?.duration_minutes || 60) * 60000).toISOString(),
          notes: notes || undefined,
        };
        downloadAppointmentICS(appointmentData);
      } catch (fallbackError) {
        console.error('Failed to download ICS as fallback:', fallbackError);
        alert('無法加入行事曆，請稍後再試');
      }
    }
  };

  const formatDateTime = () => {
    if (!date || !startTime) return '';
    // Ensure time format includes seconds for proper parsing
    const timeWithSeconds = startTime.includes(':') && startTime.split(':').length === 2 
      ? `${startTime}:00` 
      : startTime;
    const dateTime = new Date(`${date}T${timeWithSeconds}`);
    
    if (isNaN(dateTime.getTime())) {
      return '';
    }
    
    return dateTime.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
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
            <span className="font-medium">{practitioner?.full_name || '不指定'}</span>
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
