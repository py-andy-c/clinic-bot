import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminAppointmentChangeSubscriptionSettings from '../AdminAppointmentChangeSubscriptionSettings';

describe('AdminAppointmentChangeSubscriptionSettings', () => {
  it('renders subscription toggle', () => {
    const mockOnToggle = vi.fn();
    render(
      <AdminAppointmentChangeSubscriptionSettings
        subscribed={false}
        onToggle={mockOnToggle}
      />
    );

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('renders as checked when subscribed', () => {
    const mockOnToggle = vi.fn();
    render(
      <AdminAppointmentChangeSubscriptionSettings
        subscribed={true}
        onToggle={mockOnToggle}
      />
    );

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('calls onToggle when checkbox is clicked', () => {
    const mockOnToggle = vi.fn();
    render(
      <AdminAppointmentChangeSubscriptionSettings
        subscribed={false}
        onToggle={mockOnToggle}
      />
    );

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(mockOnToggle).toHaveBeenCalledWith(true);
  });

  it('displays description text', () => {
    const mockOnToggle = vi.fn();
    render(
      <AdminAppointmentChangeSubscriptionSettings
        subscribed={false}
        onToggle={mockOnToggle}
      />
    );

    expect(screen.getByText(/當診所內任何治療師的預約發生變更時/i)).toBeInTheDocument();
  });

  it('opens info modal when info button is clicked', () => {
    const mockOnToggle = vi.fn();
    render(
      <AdminAppointmentChangeSubscriptionSettings
        subscribed={false}
        onToggle={mockOnToggle}
      />
    );

    const infoButton = screen.getByLabelText('查看說明');
    fireEvent.click(infoButton);

    // Check for modal title (h3 element)
    const modalTitle = screen.getByRole('heading', { name: /預約變更通知/i });
    expect(modalTitle).toBeInTheDocument();
    expect(screen.getByText(/新預約：當預約被手動指派給任何治療師時/i)).toBeInTheDocument();
    expect(screen.getByText(/取消預約：當預約被取消時/i)).toBeInTheDocument();
  });

  it('closes info modal when close button is clicked', () => {
    const mockOnToggle = vi.fn();
    render(
      <AdminAppointmentChangeSubscriptionSettings
        subscribed={false}
        onToggle={mockOnToggle}
      />
    );

    const infoButton = screen.getByLabelText('查看說明');
    fireEvent.click(infoButton);

    const modalTitle = screen.getByRole('heading', { name: /預約變更通知/i });
    expect(modalTitle).toBeInTheDocument();

    const closeButton = screen.getByLabelText('關閉');
    fireEvent.click(closeButton);

    expect(screen.queryByRole('heading', { name: /預約變更通知/i })).not.toBeInTheDocument();
  });
});

