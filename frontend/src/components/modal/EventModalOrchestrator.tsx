/**
 * Event Modal Orchestrator
 *
 * Manages multiple modal states within the EventModal component,
 * replacing multiple boolean flags with a unified modal state system.
 */

import React from 'react';
import { ModalState, EventModalData } from '../../types/modal';
import { CheckoutModal } from '../calendar/CheckoutModal';
import { ReceiptViewModal } from '../calendar/ReceiptViewModal';
import { ReceiptListModal } from '../calendar/ReceiptListModal';

interface EventModalOrchestratorProps {
  modalState: ModalState<EventModalData>;
  onModalChange: (state: ModalState<EventModalData>) => void;
  event: any;
  appointmentTypes?: any[] | undefined;
  practitioners?: any[] | undefined;
  isClinicUser?: boolean | undefined;
  onReceiptCreated?: (() => void | Promise<void>) | undefined;
  onEventNameUpdated?: ((name: string | null) => void | Promise<void>) | undefined;
}

export const EventModalOrchestrator: React.FC<EventModalOrchestratorProps> = ({
  modalState,
  onModalChange,
  event,
  appointmentTypes = [],
  practitioners = [],
  isClinicUser = false,
  onReceiptCreated,
  onEventNameUpdated,
}) => {
  const handleCloseModal = () => {
    onModalChange({ type: null });
  };

  return (
    <>
      {/* Checkout Modal */}
      {modalState.type === 'checkout' && event.resource.appointment_id && (
        <CheckoutModal
          event={event}
          appointmentTypes={appointmentTypes}
          practitioners={practitioners}
          onClose={handleCloseModal}
          onSuccess={async () => {
            if (onReceiptCreated) await onReceiptCreated();
            if (onEventNameUpdated) await onEventNameUpdated(null);
            handleCloseModal();
          }}
        />
      )}

      {/* Receipt View Modal */}
      {modalState.type === 'receipt_view' && event.resource.appointment_id && (
        <ReceiptViewModal
          {...(modalState.data?.receiptId
            ? { receiptId: modalState.data.receiptId }
            : { appointmentId: event.resource.appointment_id }
          )}
          onClose={handleCloseModal}
          onReceiptVoided={async () => {
            if (onEventNameUpdated) await onEventNameUpdated(null);
          }}
          isClinicUser={isClinicUser}
        />
      )}

      {/* Receipt List Modal */}
      {modalState.type === 'receipt_list' && event.resource.appointment_id && event.resource.receipt_ids && event.resource.receipt_ids.length > 1 && (
        <ReceiptListModal
          appointmentId={event.resource.appointment_id}
          receiptIds={event.resource.receipt_ids}
          onClose={handleCloseModal}
          onSelectReceipt={(receiptId) => {
            onModalChange({ type: 'receipt_view', data: { receiptId } });
          }}
        />
      )}
    </>
  );
};