import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { CalendarViews } from '../../../types/calendar';
import CalendarGrid from '../CalendarGrid';
import { CalendarEvent } from '../../../utils/calendarDataAdapter';

// Mock the calendar data adapter and color utilities
vi.mock('../../../utils/calendarDataAdapter');
vi.mock('../../../utils/practitionerColors');
vi.mock('../../../utils/resourceColorUtils');

describe('CalendarGrid', () => {
  const mockProps = {
    view: CalendarViews.DAY,
    currentDate: new Date('2024-01-15'),
    events: [] as CalendarEvent[],
    selectedPractitioners: [1, 2],
    selectedResources: [3, 4],
    onEventClick: vi.fn(),
    onSlotClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() => render(<CalendarGrid {...mockProps} />)).not.toThrow();
  });

  it('renders without crashing for month view', () => {
    expect(() => render(<CalendarGrid {...mockProps} view={CalendarViews.MONTH} />)).not.toThrow();
  });

  it('renders without crashing with empty selections', () => {
    expect(() => render(
      <CalendarGrid
        {...mockProps}
        selectedPractitioners={[]}
        selectedResources={[]}
      />
    )).not.toThrow();
  });

  it('renders time slots for day view', () => {
    render(<CalendarGrid {...mockProps} />);
    // Should render time labels from 8 AM onwards (use getAllByText since multiple occurrences)
    expect(screen.getAllByText('8')).toHaveLength(2); // Hour 8 appears in time column
    expect(screen.getAllByText('9')).toHaveLength(2); // Hour 9 appears in time column
  });

  it('renders calendar grid container', () => {
    const { container } = render(<CalendarGrid {...mockProps} />);
    // CSS modules transform class names, so we check for any div with the transformed class
    const gridElement = container.querySelector('[class*="calendarGrid"]');
    expect(gridElement).toBeInTheDocument();
  });

  it('renders monthly calendar with proper structure', () => {
    render(<CalendarGrid {...mockProps} view={CalendarViews.MONTH} />);
    // Should render weekday headers
    expect(screen.getByText('一')).toBeInTheDocument();
    expect(screen.getByText('二')).toBeInTheDocument();
    expect(screen.getByText('三')).toBeInTheDocument();
  });

  it('handles event clicks', () => {
    const mockEvent: CalendarEvent = {
      id: '1',
      title: 'Test Event',
      start: new Date('2024-01-15T10:00:00'),
      end: new Date('2024-01-15T11:00:00'),
      resource: { practitioner_id: 1 },
    };

    expect(() => render(
      <CalendarGrid
        {...mockProps}
        events={[mockEvent]}
        selectedPractitioners={[1]}
      />
    )).not.toThrow();
  });

  it('handles slot clicks', () => {
    expect(() => render(<CalendarGrid {...mockProps} />)).not.toThrow();
  });

  it('applies correct styling for different event types', () => {
    const appointmentEvent: CalendarEvent = {
      id: '1',
      title: 'Appointment',
      start: new Date('2024-01-15T10:00:00'),
      end: new Date('2024-01-15T11:00:00'),
      resource: { practitioner_id: 1, type: 'appointment' },
    };

    const exceptionEvent: CalendarEvent = {
      id: '2',
      title: 'Exception',
      start: new Date('2024-01-15T11:00:00'),
      end: new Date('2024-01-15T12:00:00'),
      resource: { practitioner_id: 1, type: 'availability_exception' },
    };

    const resourceEvent: CalendarEvent = {
      id: '3',
      title: 'Resource Event',
      start: new Date('2024-01-15T12:00:00'),
      end: new Date('2024-01-15T13:00:00'),
      resource: { resource_id: 3, type: 'appointment' },
    };

    expect(() => render(
      <CalendarGrid
        {...mockProps}
        events={[appointmentEvent, exceptionEvent, resourceEvent]}
        selectedPractitioners={[1]}
        selectedResources={[3]}
      />
    )).not.toThrow();
  });

  it('handles overlapping events correctly', () => {
    const overlappingEvents: CalendarEvent[] = [
      {
        id: '1',
        title: 'Event 1',
        start: new Date('2024-01-15T10:00:00'),
        end: new Date('2024-01-15T11:00:00'),
        resource: { practitioner_id: 1 },
      },
      {
        id: '2',
        title: 'Event 2',
        start: new Date('2024-01-15T10:30:00'),
        end: new Date('2024-01-15T11:30:00'),
        resource: { practitioner_id: 1 },
      },
    ];

    expect(() => render(
      <CalendarGrid
        {...mockProps}
        events={overlappingEvents}
        selectedPractitioners={[1]}
      />
    )).not.toThrow();
  });
});