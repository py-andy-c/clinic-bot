import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
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

  it('shows all practitioners in dropdown including current practitioner so they can deselect themselves', () => {
    const { queryByText, getByTestId } = render(
      <CalendarSidebar
        {...mockProps}
        practitioners={[
          { id: 1, full_name: 'Dr. Smith' },
          { id: 2, full_name: 'Dr. Johnson' },
        ]}
        selectedPractitioners={[]} // No practitioners selected initially
      />
    );

    // Click the search input to open dropdown
    act(() => {
      const searchInput = getByTestId('practitioner-multiselect-search-input');
      fireEvent.focus(searchInput);
    });

    // Both practitioners should be available in dropdown so users can select/deselect any practitioner
    expect(queryByText('Dr. Smith')).toBeInTheDocument();
    expect(queryByText('Dr. Johnson')).toBeInTheDocument();
  });

  it('shows all practitioners in dropdown when none are selected', () => {
    const { queryByText, getByTestId } = render(
      <CalendarSidebar
        {...mockProps}
        practitioners={[
          { id: 1, full_name: 'Dr. Smith' },
          { id: 2, full_name: 'Dr. Johnson' },
        ]}
        selectedPractitioners={[]} // No practitioners selected initially
      />
    );

    // Click the search input to open dropdown
    act(() => {
      const searchInput = getByTestId('practitioner-multiselect-search-input');
      fireEvent.focus(searchInput);
    });

    // Both practitioners should be available in dropdown
    expect(queryByText('Dr. Smith')).toBeInTheDocument();
    expect(queryByText('Dr. Johnson')).toBeInTheDocument();
  });

  it('allows practitioners to deselect themselves', () => {
    const mockOnPractitionersChange = vi.fn();
    const { getByText } = render(
      <CalendarSidebar
        {...mockProps}
        practitioners={[
          { id: 1, full_name: 'Dr. Smith' },
          { id: 2, full_name: 'Dr. Johnson' },
        ]}
        selectedPractitioners={[1, 2]} // Both practitioners selected initially
        onPractitionersChange={mockOnPractitionersChange}
        currentUserId={1}
      />
    );

    // Click remove button for Dr. Smith (current practitioner)
    const removeButton = getByText('Dr. Smith').parentElement?.querySelector('button[aria-label="移除 Dr. Smith"]');
    expect(removeButton).toBeInTheDocument();

    fireEvent.click(removeButton!);

    // Should call onPractitionersChange with only Dr. Johnson remaining
    expect(mockOnPractitionersChange).toHaveBeenCalledWith([2]);
  });
});