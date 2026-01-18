import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { Views } from 'react-big-calendar';
import CalendarDateStrip from '../CalendarDateStrip';

describe('CalendarDateStrip', () => {
  const mockProps = {
    view: Views.DAY,
    currentDate: new Date('2024-01-15'),
    onDateChange: vi.fn(),
    onCreateAppointment: vi.fn(),
    onCreateException: vi.fn(),
    onToday: vi.fn(),
    onSettings: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing for day view', () => {
    expect(() => render(<CalendarDateStrip {...mockProps} />)).not.toThrow();
  });

  it('renders without crashing for week view', () => {
    expect(() => render(<CalendarDateStrip {...mockProps} view={Views.WEEK} />)).not.toThrow();
  });

  it('renders without crashing for month view', () => {
    expect(() => render(<CalendarDateStrip {...mockProps} view={Views.MONTH} />)).not.toThrow();
  });
});