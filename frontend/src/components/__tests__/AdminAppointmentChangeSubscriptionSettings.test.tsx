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
});

