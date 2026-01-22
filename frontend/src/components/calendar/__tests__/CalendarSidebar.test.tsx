import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { CalendarViews } from '../../../types/calendar';
import CalendarSidebar from '../CalendarSidebar';

// Mock the color utilities
vi.mock('../../../utils/practitionerColors');
vi.mock('../../../utils/resourceColorUtils');

describe('CalendarSidebar', () => {
  const mockProps = {
    view: CalendarViews.DAY,
    onViewChange: vi.fn(),
    practitioners: [
      { id: 1, full_name: 'Dr. Smith' },
      { id: 2, full_name: 'Dr. Johnson' },
    ],
    selectedPractitioners: [1],
    onPractitionersChange: vi.fn(),
    resources: [
      { id: 3, name: 'Room A' },
      { id: 4, name: 'Room B' },
    ],
    selectedResources: [3],
    onResourcesChange: vi.fn(),
    currentUserId: null,
    isPractitioner: false,
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when open', () => {
    expect(() => render(<CalendarSidebar {...mockProps} />)).not.toThrow();
  });

  it('renders without crashing when closed', () => {
    expect(() => render(<CalendarSidebar {...mockProps} isOpen={false} />)).not.toThrow();
  });

  it('renders without crashing with empty data', () => {
    expect(() => render(
      <CalendarSidebar
        {...mockProps}
        practitioners={[]}
        resources={[]}
      />
    )).not.toThrow();
  });

  it('filters out current practitioner from sidebar when user is a practitioner', () => {
    const { queryByText } = render(
      <CalendarSidebar
        {...mockProps}
        practitioners={[
          { id: 1, full_name: 'Dr. Smith' },
          { id: 2, full_name: 'Dr. Johnson' },
        ]}
        currentUserId={1}
        isPractitioner={true}
      />
    );

    // Dr. Smith (current practitioner) should not be shown
    expect(queryByText('Dr. Smith')).not.toBeInTheDocument();
    // Dr. Johnson should be shown
    expect(queryByText('Dr. Johnson')).toBeInTheDocument();
  });

  it('shows all practitioners when user is not a practitioner', () => {
    const { queryByText } = render(
      <CalendarSidebar
        {...mockProps}
        practitioners={[
          { id: 1, full_name: 'Dr. Smith' },
          { id: 2, full_name: 'Dr. Johnson' },
        ]}
        currentUserId={1}
        isPractitioner={false}
      />
    );

    // Both practitioners should be shown
    expect(queryByText('Dr. Smith')).toBeInTheDocument();
    expect(queryByText('Dr. Johnson')).toBeInTheDocument();
  });
});