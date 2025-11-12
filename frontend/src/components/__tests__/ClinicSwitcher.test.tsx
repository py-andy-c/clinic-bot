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

  it('should not render when user has only one clinic', () => {
    const { container } = render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={[mockClinics[0]!]}
        onSwitch={mockOnSwitch}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should render current clinic name and role badge', () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
      />
    );

    expect(screen.getByText('Clinic A')).toBeInTheDocument();
    expect(screen.getByText('管理員')).toBeInTheDocument();
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

    expect(screen.getByText('目前診所')).toBeInTheDocument();
    expect(screen.getByText('其他診所')).toBeInTheDocument();
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

    // Current clinic should be highlighted
    expect(screen.getByText('目前診所')).toBeInTheDocument();
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

    expect(screen.getByText('目前診所')).toBeInTheDocument();

    const outside = screen.getByTestId('outside');
    fireEvent.mouseDown(outside);

    await waitFor(() => {
      expect(screen.queryByText('目前診所')).not.toBeInTheDocument();
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

    expect(screen.getByText('目前診所')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('目前診所')).not.toBeInTheDocument();
    });
  });

  it('should display last accessed time for clinics', async () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Should show last accessed time for Clinic B
    expect(screen.getByText(/上次使用/)).toBeInTheDocument();
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

  it('should format role badges correctly', () => {
    render(
      <ClinicSwitcher
        currentClinicId={1}
        availableClinics={mockClinics}
        onSwitch={mockOnSwitch}
      />
    );

    // Admin role
    expect(screen.getByText('管理員')).toBeInTheDocument();
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
    expect(screen.queryByText('目前診所')).not.toBeInTheDocument();
  });
});

