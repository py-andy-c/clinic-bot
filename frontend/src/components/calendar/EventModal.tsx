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
  formatAppointmentTime: (start: Date, end: Date) => string;
}

export const EventModal: React.FC<EventModalProps> = React.memo(({
  event,
  onClose,
  onDeleteAppointment,
  onDeleteException,
  formatAppointmentTime,
}) => {
  return (
    <BaseModal
      onClose={onClose}
      aria-label={event.resource.type === 'appointment' ? '預約詳情' : '休診詳情'}
    >
        {event.resource.type === 'appointment' ? (
          <>
            <h3 className="text-lg font-semibold mb-4">{event.title}</h3>
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
            <h3 className="text-lg font-semibold mb-4">休診</h3>
            <div className="space-y-2">
              {(event.resource.event_practitioner_name || (event.resource.practitioner_name && !event.resource.is_primary)) && (
                <p><strong>治療師:</strong> {event.resource.event_practitioner_name || event.resource.practitioner_name}</p>
              )}
              <p><strong>時間:</strong> {formatAppointmentTime(event.start, event.end)}</p>
            </div>
          </>
        )}
        <div className="flex justify-end space-x-2 mt-6">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            關閉
          </button>
          {event.resource.type === 'appointment' && onDeleteAppointment && (
            <button
              onClick={onDeleteAppointment}
              className="btn-primary"
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

