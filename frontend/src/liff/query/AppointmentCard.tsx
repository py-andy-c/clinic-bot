import React from 'react';

interface Appointment {
  id: number;
  patient_id: number;
  patient_name: string;
  practitioner_name: string;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: 'confirmed' | 'canceled_by_patient' | 'canceled_by_clinic';
  notes?: string;
}

interface AppointmentCardProps {
  appointment: Appointment;
  onCancel: () => void;
}

const AppointmentCard: React.FC<AppointmentCardProps> = ({ appointment, onCancel }) => {
  const formatDateTime = (dateTime: string) => {
    if (!dateTime) {
      return { date: '', time: '' };
    }
    const date = new Date(dateTime);
    if (isNaN(date.getTime())) {
      return { date: '', time: '' };
    }
    
    // Format weekday as (日), (一), (二), etc.
    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = weekdayNames[date.getDay()];
    
    const dateStr = date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    return {
      date: `${dateStr} (${weekday})`,
      time: date.toLocaleTimeString('zh-TW', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    };
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'bg-green-100 text-green-800';
      case 'canceled_by_patient':
      case 'canceled_by_clinic':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'confirmed':
        return '已確認';
      case 'canceled_by_patient':
        return '已取消';
      case 'canceled_by_clinic':
        return '診所取消';
      default:
        return status;
    }
  };

  const { date, time } = formatDateTime(appointment.start_time);
  const canCancel = appointment.status === 'confirmed';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-medium text-gray-900">{appointment.patient_name}</h3>
          <p className="text-sm text-gray-600">{appointment.appointment_type_name}</p>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}>
          {getStatusText(appointment.status)}
        </span>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center text-sm text-gray-600">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {appointment.practitioner_name}
        </div>

        <div className="flex items-center text-sm text-gray-600">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {date} {time}
        </div>

        {appointment.notes && (
          <div className="text-sm text-gray-600">
            <span className="font-medium">備註：</span>
            {appointment.notes}
          </div>
        )}
      </div>

      {canCancel && (
        <button
          onClick={onCancel}
          className="w-full bg-red-50 text-red-600 border border-red-200 rounded-md py-2 px-4 hover:bg-red-100 transition-colors text-sm font-medium"
        >
          取消預約
        </button>
      )}
    </div>
  );
};

export default AppointmentCard;
