import React from 'react';
import { render, screen } from '@testing-library/react';
import CalendarLayout from '../CalendarLayout';

describe('CalendarLayout', () => {
  it('renders children correctly', () => {
    const testContent = 'Test calendar content';
    render(
      <CalendarLayout>
        <div>{testContent}</div>
      </CalendarLayout>
    );

    expect(screen.getByText(testContent)).toBeInTheDocument();
  });

  it('applies calendar layout styles', () => {
    const { container } = render(
      <CalendarLayout>
        <div>Test content</div>
      </CalendarLayout>
    );

    const layoutDiv = container.firstChild as HTMLElement;
    // CSS modules transform class names, so we check that a class is applied
    expect(layoutDiv.className).toMatch(/^_calendarLayout_/);
  });

  it('renders multiple children', () => {
    render(
      <CalendarLayout>
        <div>Child 1</div>
        <div>Child 2</div>
      </CalendarLayout>
    );

    expect(screen.getByText('Child 1')).toBeInTheDocument();
    expect(screen.getByText('Child 2')).toBeInTheDocument();
  });
});