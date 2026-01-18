import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { Views } from 'react-big-calendar';
import CalendarGrid from '../CalendarGrid';
import { CalendarEvent } from '../../../utils/calendarDataAdapter';

// Mock the calendar data adapter and color utilities
vi.mock('../../../utils/calendarDataAdapter');
vi.mock('../../../utils/practitionerColors');
vi.mock('../../../utils/resourceColorUtils');

describe('CalendarGrid', () => {
  const mockProps = {
    view: Views.DAY,
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
    expect(() => render(<CalendarGrid {...mockProps} view={Views.MONTH} />)).not.toThrow();
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
});