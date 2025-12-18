/**
 * EventModal Component
 * 
 * Modal for displaying calendar event details (appointments or availability exceptions).
 */

import React, { useState, useCallback, useEffect } from 'react';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { BaseModal } from './BaseModal';
import { apiService } from '../../services/api';
import { ClinicNotesTextarea } from '../shared/ClinicNotesTextarea';
import { ConflictDisplay } from '../shared/ConflictDisplay';
import { logger } from '../../utils/logger';
import { formatDateOnly } from '../../utils/calendarUtils';
import { useAuth } from '../../hooks/useAuth';
import { CheckoutModal } from './CheckoutModal';
import { ReceiptViewModal } from './ReceiptViewModal';
import { ReceiptListModal } from './ReceiptListModal';
import { canEditAppointment } from '../../utils/appointmentPermissions';
import { SchedulingConflictResponse } from '../../types';
import moment from 'moment-timezone';

// Maximum length for custom event names
// Must match backend/src/core/constants.py MAX_EVENT_NAME_LENGTH = 100
const MAX_EVENT_NAME_LENGTH = 100;

export interface EventModalProps {
  event: CalendarEvent;
  onClose: () => void;
  onDeleteAppointment?: (() => void | Promise<void>) | undefined;
  onDeleteException?: (() => void | Promise<void>) | undefined;
  onEditAppointment?: (() => void | Promise<void>) | undefined;
  onDuplicateAppointment?: (() => void | Promise<void>) | undefined;
  formatAppointmentTime: (start: Date, end: Date) => string;
  onEventNameUpdated?: (newName: string | null) => void | Promise<void>;
  hidePatientInfo?: boolean; // Hide 電話、生日、LINE when true (e.g., on patient detail page)
  appointmentTypes?: Array<{ id: number; name: string; receipt_name?: string | null }>;
  practitioners?: Array<{ id: number; full_name: string }>;
  onReceiptCreated?: () => void | Promise<void>;
}

export const EventModal: React.FC<EventModalProps> = React.memo(({
  event,
  onClose,
  onDeleteAppointment,
  onDeleteException,
  onEditAppointment,
  onDuplicateAppointment,
  formatAppointmentTime,
  onEventNameUpdated,
  hidePatientInfo = false,
  appointmentTypes = [],
  practitioners = [],
  onReceiptCreated,
}) => {
  const { isClinicAdmin, user, isClinicUser } = useAuth();
  const canEdit = event.resource.type === 'appointment' 
    ? canEditAppointment(event, user?.user_id, isClinicAdmin)
    : false;
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showReceiptListModal, setShowReceiptListModal] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | undefined>(undefined);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState(event.title);
  const [isSaving, setIsSaving] = useState(false);
  const [currentTitle, setCurrentTitle] = useState(event.title);
  const [clinicNotes, setClinicNotes] = useState(event.resource.clinic_notes || '');
  const [isSavingClinicNotes, setIsSavingClinicNotes] = useState(false);
  const [resourceConflictInfo, setResourceConflictInfo] = useState<SchedulingConflictResponse | null>(null);
  const [isCheckingResourceConflict, setIsCheckingResourceConflict] = useState(false);

  // Update currentTitle when event.title changes (e.g., after calendar refresh)
  React.useEffect(() => {
    setCurrentTitle(event.title);
  }, [event.title]);

  // Update clinic notes when event changes (e.g., after calendar refresh)
  React.useEffect(() => {
    setClinicNotes(event.resource.clinic_notes || '');
  }, [event.resource.clinic_notes]);

  // Check for resource conflicts when viewing appointment
  useEffect(() => {
    if (event.resource.type === 'appointment' && 
        event.resource.appointment_type_id && 
        event.resource.practitioner_id && 
        event.start && 
        event.end) {
      const checkResourceConflict = async () => {
        setIsCheckingResourceConflict(true);
        try {
          const dateStr = moment(event.start).tz('Asia/Taipei').format('YYYY-MM-DD');
          const timeStr = moment(event.start).tz('Asia/Taipei').format('HH:mm');
          
          const conflictInfo = await apiService.checkSchedulingConflicts(
            event.resource.practitioner_id!,
            dateStr,
            timeStr,
            event.resource.appointment_type_id!,
            event.resource.calendar_event_id
          );
          
          // Show all conflicts (not just resource conflicts)
          if (conflictInfo.has_conflict) {
            setResourceConflictInfo(conflictInfo);
          } else {
            setResourceConflictInfo(null);
          }
        } catch (err) {
          logger.error('Failed to check resource conflicts:', err);
          setResourceConflictInfo(null);
        } finally {
          setIsCheckingResourceConflict(false);
        }
      };
      
      checkResourceConflict();
    } else {
      setResourceConflictInfo(null);
    }
  }, [event.resource.type, event.resource.appointment_type_id, event.resource.practitioner_id, event.start, event.end, event.resource.calendar_event_id]);

  const handleStartEdit = useCallback(() => {
    setEditingName(currentTitle);
    setIsEditingName(true);
  }, [currentTitle]);

  const handleCancelEdit = useCallback(() => {
    setIsEditingName(false);
    setEditingName(currentTitle);
  }, [currentTitle]);

  const handleSaveName = useCallback(async () => {
    if (isSaving) return;
    
    // Frontend validation: check max length before sending
    const trimmedName = editingName.trim();
    if (trimmedName.length > MAX_EVENT_NAME_LENGTH) {
      alert(`事件名稱過長（最多 ${MAX_EVENT_NAME_LENGTH} 字元）`);
      return;
    }
    
    setIsSaving(true);
    try {
      // Normalize: empty string or null means use default
      const nameToSave = trimmedName === '' ? null : trimmedName;
      
      await apiService.updateCalendarEventName(event.resource.calendar_event_id, nameToSave);
      
      // Update local state immediately with the saved name
      // If nameToSave is null, the backend will return the default format after refresh
      // We'll use the saved name for now, and the useEffect will sync with the refreshed event
      const newTitle = nameToSave || event.title;
      
      setCurrentTitle(newTitle);
      setIsEditingName(false);
      
      // Notify parent to update the event and refresh calendar
      // The refresh will provide the correct default title if nameToSave is null
      if (onEventNameUpdated) {
        await onEventNameUpdated(nameToSave);
      }
    } catch (error) {
      logger.error('Error updating event name:', error);
      alert('更新事件名稱失敗，請重試');
    } finally {
      setIsSaving(false);
    }
  }, [editingName, event.resource.calendar_event_id, event.title, onEventNameUpdated, isSaving]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSaveName();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  }, [handleSaveName, handleCancelEdit]);

  const handleSaveClinicNotes = useCallback(async () => {
    if (isSavingClinicNotes) return;

    setIsSavingClinicNotes(true);
    const trimmedNotes = clinicNotes.trim();
    const originalNotes = event.resource.clinic_notes || '';

    try {
      // Update clinic notes via edit appointment API
      // Always include clinic_notes to allow clearing notes (send empty string to clear)
      const updateData: {
        clinic_notes: string;
      } = {
        clinic_notes: trimmedNotes, // Empty string clears the notes
      };
      await apiService.editClinicAppointment(event.resource.calendar_event_id, updateData);

      // Optimistically update the event prop by calling the callback
      // The parent will refresh calendar data and sync the modal state
      if (onEventNameUpdated) {
        await onEventNameUpdated(null);
      }

      // Note: The useEffect will sync clinicNotes from event.resource.clinic_notes
      // when the event prop updates after calendar refresh
    } catch (error) {
      logger.error('Error updating clinic notes:', error);
      alert('更新診所備注失敗，請重試');
      // Revert to original value on error
      setClinicNotes(originalNotes);
    } finally {
      setIsSavingClinicNotes(false);
    }
  }, [clinicNotes, event.resource.calendar_event_id, event.resource.clinic_notes, onEventNameUpdated, isSavingClinicNotes]);

  const displayTitle = currentTitle;

  return (
    <BaseModal
      onClose={onClose}
      aria-label={event.resource.type === 'appointment' ? '預約詳情' : '休診詳情'}
    >
      <div className="flex items-center justify-between mb-4">
        {isEditingName ? (
          <div className="flex items-center gap-1 flex-1">
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 px-2 py-1 text-lg font-semibold border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
              disabled={isSaving}
              maxLength={MAX_EVENT_NAME_LENGTH}
            />
            <button
              onClick={handleSaveName}
              disabled={isSaving}
              className="px-2 py-1 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="儲存"
            >
              {isSaving ? '...' : '✓'}
            </button>
            <button
              onClick={handleCancelEdit}
              disabled={isSaving}
              className="px-2 py-1 text-sm text-gray-600 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
              title="取消"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h3 className="text-lg font-semibold truncate" title={displayTitle}>
              {displayTitle}
            </h3>
            <button
              onClick={handleStartEdit}
              className="px-1 py-1 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
              title="編輯事件名稱"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        )}
      </div>
        {event.resource.type === 'appointment' ? (
          <>
            <div className="space-y-2">
              {(event.resource.event_practitioner_name || (event.resource.practitioner_name && !event.resource.is_primary)) && (
                <p>
                  <strong>治療師:</strong> {event.resource.event_practitioner_name || event.resource.practitioner_name}
                  {event.resource.is_auto_assigned === true && ' (系統指派)'}
                </p>
              )}
              <div className="flex items-center gap-2">
                <p><strong>時間:</strong> {formatAppointmentTime(event.start, event.end)}</p>
                {isCheckingResourceConflict && (
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400"></div>
                )}
              </div>
              {!hidePatientInfo && event.resource.patient_phone && (
                <p><strong>電話:</strong> {event.resource.patient_phone}</p>
              )}
              {!hidePatientInfo && event.resource.patient_birthday && (
                <p><strong>生日:</strong> {formatDateOnly(event.resource.patient_birthday)}</p>
              )}
              {!hidePatientInfo && event.resource.line_display_name && (
                <p><strong>LINE:</strong> {event.resource.line_display_name}</p>
              )}
              {event.resource.notes && (
                <p><strong>病患備註:</strong> {event.resource.notes}</p>
              )}
              {event.resource.resource_names && event.resource.resource_names.length > 0 && (
                <p>{event.resource.resource_names.join(' ')}</p>
              )}
              {/* Conflict Warning - shows all conflicts */}
              {resourceConflictInfo && resourceConflictInfo.has_conflict && (
                <div className="mt-2">
                  <ConflictDisplay
                    conflictInfo={resourceConflictInfo}
                    isLoading={isCheckingResourceConflict}
                  />
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p><strong>診所備注:</strong></p>
                  {canEdit && clinicNotes.trim() !== (event.resource.clinic_notes || '').trim() && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSaveClinicNotes();
                      }}
                      disabled={isSavingClinicNotes}
                      className="px-3 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSavingClinicNotes ? '儲存中...' : '儲存'}
                    </button>
                  )}
                </div>
                <ClinicNotesTextarea
                  value={clinicNotes}
                  onChange={(e) => setClinicNotes(e.target.value)}
                  rows={3}
                  disabled={!canEdit || isSavingClinicNotes}
                />
              </div>
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
          {event.resource.type === 'appointment' && (
            <>
              {/* Receipt View Button - Show when any receipt exists (active or voided) */}
              {event.resource.has_any_receipt && event.resource.receipt_ids && event.resource.receipt_ids.length > 0 && (
                <button
                  onClick={() => {
                    // Show list modal if multiple receipts, otherwise show single receipt modal
                    const receiptIds = event.resource.receipt_ids || [];
                    if (receiptIds.length > 1) {
                      setShowReceiptListModal(true);
                    } else {
                      // Single receipt: show directly
                      setSelectedReceiptId(receiptIds[0]);
                      setShowReceiptModal(true);
                    }
                  }}
                  className="btn-primary bg-purple-600 hover:bg-purple-700"
                >
                  檢視收據
                </button>
              )}
              
              {/* Re-issue Receipt Button - Show when receipt is voided (previously checked out, clinic users only) */}
              {event.resource.has_any_receipt && !event.resource.has_active_receipt && isClinicUser && (
                <button
                  onClick={() => setShowCheckoutModal(true)}
                  className="btn-primary bg-orange-600 hover:bg-orange-700"
                >
                  重新開立收據
                </button>
              )}
              
              {/* Checkout Button - Show when no receipts at all (never checked out, clinic users only) */}
              {!event.resource.has_any_receipt && isClinicUser && (
                <button
                  onClick={() => setShowCheckoutModal(true)}
                  className="btn-primary bg-green-600 hover:bg-green-700"
                >
                  結帳
                </button>
              )}
              
              {/* Duplicate Button - Always show (creates new appointment, doesn't modify existing) */}
              {onDuplicateAppointment && (
                <button
                  onClick={onDuplicateAppointment}
                  className="btn-primary bg-green-600 hover:bg-green-700"
                >
                  複製
                </button>
              )}
              
              {/* Edit/Delete Buttons - Hide when any receipt exists (Constraint 1) */}
              {!event.resource.has_any_receipt && (
                <>
                  {onEditAppointment && (
            <button
              onClick={onEditAppointment}
              className="btn-primary bg-blue-600 hover:bg-blue-700"
            >
              編輯
            </button>
          )}
                  {onDeleteAppointment && (
            <button
              onClick={onDeleteAppointment}
              className="btn-primary bg-red-600 hover:bg-red-700"
            >
              刪除
            </button>
                  )}
                </>
              )}
            </>
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
        
        {/* Checkout Modal */}
        {showCheckoutModal && event.resource.appointment_id && (
          <CheckoutModal
            event={event}
            appointmentTypes={appointmentTypes}
            practitioners={practitioners}
            onClose={() => setShowCheckoutModal(false)}
            onSuccess={async () => {
              if (onReceiptCreated) {
                await onReceiptCreated();
              }
              if (onEventNameUpdated) {
                await onEventNameUpdated(null);
              }
            }}
          />
        )}
        
        {/* Receipt List Modal (when multiple receipts) */}
        {showReceiptListModal && event.resource.appointment_id && event.resource.receipt_ids && event.resource.receipt_ids.length > 1 && (
          <ReceiptListModal
            appointmentId={event.resource.appointment_id}
            receiptIds={event.resource.receipt_ids}
            onClose={() => setShowReceiptListModal(false)}
            onSelectReceipt={(receiptId) => {
              setSelectedReceiptId(receiptId);
              setShowReceiptModal(true);
            }}
          />
        )}

        {/* Receipt View Modal */}
        {showReceiptModal && event.resource.appointment_id && (
          <ReceiptViewModal
            {...(selectedReceiptId 
              ? { receiptId: selectedReceiptId }
              : { appointmentId: event.resource.appointment_id }
            )}
            onClose={() => {
              setShowReceiptModal(false);
              setSelectedReceiptId(undefined);
            }}
            onReceiptVoided={async () => {
              if (onEventNameUpdated) {
                await onEventNameUpdated(null);
              }
            }}
            isClinicUser={isClinicUser}
          />
        )}
    </BaseModal>
  );
});

