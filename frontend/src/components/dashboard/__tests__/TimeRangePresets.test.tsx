import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeRangePresets, getDateRangeForPreset, detectPresetFromDates } from '../TimeRangePresets';
import moment from 'moment-timezone';

describe('TimeRangePresets', () => {
  const mockOnSelect = vi.fn();

  it('renders all preset buttons', () => {
    render(<TimeRangePresets onSelect={mockOnSelect} />);
    expect(screen.getByText('本月')).toBeInTheDocument();
    expect(screen.getByText('最近3個月')).toBeInTheDocument();
    expect(screen.getByText('最近6個月')).toBeInTheDocument();
    expect(screen.getByText('最近1年')).toBeInTheDocument();
  });

  it('calls onSelect with correct preset when button is clicked', () => {
    render(<TimeRangePresets onSelect={mockOnSelect} />);
    fireEvent.click(screen.getByText('本月'));
    expect(mockOnSelect).toHaveBeenCalledWith('month');
  });

  it('highlights active preset button', () => {
    render(<TimeRangePresets onSelect={mockOnSelect} activePreset="month" />);
    const monthButton = screen.getByText('本月').closest('button');
    expect(monthButton).toHaveClass('bg-blue-600', 'text-white');
  });

  it('does not highlight inactive preset buttons', () => {
    render(<TimeRangePresets onSelect={mockOnSelect} activePreset="month" />);
    const threeMonthsButton = screen.getByText('最近3個月').closest('button');
    expect(threeMonthsButton).toHaveClass('bg-gray-100', 'text-gray-700');
    expect(threeMonthsButton).not.toHaveClass('bg-blue-600', 'text-white');
  });
});

describe('getDateRangeForPreset', () => {
  it('calculates month range correctly', () => {
    const result = getDateRangeForPreset('month');
    const today = moment();
    expect(result.startDate).toBe(today.startOf('month').format('YYYY-MM-DD'));
    expect(result.endDate).toBe(today.endOf('month').format('YYYY-MM-DD'));
  });

  it('calculates 3 months range correctly', () => {
    const result = getDateRangeForPreset('3months');
    const today = moment();
    const expectedStart = today.clone().subtract(2, 'months').startOf('month');
    expect(result.startDate).toBe(expectedStart.format('YYYY-MM-DD'));
    expect(result.endDate).toBe(today.endOf('month').format('YYYY-MM-DD'));
  });
});

describe('detectPresetFromDates', () => {
  it('detects month preset correctly', () => {
    const range = getDateRangeForPreset('month');
    const preset = detectPresetFromDates(range.startDate, range.endDate);
    expect(preset).toBe('month');
  });

  it('detects 3months preset correctly', () => {
    const range = getDateRangeForPreset('3months');
    const preset = detectPresetFromDates(range.startDate, range.endDate);
    expect(preset).toBe('3months');
  });

  it('returns null for non-preset dates', () => {
    const preset = detectPresetFromDates('2024-01-15', '2024-02-20');
    expect(preset).toBeNull();
  });
});



