import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterDropdown } from '../FilterDropdown';

describe('FilterDropdown', () => {
  const mockOnChange = vi.fn();
  const practitioners = [
    { id: 1, full_name: '王醫師' },
    { id: 2, full_name: '李治療師' },
  ];
  const serviceItems = [
    { id: 1, name: '初診評估', receipt_name: '初診評估', is_custom: false },
    { id: 2, name: '特殊檢查', receipt_name: '特殊檢查', is_custom: true },
  ];

  describe('Practitioner dropdown', () => {
    it('renders all practitioners', () => {
      render(
        <FilterDropdown
          type="practitioner"
          value={null}
          onChange={mockOnChange}
          practitioners={practitioners}
        />
      );
      expect(screen.getByText('全部')).toBeInTheDocument();
      expect(screen.getByText('王醫師')).toBeInTheDocument();
      expect(screen.getByText('李治療師')).toBeInTheDocument();
    });

    it('calls onChange when selection changes', () => {
      render(
        <FilterDropdown
          type="practitioner"
          value={null}
          onChange={mockOnChange}
          practitioners={practitioners}
        />
      );
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: '1' } });
      expect(mockOnChange).toHaveBeenCalledWith(1);
    });
  });

  describe('Service item dropdown', () => {
    it('renders standard and custom items with separators', () => {
      render(
        <FilterDropdown
          type="service"
          value={null}
          onChange={mockOnChange}
          serviceItems={serviceItems}
          standardServiceItemIds={new Set([1])}
        />
      );
      expect(screen.getByText('全部')).toBeInTheDocument();
      expect(screen.getByText('初診評估')).toBeInTheDocument();
      expect(screen.getByText(/特殊檢查/)).toBeInTheDocument();
    });
  });
});



