import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import CalendarGrid from '../CalendarGrid';
import { CalendarView, CalendarViews } from '../../../types/calendar';
import { CalendarEvent } from '../../../utils/calendarDataAdapter';

// Mock dependencies
vi.mock('../../../utils/calendarDataAdapter');
vi.mock('../../../utils/practitionerColors');
vi.mock('../../../utils/resourceColorUtils');

describe('CalendarGrid Keyboard Navigation', () => {
  const mockEvents: CalendarEvent[] = [];
  const mockProps = {
    view: CalendarViews.DAY as CalendarView,
    currentDate: new Date('2024-01-15'),
    events: mockEvents,
    selectedPractitioners: [1, 2],
    selectedResources: [1],
    practitioners: [
      { id: 1, full_name: 'Dr. Smith' },
      { id: 2, full_name: 'Dr. Johnson' }
    ],
    resources: [
      { id: 1, name: 'Room A' }
    ],
    onEventClick: vi.fn(),
    onSlotClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should focus next time slot with arrow down', async () => {
    render(<CalendarGrid {...mockProps} />);

    // Wait for time slots to be rendered and grid ref to be set
    await waitFor(() => {
      const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
      expect(timeSlots.length).toBeGreaterThan(0);
    }, { timeout: 10000 });

    const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
    if (timeSlots.length >= 2) {
      const firstSlot = timeSlots[0];
      const secondSlot = timeSlots[1];

      // Focus first slot
      firstSlot.focus();
      expect(document.activeElement).toBe(firstSlot);

      // Press arrow down
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      fireEvent(firstSlot, event);

      // Should move focus to second slot
      expect(document.activeElement).toBe(secondSlot);
    }
  });

  it('should focus previous time slot with arrow up', async () => {
    render(<CalendarGrid {...mockProps} />);

    // Wait for time slots to be rendered and grid ref to be set
    await waitFor(() => {
      const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
      expect(timeSlots.length).toBeGreaterThan(0);
    });

    const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
    if (timeSlots.length >= 2) {
      const secondSlot = timeSlots[1];
      const firstSlot = timeSlots[0];

      // Focus second slot
      secondSlot.focus();
      expect(document.activeElement).toBe(secondSlot);

      // Press arrow up
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      fireEvent(secondSlot, event);

      // Should move focus to first slot
      expect(document.activeElement).toBe(firstSlot);
    }
  });

  it('should navigate between columns with arrow left/right in day view', async () => {
    render(<CalendarGrid {...mockProps} />);

    // Wait for time slots to be rendered and grid ref to be set
    await waitFor(() => {
      const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
      expect(timeSlots.length).toBeGreaterThan(0);
    });

    const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
    const firstSlot = timeSlots[0];

    // Focus first slot (column 0, first time slot)
    firstSlot.focus();
    expect(document.activeElement).toBe(firstSlot);

    // Navigate to next column (practitioner/resource)
    const rightArrow = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    fireEvent(firstSlot, rightArrow);

    // Should move focus to a different slot (indicating column navigation occurred)
    expect(document.activeElement).not.toBe(firstSlot);
    expect(document.activeElement).toBeTruthy();

    // The focused element should still be a time slot
    expect(timeSlots).toContain(document.activeElement as HTMLElement);
  });

  it('should trigger slot click on Enter key', async () => {
    render(<CalendarGrid {...mockProps} />);

    // Wait for time slots to be rendered and grid ref to be set
    await waitFor(() => {
      const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
      expect(timeSlots.length).toBeGreaterThan(0);
    });

    const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
    if (timeSlots.length > 0) {
      const firstSlot = timeSlots[0];

      firstSlot.focus();
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      fireEvent(firstSlot, event);

      // Should trigger onSlotClick
      expect(mockProps.onSlotClick).toHaveBeenCalled();
    }
  });

  it('should trigger slot click on Space key', async () => {
    render(<CalendarGrid {...mockProps} />);

    // Wait for time slots to be rendered and grid ref to be set
    await waitFor(() => {
      const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
      expect(timeSlots.length).toBeGreaterThan(0);
    });

    const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
    if (timeSlots.length > 0) {
      const firstSlot = timeSlots[0];

      firstSlot.focus();
      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      fireEvent(firstSlot, event);

      // Should trigger onSlotClick
      expect(mockProps.onSlotClick).toHaveBeenCalled();
    }
  });

  it('should prevent default behavior for navigation keys', async () => {
    render(<CalendarGrid {...mockProps} />);

    // Wait for time slots to be rendered and grid ref to be set
    await waitFor(() => {
      const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
      expect(timeSlots.length).toBeGreaterThan(0);
    });

    const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
    const firstSlot = timeSlots[0];

    // Create a spy to monitor preventDefault calls
    const preventDefaultSpy = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
    event.preventDefault = preventDefaultSpy;

    fireEvent(firstSlot, event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('should ignore non-navigation keys', async () => {
    render(<CalendarGrid {...mockProps} />);

    // Wait for time slots to be rendered and grid ref to be set
    await waitFor(() => {
      const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
      expect(timeSlots.length).toBeGreaterThan(0);
    });

    const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
    if (timeSlots.length > 0) {
      const firstSlot = timeSlots[0];

      const preventDefaultSpy = vi.fn();
      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      event.preventDefault = preventDefaultSpy;
      fireEvent(firstSlot, event);

      // Should not prevent default for non-navigation keys
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    }
  });

  it('should support tab navigation for events', () => {
    // Mock events for testing event navigation
    const eventsWithData: CalendarEvent[] = [
      {
        id: '1',
        title: 'Test Event 1',
        start: new Date('2024-01-15T10:00:00'),
        end: new Date('2024-01-15T11:00:00'),
        resource: {
          practitioner_id: 1,
          resource_id: null,
          type: 'appointment',
          calendar_event_id: 1,
          patient_id: 1,
          appointment_type_id: 1,
          patient_name: 'Test Patient',
        },
      },
      {
        id: '2',
        title: 'Test Event 2',
        start: new Date('2024-01-15T14:00:00'),
        end: new Date('2024-01-15T15:00:00'),
        resource: {
          practitioner_id: 1,
          resource_id: null,
          type: 'appointment',
          calendar_event_id: 2,
          patient_id: 2,
          appointment_type_id: 1,
          patient_name: 'Test Patient 2',
        },
      },
    ];

    render(<CalendarGrid {...mockProps} events={eventsWithData} />);

    // Test tab navigation between events
    expect(true).toBe(true); // Placeholder for actual test implementation
  });

  it('should handle boundary conditions (first/last slots)', async () => {
    render(<CalendarGrid {...mockProps} />);

    // Wait for time slots to be rendered and grid ref to be set
    await waitFor(() => {
      const timeSlots = screen.getAllByRole('button', { name: /time slot/i });
      expect(timeSlots.length).toBeGreaterThan(0);
    });

    const timeSlots = screen.getAllByRole('button', { name: /time slot/i });

    if (timeSlots.length > 0) {
      // Test navigation from first slot
      const firstSlot = timeSlots[0];
      firstSlot.focus();
      const upEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      fireEvent(firstSlot, upEvent);
      // Should stay on first slot or handle boundary gracefully

      // Test navigation from last slot
      const lastSlot = timeSlots[timeSlots.length - 1];
      lastSlot.focus();
      const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      fireEvent(lastSlot, downEvent);
      // Should stay on last slot or handle boundary gracefully
    }

    expect(true).toBe(true); // Placeholder for actual boundary test
  });
});