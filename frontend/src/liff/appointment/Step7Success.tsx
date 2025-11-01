import React from 'react';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { downloadAppointmentICS } from '../../utils/icsGenerator';

const Step7Success: React.FC = () => {
  const { appointmentType, practitioner, date, startTime, patient, notes, reset } = useAppointmentStore();

  const handleDownloadICS = () => {
    if (!appointmentType || !date || !startTime || !patient) return;

    const endTime = new Date(`${date}T${startTime}`);
    endTime.setMinutes(endTime.getMinutes() + (appointmentType?.duration_minutes || 60));

    const appointmentData = {
      id: Date.now(), // Temporary ID for ICS generation
      appointment_type_name: appointmentType.name,
      practitioner_name: practitioner?.full_name || '待安排',
      patient_name: patient.full_name,
      start_time: `${date}T${startTime}`,
      end_time: endTime.toISOString(),
      notes: notes || undefined,
    };

    downloadAppointmentICS(appointmentData);
  };

  const formatDateTime = () => {
    if (!date || !startTime) return '';
    const dateTime = new Date(`${date}T${startTime}`);
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
          onClick={handleDownloadICS}
          className="w-full bg-primary-600 text-white py-3 px-4 rounded-md hover:bg-primary-700 flex items-center justify-center"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
