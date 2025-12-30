import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import AdminAutoAssignedNotificationTimeSettings from '../AdminAutoAssignedNotificationTimeSettings';

describe('AdminAutoAssignedNotificationTimeSettings', () => {
  const renderWithRouter = (component: React.ReactElement) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
  };

  it('renders notification mode selection', () => {
    const mockOnTimeChange = vi.fn();
    const mockOnModeChange = vi.fn();
    renderWithRouter(
      <AdminAutoAssignedNotificationTimeSettings
        notificationTime="21:00"
        notificationMode="scheduled"
        onNotificationTimeChange={mockOnTimeChange}
        onNotificationModeChange={mockOnModeChange}
      />
    );

    const immediateRadio = screen.getByLabelText('即時通知');
    const scheduledRadio = screen.getByLabelText('定時通知');
    
    expect(immediateRadio).toBeInTheDocument();
    expect(scheduledRadio).toBeInTheDocument();
    expect(scheduledRadio).toBeChecked();
  });

  it('shows time input when mode is scheduled', () => {
    const mockOnTimeChange = vi.fn();
    const mockOnModeChange = vi.fn();
    renderWithRouter(
      <AdminAutoAssignedNotificationTimeSettings
        notificationTime="21:00"
        notificationMode="scheduled"
        onNotificationTimeChange={mockOnTimeChange}
        onNotificationModeChange={mockOnModeChange}
      />
    );

    const hourInput = screen.getByDisplayValue('21');
    const minuteInput = screen.getByDisplayValue('00');
    expect(hourInput).toBeInTheDocument();
    expect(minuteInput).toBeInTheDocument();
  });

  it('hides time input when mode is immediate', () => {
    const mockOnTimeChange = vi.fn();
    const mockOnModeChange = vi.fn();
    renderWithRouter(
      <AdminAutoAssignedNotificationTimeSettings
        notificationTime="21:00"
        notificationMode="immediate"
        onNotificationTimeChange={mockOnTimeChange}
        onNotificationModeChange={mockOnModeChange}
      />
    );

    const hourInput = screen.queryByDisplayValue('21');
    const minuteInput = screen.queryByDisplayValue('00');
    expect(hourInput).not.toBeInTheDocument();
    expect(minuteInput).not.toBeInTheDocument();
  });

  it('calls onNotificationModeChange when mode is changed', () => {
    const mockOnTimeChange = vi.fn();
    const mockOnModeChange = vi.fn();
    renderWithRouter(
      <AdminAutoAssignedNotificationTimeSettings
        notificationTime="21:00"
        notificationMode="scheduled"
        onNotificationTimeChange={mockOnTimeChange}
        onNotificationModeChange={mockOnModeChange}
      />
    );

    const immediateRadio = screen.getByLabelText('即時通知');
    fireEvent.click(immediateRadio);

    expect(mockOnModeChange).toHaveBeenCalledWith('immediate');
  });

  it('calls onNotificationTimeChange when time is changed', () => {
    const mockOnTimeChange = vi.fn();
    const mockOnModeChange = vi.fn();
    const { rerender } = renderWithRouter(
      <AdminAutoAssignedNotificationTimeSettings
        notificationTime="21:00"
        notificationMode="scheduled"
        onNotificationTimeChange={mockOnTimeChange}
        onNotificationModeChange={mockOnModeChange}
      />
    );

    const hourInput = screen.getByDisplayValue('21');
    fireEvent.change(hourInput, { target: { value: '20' } });

    expect(mockOnTimeChange).toHaveBeenCalledWith('20:00');
    
    rerender(
      <BrowserRouter>
        <AdminAutoAssignedNotificationTimeSettings
          notificationTime="20:00"
          notificationMode="scheduled"
          onNotificationTimeChange={mockOnTimeChange}
          onNotificationModeChange={mockOnModeChange}
        />
      </BrowserRouter>
    );
    
    const minuteInput = screen.getByDisplayValue('00');
    fireEvent.change(minuteInput, { target: { value: '30' } });

    expect(mockOnTimeChange).toHaveBeenCalledWith('20:30');
  });

  it('displays correct description for immediate mode', () => {
    const mockOnTimeChange = vi.fn();
    const mockOnModeChange = vi.fn();
    renderWithRouter(
      <AdminAutoAssignedNotificationTimeSettings
        notificationTime="21:00"
        notificationMode="immediate"
        onNotificationTimeChange={mockOnTimeChange}
        onNotificationModeChange={mockOnModeChange}
      />
    );

    expect(screen.getByText(/當有預約被自動指派時，立即發送通知/i)).toBeInTheDocument();
  });

  it('displays correct description for scheduled mode', () => {
    const mockOnTimeChange = vi.fn();
    const mockOnModeChange = vi.fn();
    renderWithRouter(
      <AdminAutoAssignedNotificationTimeSettings
        notificationTime="21:00"
        notificationMode="scheduled"
        onNotificationTimeChange={mockOnTimeChange}
        onNotificationModeChange={mockOnModeChange}
      />
    );

    expect(screen.getByText(/在設定的時間統一發送待審核的預約資訊/i)).toBeInTheDocument();
  });

  it('opens info modal when info button is clicked', () => {
    const mockOnTimeChange = vi.fn();
    const mockOnModeChange = vi.fn();
    renderWithRouter(
      <AdminAutoAssignedNotificationTimeSettings
        notificationTime="21:00"
        notificationMode="scheduled"
        onNotificationTimeChange={mockOnTimeChange}
        onNotificationModeChange={mockOnModeChange}
      />
    );

    const infoButton = screen.getByLabelText('查看說明');
    fireEvent.click(infoButton);

    // Check for modal title (h3 element)
    const modalTitle = screen.getByRole('heading', { name: /待審核預約提醒/i });
    expect(modalTitle).toBeInTheDocument();
  });
});

