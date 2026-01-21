import React from 'react';
import { render, screen } from '@testing-library/react';
import CalendarLayout from '../CalendarLayout';

describe('CalendarLayout', () => {
  it('renders sidebar, dateStrip, and calendarGrid correctly', () => {
    const sidebarContent = 'Test sidebar';
    const dateStripContent = 'Test date strip';
    const calendarGridContent = 'Test calendar grid';

    render(
      <CalendarLayout
        sidebar={<div>{sidebarContent}</div>}
        dateStrip={<div>{dateStripContent}</div>}
        calendarGrid={<div>{calendarGridContent}</div>}
      />
    );

    expect(screen.getByText(sidebarContent)).toBeInTheDocument();
    expect(screen.getByText(dateStripContent)).toBeInTheDocument();
    expect(screen.getByText(calendarGridContent)).toBeInTheDocument();
  });

  it('applies calendar layout styles', () => {
    const { container } = render(
      <CalendarLayout
        sidebar={<div>Sidebar</div>}
        dateStrip={<div>Date Strip</div>}
        calendarGrid={<div>Calendar Grid</div>}
      />
    );

    const layoutDiv = container.firstChild as HTMLElement;
    // CSS modules transform class names, so we check that a class is applied
    expect(layoutDiv.className).toMatch(/^_calendarLayout_/);
  });

  it('renders calendar content wrapper', () => {
    const { container } = render(
      <CalendarLayout
        sidebar={<div>Sidebar</div>}
        dateStrip={<div>Date Strip</div>}
        calendarGrid={<div>Calendar Grid</div>}
      />
    );

    const layoutDiv = container.firstChild as HTMLElement;
    const calendarContentDiv = layoutDiv.children[1] as HTMLElement;
    expect(calendarContentDiv.className).toMatch(/^_calendarContent_/);
  });
});