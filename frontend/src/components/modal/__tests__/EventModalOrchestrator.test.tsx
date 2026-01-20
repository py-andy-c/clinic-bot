/**
 * Tests for EventModalOrchestrator component
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventModalOrchestrator } from '../EventModalOrchestrator';
import { ModalState } from '../../../types/modal';

// Mock the modal components
vi.mock('../../calendar/CheckoutModal', () => ({
  CheckoutModal: vi.fn(({ onClose, onSuccess }) => (
    <div data-testid="checkout-modal">
      <button onClick={onClose} data-testid="close-checkout">Close</button>
      <button onClick={() => onSuccess?.()} data-testid="success-checkout">
        Success
      </button>
    </div>
  )),
}));

vi.mock('../../calendar/ReceiptViewModal', () => ({
  ReceiptViewModal: vi.fn(({ onClose }) => (
    <div data-testid="receipt-view-modal">
      <button onClick={onClose} data-testid="close-receipt-view">Close</button>
    </div>
  )),
}));

vi.mock('../../calendar/ReceiptListModal', () => ({
  ReceiptListModal: vi.fn(({ onClose }) => (
    <div data-testid="receipt-list-modal">
      <button onClick={onClose} data-testid="close-receipt-list">Close</button>
    </div>
  )),
}));

describe('EventModalOrchestrator', () => {
  let mockModalState: ModalState;
  let mockOnModalChange: vi.Mock;
  let mockEvent: any;
  let mockOnReceiptCreated: vi.Mock;

  beforeEach(() => {
    mockModalState = { type: null };
    mockOnModalChange = vi.fn();
    mockOnReceiptCreated = vi.fn();
    mockEvent = {
      resource: {
        appointment_id: 1,
        patient_id: 1,
        receipt_ids: [1, 2],
      }
    };
  });

  const renderOrchestrator = () => {
    return render(
      <EventModalOrchestrator
        modalState={mockModalState}
        onModalChange={mockOnModalChange}
        event={mockEvent}
        onReceiptCreated={mockOnReceiptCreated}
      />
    );
  };

  it('renders nothing when modal type is null', () => {
    mockModalState = { type: null };
    const { container } = renderOrchestrator();
    expect(container.firstChild).toBeNull();
  });

  it('renders CheckoutModal when type is checkout', () => {
    mockModalState = { type: 'checkout' };
    renderOrchestrator();

    expect(screen.getByTestId('checkout-modal')).toBeInTheDocument();
  });

  it('renders ReceiptViewModal when type is receipt_view', () => {
    mockModalState = { type: 'receipt_view', data: { receiptId: 1 } };
    renderOrchestrator();

    expect(screen.getByTestId('receipt-view-modal')).toBeInTheDocument();
  });

  it('renders ReceiptListModal when type is receipt_list with multiple receipts', () => {
    mockModalState = { type: 'receipt_list' };
    renderOrchestrator();

    expect(screen.getByTestId('receipt-list-modal')).toBeInTheDocument();
  });

  it('does not render ReceiptListModal when there is only one receipt', () => {
    mockEvent.resource.receipt_ids = [1];
    mockModalState = { type: 'receipt_list' };
    renderOrchestrator();

    expect(screen.queryByTestId('receipt-list-modal')).not.toBeInTheDocument();
  });

  it('calls onModalChange with null when closing checkout modal', async () => {
    mockModalState = { type: 'checkout' };
    renderOrchestrator();

    fireEvent.click(screen.getByTestId('close-checkout'));

    await waitFor(() => {
      expect(mockOnModalChange).toHaveBeenCalledWith({ type: null });
    });
  });

  it('calls onReceiptCreated and closes modal when checkout succeeds', async () => {
    mockModalState = { type: 'checkout' };
    renderOrchestrator();

    fireEvent.click(screen.getByTestId('success-checkout'));

    // Wait for the success callback to be called
    await waitFor(() => {
      expect(mockOnReceiptCreated).toHaveBeenCalled();
    });

    // The modal close should happen after success
    expect(mockOnModalChange).toHaveBeenCalledWith({ type: null });
  });

  it('calls onModalChange with null when closing receipt view modal', async () => {
    mockModalState = { type: 'receipt_view', data: { receiptId: 1 } };
    renderOrchestrator();

    fireEvent.click(screen.getByTestId('close-receipt-view'));

    await waitFor(() => {
      expect(mockOnModalChange).toHaveBeenCalledWith({ type: null });
    });
  });

  it('calls onModalChange with null when closing receipt list modal', async () => {
    mockModalState = { type: 'receipt_list' };
    renderOrchestrator();

    fireEvent.click(screen.getByTestId('close-receipt-list'));

    await waitFor(() => {
      expect(mockOnModalChange).toHaveBeenCalledWith({ type: null });
    });
  });
});