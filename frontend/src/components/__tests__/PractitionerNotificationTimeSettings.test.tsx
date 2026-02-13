import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PractitionerNotificationTimeSettings from '../PractitionerNotificationTimeSettings';

describe('PractitionerNotificationTimeSettings', () => {
  it('renders notification time input', () => {
    const mockOnChange = vi.fn();
    render(
      <PractitionerNotificationTimeSettings
        notificationTime="21:00"
        reminderDaysAhead={1}
        onNotificationTimeChange={mockOnChange}
        onReminderDaysAheadChange={vi.fn()}
      />
    );

    const hourInput = screen.getByDisplayValue('21');
    const minuteInput = screen.getByDisplayValue('00');
    expect(hourInput).toBeInTheDocument();
    expect(minuteInput).toBeInTheDocument();
  });

  it('calls onNotificationTimeChange when time is changed', () => {
    const mockOnChange = vi.fn();
    const { rerender } = render(
      <PractitionerNotificationTimeSettings
        notificationTime="21:00"
        onNotificationTimeChange={mockOnChange}
      />
    );

    const hourInput = screen.getByDisplayValue('21');
    fireEvent.change(hourInput, { target: { value: '20' } });

    expect(mockOnChange).toHaveBeenCalledWith('20:00');
    
    // Update the component with the new time value
    rerender(
      <PractitionerNotificationTimeSettings
        notificationTime="20:00"
        reminderDaysAhead={1}
        onNotificationTimeChange={mockOnChange}
        onReminderDaysAheadChange={vi.fn()}
      />
    );
    
    const minuteInput = screen.getByDisplayValue('00');
    fireEvent.change(minuteInput, { target: { value: '30' } });

    expect(mockOnChange).toHaveBeenCalledWith('20:30');
  });

  it('renders notification time input with label', () => {
    const mockOnChange = vi.fn();
    render(
      <PractitionerNotificationTimeSettings
        notificationTime="21:00"
        reminderDaysAhead={1}
        onNotificationTimeChange={mockOnChange}
        onReminderDaysAheadChange={vi.fn()}
      />
    );

    const label = screen.getByText(/明日預約提醒時間/i);
    expect(label).toBeInTheDocument();
    
    const hourInput = screen.getByDisplayValue('21');
    const minuteInput = screen.getByDisplayValue('00');
    expect(hourInput).toBeInTheDocument();
    expect(minuteInput).toBeInTheDocument();
  });
});

