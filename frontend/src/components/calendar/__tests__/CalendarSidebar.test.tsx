import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { Views } from 'react-big-calendar';
import CalendarSidebar from '../CalendarSidebar';

// Mock the color utilities
vi.mock('../../../utils/practitionerColors');
vi.mock('../../../utils/resourceColorUtils');

describe('CalendarSidebar', () => {
  const mockProps = {
    view: Views.DAY,
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
    isOpen: true,
    onToggle: vi.fn(),
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
});