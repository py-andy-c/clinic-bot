import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
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

  it('calls onCreateAppointment when appointment button is clicked', () => {
    render(<CalendarDateStrip {...mockProps} />);
    const button = screen.getByTitle('Create Appointment');
    fireEvent.click(button);
    expect(mockProps.onCreateAppointment).toHaveBeenCalled();
  });

  it('calls onCreateException when exception button is clicked', () => {
    render(<CalendarDateStrip {...mockProps} />);
    const button = screen.getByTitle('Create Availability Exception');
    fireEvent.click(button);
    expect(mockProps.onCreateException).toHaveBeenCalled();
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

  it('does not show exception button for non-practitioners', () => {
    render(<CalendarDateStrip {...mockProps} isPractitioner={false} />);
    const exceptionButton = screen.queryByTitle('Create Availability Exception');
    expect(exceptionButton).not.toBeInTheDocument();
  });

  it('shows exception button for practitioners', () => {
    render(<CalendarDateStrip {...mockProps} isPractitioner={true} />);
    const exceptionButton = screen.getByTitle('Create Availability Exception');
    expect(exceptionButton).toBeInTheDocument();
  });
});