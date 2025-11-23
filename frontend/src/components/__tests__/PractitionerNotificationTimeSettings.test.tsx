import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PractitionerNotificationTimeSettings from '../PractitionerNotificationTimeSettings';

describe('PractitionerNotificationTimeSettings', () => {
  it('renders notification time input', () => {
    const mockOnChange = vi.fn();
    render(
      <PractitionerNotificationTimeSettings
        notificationTime="21:00"
        onNotificationTimeChange={mockOnChange}
      />
    );

    const timeInput = screen.getByDisplayValue('21:00');
    expect(timeInput).toBeInTheDocument();
    expect(timeInput).toHaveValue('21:00');
  });

  it('calls onNotificationTimeChange when time is changed', () => {
    const mockOnChange = vi.fn();
    render(
      <PractitionerNotificationTimeSettings
        notificationTime="21:00"
        onNotificationTimeChange={mockOnChange}
      />
    );

    const timeInput = screen.getByDisplayValue('21:00');
    fireEvent.change(timeInput, { target: { value: '20:30' } });

    expect(mockOnChange).toHaveBeenCalledWith('20:30');
  });

  it('renders notification time input with label', () => {
    const mockOnChange = vi.fn();
    render(
      <PractitionerNotificationTimeSettings
        notificationTime="21:00"
        onNotificationTimeChange={mockOnChange}
      />
    );

    const label = screen.getByText(/明日預約提醒時間/i);
    expect(label).toBeInTheDocument();
    
    const timeInput = screen.getByDisplayValue('21:00');
    expect(timeInput).toBeInTheDocument();
  });
});

