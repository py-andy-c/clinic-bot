/**
 * Integration tests for ClinicSwitcher component.
 * 
 * Tests the clinic switching UI component behavior,
 * including dropdown interaction, error handling, and loading states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ClinicSwitcher from '../ClinicSwitcher';
import { ClinicInfo } from '../../types';

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ClinicSwitcher', () => {
  const mockClinics: ClinicInfo[] = [
    {
      id: 1,
      name: 'Clinic A',
      display_name: 'Clinic A',
      roles: ['admin'],
      is_active: true,
      last_accessed_at: '2025-01-15T10:00:00Z',
    },
    {
      id: 2,
      name: 'Clinic B',
      display_name: 'Clinic B',
      roles: ['practitioner'],
      is_active: true,
      last_accessed_at: '2025-01-14T10:00:00Z',
    },
    {
      id: 3,
      name: 'Clinic C',
      display_name: 'Clinic C',
      roles: ['admin', 'practitioner'],
      is_active: false,
      last_accessed_at: null,
    },
  ];

  const mockOnSwitch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when user has no clinics', () => {
    const { container } = render(
      <ClinicSwitcher
        currentClinicId={null}
        availableClinics={[]}
        onSwitch={mockOnSwitch}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should render current clinic name even when user has only one clinic', () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={[mockClinics[0]!]}
        onSwitch={mockOnSwitch}
      />
    );
    
    // Should show clinic name
    expect(screen.getByText('Clinic A')).toBeInTheDocument();
    // Should not show dropdown arrow
    const button = screen.getByRole('button');
    expect(button).not.toBeDisabled();
    // Should not have dropdown arrow icon
    const arrowIcon = button.querySelector('svg[viewBox="0 0 24 24"]');
    expect(arrowIcon).not.toBeInTheDocument();
  });

  it('should render current clinic name', () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
      />
    );

    expect(screen.getByText('Clinic A')).toBeInTheDocument();
  });

  it('should open dropdown when clicked', async () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Should show current clinic and other clinics
    const clinicATexts = screen.getAllByText('Clinic A');
    expect(clinicATexts.length).toBeGreaterThan(0);
    expect(screen.getByText('Clinic B')).toBeInTheDocument();
  });

  it('should display current clinic with checkmark', async () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Clinic A appears in both button and dropdown, use getAllByText
    const clinicATexts = screen.getAllByText('Clinic A');
    expect(clinicATexts.length).toBeGreaterThan(0);
  });

  it('should call onSwitch when clicking another clinic', async () => {
    mockOnSwitch.mockResolvedValue(undefined);

    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Find and click Clinic B
    const clinicBButton = screen.getByText('Clinic B').closest('button');
    expect(clinicBButton).toBeInTheDocument();
    fireEvent.click(clinicBButton!);

    await waitFor(() => {
      expect(mockOnSwitch).toHaveBeenCalledWith(2);
    });
  });

  it('should show loading state during switch', () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
        isSwitching={true}
      />
    );

    expect(screen.getByText('切換中...')).toBeInTheDocument();
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('should display error message when switch fails', async () => {
    const errorMessage = '切換診所失敗，請稍後再試';
    mockOnSwitch.mockRejectedValue(new Error(errorMessage));

    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    const clinicBButton = screen.getByText('Clinic B').closest('button');
    fireEvent.click(clinicBButton!);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it('should close dropdown when clicking outside', async () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <ClinicSwitcher
          currentClinicId={1}
          availableClinics={mockClinics}
          onSwitch={mockOnSwitch}
        />
      </div>
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Dropdown should be open (Clinic B should be visible)
    expect(screen.getByText('Clinic B')).toBeInTheDocument();

    const outside = screen.getByTestId('outside');
    fireEvent.mouseDown(outside);

    await waitFor(() => {
      // Dropdown should be closed (Clinic B should not be visible)
      expect(screen.queryByText('Clinic B')).not.toBeInTheDocument();
    });
  });

  it('should close dropdown on Escape key', async () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Dropdown should be open (Clinic B should be visible)
    expect(screen.getByText('Clinic B')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      // Dropdown should be closed (Clinic B should not be visible)
      expect(screen.queryByText('Clinic B')).not.toBeInTheDocument();
    });
  });


  it('should display inactive status for inactive clinics', async () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(screen.getByText('已停用')).toBeInTheDocument();
  });


  it('should not call onSwitch when clicking current clinic', async () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Current clinic button should not trigger switch
    expect(mockOnSwitch).not.toHaveBeenCalled();
  });

  it('should prevent concurrent switches', async () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
        isSwitching={true}
      />
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();

    // Try to click while switching
    fireEvent.click(button);

    // Should not open dropdown during switch
    expect(screen.queryByText('Clinic B')).not.toBeInTheDocument();
  });
});

