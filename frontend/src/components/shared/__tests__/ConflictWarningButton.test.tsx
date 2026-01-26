import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConflictWarningButton } from '../ConflictWarningButton';
import { SchedulingConflictResponse } from '../../../types';

// Mock the ConflictIndicator component
vi.mock('../ConflictIndicator', () => ({
  ConflictIndicator: ({ conflictInfo }: { conflictInfo: SchedulingConflictResponse }) => (
    <span data-testid="conflict-indicator" onClick={() => { }}>
      ⚠️ Conflict: {conflictInfo.conflict_type}
    </span>
  ),
}));

describe('ConflictWarningButton', () => {
  it('renders nothing when there are no conflicts', () => {
    const { container } = render(
      <ConflictWarningButton conflictInfo={null} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when conflictInfo has no conflicts', () => {
    const conflictInfo: SchedulingConflictResponse = {
      has_conflict: false,
      conflict_type: null,
      appointment_conflict: null,
      exception_conflict: null,
      default_availability: { is_within_hours: true },
    };

    const { container } = render(
      <ConflictWarningButton conflictInfo={conflictInfo} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders ConflictIndicator when there are conflicts', () => {
    const conflictInfo: SchedulingConflictResponse = {
      has_conflict: true,
      conflict_type: 'appointment',
      appointment_conflict: {
        conflicting_appointments: [{
          id: 1,
          patient_name: 'Test Patient',
          start_time: '2024-01-15T10:00:00',
          end_time: '2024-01-15T11:00:00',
        }],
      },
      exception_conflict: null,
      resource_conflicts: null,
    };

    render(<ConflictWarningButton conflictInfo={conflictInfo} />);

    expect(screen.getByTestId('conflict-indicator')).toBeInTheDocument();
    expect(screen.getByText('⚠️ Conflict: appointment')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const conflictInfo: SchedulingConflictResponse = {
      has_conflict: true,
      conflict_type: 'exception',
      appointment_conflict: null,
      exception_conflict: {
        exception_name: 'Holiday',
        start_time: '2024-01-15T00:00:00',
        end_time: '2024-01-15T23:59:59',
      },
      resource_conflicts: null,
    };

    const { container } = render(
      <ConflictWarningButton conflictInfo={conflictInfo} className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });
});
