import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminDailyReminderSettings from '../AdminDailyReminderSettings';

describe('AdminDailyReminderSettings', () => {
  it('renders reminder toggle', () => {
    const mockOnToggle = vi.fn();
    const mockOnTimeChange = vi.fn();
    render(
      <AdminDailyReminderSettings
        enabled={false}
        reminderTime="21:00"
        onToggle={mockOnToggle}
        onTimeChange={mockOnTimeChange}
      />
    );

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('renders as checked when enabled', () => {
    const mockOnToggle = vi.fn();
    const mockOnTimeChange = vi.fn();
    render(
      <AdminDailyReminderSettings
        enabled={true}
        reminderTime="21:00"
        onToggle={mockOnToggle}
        onTimeChange={mockOnTimeChange}
      />
    );

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('shows time input when enabled', () => {
    const mockOnToggle = vi.fn();
    const mockOnTimeChange = vi.fn();
    render(
      <AdminDailyReminderSettings
        enabled={true}
        reminderTime="21:00"
        onToggle={mockOnToggle}
        onTimeChange={mockOnTimeChange}
      />
    );

    const hourInput = screen.getByDisplayValue('21');
    const minuteInput = screen.getByDisplayValue('00');
    expect(hourInput).toBeInTheDocument();
    expect(minuteInput).toBeInTheDocument();
  });

  it('hides time input when disabled', () => {
    const mockOnToggle = vi.fn();
    const mockOnTimeChange = vi.fn();
    render(
      <AdminDailyReminderSettings
        enabled={false}
        reminderTime="21:00"
        onToggle={mockOnToggle}
        onTimeChange={mockOnTimeChange}
      />
    );

    const hourInput = screen.queryByDisplayValue('21');
    const minuteInput = screen.queryByDisplayValue('00');
    expect(hourInput).not.toBeInTheDocument();
    expect(minuteInput).not.toBeInTheDocument();
  });

  it('calls onToggle when checkbox is clicked', () => {
    const mockOnToggle = vi.fn();
    const mockOnTimeChange = vi.fn();
    render(
      <AdminDailyReminderSettings
        enabled={false}
        reminderTime="21:00"
        onToggle={mockOnToggle}
        onTimeChange={mockOnTimeChange}
      />
    );

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(mockOnToggle).toHaveBeenCalledWith(true);
  });

  it('calls onTimeChange when time is changed', () => {
    const mockOnToggle = vi.fn();
    const mockOnTimeChange = vi.fn();
    const { rerender } = render(
      <AdminDailyReminderSettings
        enabled={true}
        reminderTime="21:00"
        onToggle={mockOnToggle}
        onTimeChange={mockOnTimeChange}
      />
    );

    const hourInput = screen.getByDisplayValue('21');
    fireEvent.change(hourInput, { target: { value: '20' } });

    expect(mockOnTimeChange).toHaveBeenCalledWith('20:00');
    
    rerender(
      <AdminDailyReminderSettings
        enabled={true}
        reminderTime="20:00"
        onToggle={mockOnToggle}
        onTimeChange={mockOnTimeChange}
      />
    );
    
    const minuteInput = screen.getByDisplayValue('00');
    fireEvent.change(minuteInput, { target: { value: '30' } });

    expect(mockOnTimeChange).toHaveBeenCalledWith('20:30');
  });

  it('opens info modal when info button is clicked', () => {
    const mockOnToggle = vi.fn();
    const mockOnTimeChange = vi.fn();
    render(
      <AdminDailyReminderSettings
        enabled={false}
        reminderTime="21:00"
        onToggle={mockOnToggle}
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

