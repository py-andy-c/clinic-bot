import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminDailyReminderSettings from '../AdminDailyReminderSettings';

describe('AdminDailyReminderSettings', () => {
  it('renders reminder settings with time input', () => {
    const mockOnTimeChange = vi.fn();
    render(
      <AdminDailyReminderSettings
        reminderTime="21:00"
        onTimeChange={mockOnTimeChange}
      />
    );

    const hourInput = screen.getByDisplayValue('21');
    const minuteInput = screen.getByDisplayValue('00');
    expect(hourInput).toBeInTheDocument();
    expect(minuteInput).toBeInTheDocument();
  });

  it('renders reminder title', () => {
    const mockOnTimeChange = vi.fn();
    render(
      <AdminDailyReminderSettings
        reminderTime="21:00"
        onTimeChange={mockOnTimeChange}
      />
    );

    const title = screen.getByText('每日預約總覽提醒');
    expect(title).toBeInTheDocument();
  });

  it('calls onTimeChange when time is changed', () => {
    const mockOnTimeChange = vi.fn();
    const { rerender } = render(
      <AdminDailyReminderSettings
        reminderTime="21:00"
        onTimeChange={mockOnTimeChange}
      />
    );

    const hourInput = screen.getByDisplayValue('21');
    fireEvent.change(hourInput, { target: { value: '20' } });

    expect(mockOnTimeChange).toHaveBeenCalledWith('20:00');
    
    rerender(
      <AdminDailyReminderSettings
        reminderTime="20:00"
        onTimeChange={mockOnTimeChange}
      />
    );
    
    const minuteInput = screen.getByDisplayValue('00');
    fireEvent.change(minuteInput, { target: { value: '30' } });

    expect(mockOnTimeChange).toHaveBeenCalledWith('20:30');
  });

  it('opens info modal when info button is clicked', () => {
    const mockOnTimeChange = vi.fn();
    render(
      <AdminDailyReminderSettings
        reminderTime="21:00"
        onTimeChange={mockOnTimeChange}
      />
    );

    const infoButton = screen.getByLabelText('查看說明');
    fireEvent.click(infoButton);

    // Check for modal title (h3 element)
    const modalTitle = screen.getByRole('heading', { name: /每日預約總覽提醒/i });
    expect(modalTitle).toBeInTheDocument();
  });
});
