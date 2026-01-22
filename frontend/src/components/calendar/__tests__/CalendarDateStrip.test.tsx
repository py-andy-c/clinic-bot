import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import moment from 'moment-timezone';
import { CalendarViews } from '../../../types/calendar';
import CalendarDateStrip from '../CalendarDateStrip';

describe('CalendarDateStrip', () => {
  const mockProps = {
    view: CalendarViews.DAY,
    currentDate: new Date('2024-01-15'),
    onDateChange: vi.fn(),
    onCreateAppointment: vi.fn(),
    onCreateException: vi.fn(),
    onToday: vi.fn(),
    onSettings: vi.fn(),
    isPractitioner: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing for day view', () => {
    expect(() => render(<CalendarDateStrip {...mockProps} />)).not.toThrow();
  });

  it('renders without crashing for week view', () => {
    expect(() => render(<CalendarDateStrip {...mockProps} view={CalendarViews.WEEK} />)).not.toThrow();
  });

  it('renders without crashing for month view', () => {
    expect(() => render(<CalendarDateStrip {...mockProps} view={CalendarViews.MONTH} />)).not.toThrow();
  });

  it('displays correct date format for day view', () => {
    render(<CalendarDateStrip {...mockProps} />);
    expect(screen.getByText('1月15日(一)')).toBeInTheDocument();
  });

  it('displays correct date format for week view', () => {
    render(<CalendarDateStrip {...mockProps} view={CalendarViews.WEEK} />);
    expect(screen.getByText('2024年1月')).toBeInTheDocument();
  });

  it('displays correct date format for month view', () => {
    render(<CalendarDateStrip {...mockProps} view={CalendarViews.MONTH} />);
    expect(screen.getByText('2024年1月')).toBeInTheDocument();
  });

  it('calls onDateChange when previous button is clicked', () => {
    render(<CalendarDateStrip {...mockProps} />);
    const prevButton = screen.getByText('‹');
    fireEvent.click(prevButton);
    expect(mockProps.onDateChange).toHaveBeenCalled();
  });

  it('calls onDateChange when next button is clicked', () => {
    render(<CalendarDateStrip {...mockProps} />);
    const nextButton = screen.getByText('›');
    fireEvent.click(nextButton);
    expect(mockProps.onDateChange).toHaveBeenCalled();
  });

  it('calls onCreateAppointment when appointment button is clicked on desktop', () => {
    // Mock as desktop (width > 1024px)
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });
    window.dispatchEvent(new Event('resize'));

    render(<CalendarDateStrip {...mockProps} />);
    const button = screen.getByTitle('Create Appointment');
    fireEvent.click(button);
    expect(mockProps.onCreateAppointment).toHaveBeenCalled();
  });

  it('calls onCreateException when exception button is clicked on desktop', () => {
    // Mock as desktop (width > 1024px)
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });
    window.dispatchEvent(new Event('resize'));

    render(<CalendarDateStrip {...mockProps} />);
    const button = screen.getByTitle('Create Availability Exception');
    fireEvent.click(button);
    expect(mockProps.onCreateException).toHaveBeenCalled();
  });

  it('shows FAB on mobile for appointment creation', () => {
    // Mock as mobile (width ≤ 1024px)
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 768,
    });
    window.dispatchEvent(new Event('resize'));

    render(<CalendarDateStrip {...mockProps} />);
    const fabButton = screen.getByTitle('Create appointment or exception');
    fireEvent.click(fabButton);

    const appointmentButton = screen.getByText('+ 預約');
    fireEvent.click(appointmentButton);
    expect(mockProps.onCreateAppointment).toHaveBeenCalled();
  });

  it('calls onToday when today button is clicked', () => {
    render(<CalendarDateStrip {...mockProps} />);
    const button = screen.getByTitle('Jump to Today');
    fireEvent.click(button);
    expect(mockProps.onToday).toHaveBeenCalled();
  });

  it('calls onSettings when settings button is clicked (mobile)', () => {
    // Mock window.innerWidth to be less than 1024px (mobile/tablet)
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 768,
    });

    // Trigger window resize event
    window.dispatchEvent(new Event('resize'));

    render(<CalendarDateStrip {...mockProps} />);
    const button = screen.getByTitle('Open Settings');
    fireEvent.click(button);
    expect(mockProps.onSettings).toHaveBeenCalled();
  });

  it('opens mini calendar when date display is clicked', () => {
    render(<CalendarDateStrip {...mockProps} />);
    const dateDisplay = screen.getByText('1月15日(一)');
    fireEvent.click(dateDisplay);

    // Mini calendar should now be visible
    expect(screen.getByText('2024年1月')).toBeInTheDocument();
  });

  it('does not show settings button on desktop', () => {
    // Mock window.innerWidth to be >= 1024px (desktop)
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });

    // Trigger window resize event
    window.dispatchEvent(new Event('resize'));

    render(<CalendarDateStrip {...mockProps} />);

    // Settings button should not be present
    const settingsButton = screen.queryByTitle('Open Settings');
    expect(settingsButton).not.toBeInTheDocument();
  });

  it('does not show exception button for non-practitioners on desktop', () => {
    // Mock as desktop (width > 1024px)
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });
    window.dispatchEvent(new Event('resize'));

    render(<CalendarDateStrip {...mockProps} isPractitioner={false} />);
    const exceptionButton = screen.queryByTitle('Create Availability Exception');
    expect(exceptionButton).not.toBeInTheDocument();
  });

  it('shows exception button for practitioners on desktop', () => {
    // Mock as desktop (width > 1024px)
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });
    window.dispatchEvent(new Event('resize'));

    render(<CalendarDateStrip {...mockProps} isPractitioner={true} />);
    const exceptionButton = screen.getByTitle('Create Availability Exception');
    expect(exceptionButton).toBeInTheDocument();
  });

  it('shows FAB exception button for practitioners on mobile', () => {
    // Mock as mobile (width ≤ 1024px)
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 768,
    });
    window.dispatchEvent(new Event('resize'));

    render(<CalendarDateStrip {...mockProps} isPractitioner={true} />);
    const fabButton = screen.getByTitle('Create appointment or exception');
    fireEvent.click(fabButton);

    const exceptionButton = screen.getByText('+ 休診');
    expect(exceptionButton).toBeInTheDocument();
  });

  describe('Mini Calendar', () => {
    it('displays weekdays starting with Sunday', () => {
      render(<CalendarDateStrip {...mockProps} />);
      const dateDisplay = screen.getByText('1月15日(一)');
      fireEvent.click(dateDisplay);

      // Check that weekdays are displayed in Sunday-first order
      const sunday = screen.getByText('日');
      const monday = screen.getByText('一');
      const tuesday = screen.getByText('二');
      const wednesday = screen.getByText('三');
      const thursday = screen.getByText('四');
      const friday = screen.getByText('五');
      const saturday = screen.getByText('六');

      expect(sunday).toBeInTheDocument();
      expect(monday).toBeInTheDocument();
      expect(tuesday).toBeInTheDocument();
      expect(wednesday).toBeInTheDocument();
      expect(thursday).toBeInTheDocument();
      expect(friday).toBeInTheDocument();
      expect(saturday).toBeInTheDocument();
    });

    it('displays calendar days correctly', () => {
      render(<CalendarDateStrip {...mockProps} />);
      const dateDisplay = screen.getByText('1月15日(一)');
      fireEvent.click(dateDisplay);

      // Verify mini calendar shows January 2024
      expect(screen.getByText('2024年1月')).toBeInTheDocument();

      // The day 15 should be visible in the calendar
      expect(screen.getByText('15')).toBeInTheDocument();
    });

    it('correctly selects the current date in Taiwan timezone', () => {
      const selectedDate = new Date('2024-01-15');
      render(<CalendarDateStrip {...mockProps} currentDate={selectedDate} />);
      const dateDisplay = screen.getByText('1月15日(一)');
      fireEvent.click(dateDisplay);

      // Verify mini calendar shows January 2024
      expect(screen.getByText('2024年1月')).toBeInTheDocument();

      // The day 15 should be visible in the calendar
      expect(screen.getByText('15')).toBeInTheDocument();
    });

    it('navigates to previous month correctly', () => {
      render(<CalendarDateStrip {...mockProps} />);
      const dateDisplay = screen.getByText('1月15日(一)');
      fireEvent.click(dateDisplay);

      // Click previous month button
      const prevButton = screen.getAllByText('‹')[1]; // Second ‹ button is for mini calendar
      fireEvent.click(prevButton);

      // Should now show December 2023
      expect(screen.getByText('2023年12月')).toBeInTheDocument();
    });

    it('navigates to next month correctly', () => {
      render(<CalendarDateStrip {...mockProps} />);
      const dateDisplay = screen.getByText('1月15日(一)');
      fireEvent.click(dateDisplay);

      // Click next month button
      const nextButton = screen.getAllByText('›')[1]; // Second › button is for mini calendar
      fireEvent.click(nextButton);

      // Should now show February 2024
      expect(screen.getByText('2024年2月')).toBeInTheDocument();
    });

    it('closes mini calendar when clicking outside', () => {
      render(<CalendarDateStrip {...mockProps} />);
      const dateDisplay = screen.getByText('1月15日(一)');
      fireEvent.click(dateDisplay);

      // Mini calendar should be open
      expect(screen.getByText('2024年1月')).toBeInTheDocument();

      // Click on the modal overlay (outside the content)
      const modal = screen.getByTestId('mini-calendar-modal');
      fireEvent.click(modal);

      // Mini calendar should be closed (header should not be visible)
      expect(screen.queryByText('2024年1月')).not.toBeInTheDocument();
    });
  });
});