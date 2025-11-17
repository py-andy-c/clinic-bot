/**
 * EventModal Component
 * 
 * Modal for displaying calendar event details (appointments or availability exceptions).
 */

import React from 'react';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { BaseModal } from './BaseModal';

export interface EventModalProps {
  event: CalendarEvent;
  onClose: () => void;
  onDeleteAppointment?: (() => void | Promise<void>) | undefined;
  onDeleteException?: (() => void | Promise<void>) | undefined;
  onEditAppointment?: (() => void | Promise<void>) | undefined;
  formatAppointmentTime: (start: Date, end: Date) => string;
}

export const EventModal: React.FC<EventModalProps> = React.memo(({
  event,
  onClose,
  onDeleteAppointment,
  onDeleteException,
  onEditAppointment,
  formatAppointmentTime,
}) => {
  return (
    <BaseModal
      onClose={onClose}
      aria-label={event.resource.type === 'appointment' ? '預約詳情' : '休診詳情'}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">
          {event.resource.type === 'appointment' ? event.title : '休診'}
        </h3>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          aria-label="關閉"
        >
          <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
        {event.resource.type === 'appointment' ? (
          <>
            <div className="space-y-2">
              {(event.resource.event_practitioner_name || (event.resource.practitioner_name && !event.resource.is_primary)) && (
                <p><strong>治療師:</strong> {event.resource.event_practitioner_name || event.resource.practitioner_name}</p>
              )}
              <p><strong>時間:</strong> {formatAppointmentTime(event.start, event.end)}</p>
              {event.resource.notes && (
                <p><strong>備註:</strong> {event.resource.notes}</p>
              )}
              {event.resource.patient_phone && (
                <p><strong>電話:</strong> {event.resource.patient_phone}</p>
              )}
              {event.resource.patient_birthday && (
                <p><strong>生日:</strong> {event.resource.patient_birthday}</p>
              )}
              {event.resource.line_display_name && (
                <p><strong>LINE:</strong> {event.resource.line_display_name}</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              {(event.resource.event_practitioner_name || (event.resource.practitioner_name && !event.resource.is_primary)) && (
                <p><strong>治療師:</strong> {event.resource.event_practitioner_name || event.resource.practitioner_name}</p>
              )}
              <p><strong>時間:</strong> {formatAppointmentTime(event.start, event.end)}</p>
            </div>
          </>
        )}
        <div className="flex justify-end space-x-2 mt-6">
          {event.resource.type === 'appointment' && onEditAppointment && (
            <button
              onClick={onEditAppointment}
              className="btn-primary bg-blue-600 hover:bg-blue-700"
            >
              編輯預約
            </button>
          )}
          {event.resource.type === 'appointment' && onDeleteAppointment && (
            <button
              onClick={onDeleteAppointment}
              className="btn-primary bg-red-600 hover:bg-red-700"
            >
              刪除預約
            </button>
          )}
          {event.resource.type === 'availability_exception' && onDeleteException && (
            <button
              onClick={onDeleteException}
              className="btn-primary"
            >
              刪除
            </button>
          )}
        </div>
    </BaseModal>
  );
});

