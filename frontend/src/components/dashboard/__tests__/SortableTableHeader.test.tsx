import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortableTableHeader, SortDirection } from '../SortableTableHeader';

describe('SortableTableHeader', () => {
  const mockOnSort = vi.fn();
  const defaultProps = {
    column: 'date',
    currentSort: { column: 'date', direction: 'desc' as SortDirection },
    onSort: mockOnSort,
    children: 'Date',
  };

  it('renders header text', () => {
    render(<table><thead><tr><SortableTableHeader {...defaultProps} /></tr></thead></table>);
    expect(screen.getByText('Date')).toBeInTheDocument();
  });

  it('calls onSort when clicked', () => {
    render(<table><thead><tr><SortableTableHeader {...defaultProps} /></tr></thead></table>);
    const header = screen.getByRole('button');
    fireEvent.click(header);
    expect(mockOnSort).toHaveBeenCalledWith('date');
  });

  it('shows active sort indicator when column matches current sort', () => {
    render(<table><thead><tr><SortableTableHeader {...defaultProps} /></tr></thead></table>);
    const svg = screen.getByRole('button').querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.style.opacity).toBe('1');
  });

  it('shows inactive sort indicator when column does not match', () => {
    const props = {
      ...defaultProps,
      currentSort: { column: 'name', direction: 'asc' as SortDirection },
    };
    render(<table><thead><tr><SortableTableHeader {...props} /></tr></thead></table>);
    const svg = screen.getByRole('button').querySelector('svg');
    expect(svg?.style.opacity).toBe('0.5');
  });

  it('supports keyboard navigation', () => {
    render(<table><thead><tr><SortableTableHeader {...defaultProps} /></tr></thead></table>);
    const header = screen.getByRole('button');
    header.focus();
    fireEvent.keyDown(header, { key: 'Enter', code: 'Enter' });
    expect(mockOnSort).toHaveBeenCalled();
  });
});



