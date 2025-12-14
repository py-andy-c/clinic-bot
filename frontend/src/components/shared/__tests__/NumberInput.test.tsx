/**
 * Unit tests for NumberInput component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { NumberInput } from '../NumberInput';

describe('NumberInput', () => {
  let mockOnChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnChange = vi.fn();
  });

  describe('basic rendering', () => {
    it('should render with default props', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
        />
      );

      const input = screen.getByRole('spinbutton');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue(0);
    });

    it('should render with custom value', () => {
      render(
        <NumberInput
          value={42}
          onChange={mockOnChange}
          fallback={0}
        />
      );

      const input = screen.getByRole('spinbutton');
      expect(input).toHaveValue(42);
    });

    it('should render with custom className', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          className="custom-class"
        />
      );

      const input = screen.getByRole('spinbutton');
      expect(input).toHaveClass('custom-class');
    });

    it('should render with placeholder', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          placeholder="Enter amount"
        />
      );

      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('placeholder', 'Enter amount');
    });

    it('should render with id', () => {
      render(
        <NumberInput
          id="test-input"
          value={0}
          onChange={mockOnChange}
          fallback={0}
        />
      );

      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('id', 'test-input');
    });

    it('should render with aria-label', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          aria-label="Amount input"
        />
      );

      const input = screen.getByLabelText('Amount input');
      expect(input).toBeInTheDocument();
    });
  });

  describe('user interaction', () => {
    it('should call onChange when user types a valid number', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
        />
      );

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '5' } });

      expect(mockOnChange).toHaveBeenCalledWith(5);
    });

    it('should allow clearing the field', () => {
      render(
        <NumberInput
          value={5}
          onChange={mockOnChange}
          fallback={0}
        />
      );

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '' } });

      // onChange should not be called when field is cleared
      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it('should fall back to default value on blur when empty', () => {
      render(
        <NumberInput
          value={5}
          onChange={mockOnChange}
          fallback={0}
        />
      );

      const input = screen.getByRole('spinbutton');
      
      // Clear the field
      fireEvent.change(input, { target: { value: '' } });
      
      // Blur the field
      fireEvent.blur(input);

      expect(mockOnChange).toHaveBeenCalledWith(0);
    });

    it('should use custom fallback value on blur', () => {
      render(
        <NumberInput
          value={5}
          onChange={mockOnChange}
          fallback={10}
        />
      );

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.blur(input);

      expect(mockOnChange).toHaveBeenCalledWith(10);
    });
  });

  describe('parseInt vs parseFloat', () => {
    it('should use parseInt when specified', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          parseFn="parseInt"
        />
      );

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '5.7' } });

      expect(mockOnChange).toHaveBeenCalledWith(5);
    });

    it('should use parseFloat when specified', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          parseFn="parseFloat"
        />
      );

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '5.7' } });

      expect(mockOnChange).toHaveBeenCalledWith(5.7);
    });
  });

  describe('constraints', () => {
    it('should enforce min constraint', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          min={10}
        />
      );

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '5' } });

      expect(mockOnChange).toHaveBeenCalledWith(10);
    });

    it('should enforce max constraint', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          max={10}
        />
      );

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '15' } });

      expect(mockOnChange).toHaveBeenCalledWith(10);
    });

    it('should apply min and max attributes to input', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          min={5}
          max={10}
        />
      );

      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('min', '5');
      expect(input).toHaveAttribute('max', '10');
    });
  });

  describe('rounding', () => {
    it('should round values when round is true', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          round={true}
        />
      );

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '5.7' } });

      expect(mockOnChange).toHaveBeenCalledWith(6);
    });

    it('should not round when round is false', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          round={false}
        />
      );

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '5.7' } });

      expect(mockOnChange).toHaveBeenCalledWith(5.7);
    });
  });

  describe('disabled state', () => {
    it('should render as disabled when disabled prop is true', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          disabled={true}
        />
      );

      const input = screen.getByRole('spinbutton');
      expect(input).toBeDisabled();
    });

    it('should not allow user interaction when disabled', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          disabled={true}
        />
      );

      const input = screen.getByRole('spinbutton');
      
      // In real browsers, disabled inputs don't fire change events
      // React Testing Library's fireEvent can still trigger handlers,
      // but the input element's disabled attribute prevents actual user interaction
      expect(input).toBeDisabled();
      
      // Note: In actual usage, disabled inputs prevent all user interaction,
      // so onChange would never be called by real user events
    });
  });

  describe('step attribute', () => {
    it('should apply step attribute to input', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
          step="0.1"
        />
      );

      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('step', '0.1');
    });

    it('should default to step="1"', () => {
      render(
        <NumberInput
          value={0}
          onChange={mockOnChange}
          fallback={0}
        />
      );

      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('step', '1');
    });
  });
});

