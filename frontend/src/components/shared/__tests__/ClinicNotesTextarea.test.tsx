/**
 * Unit tests for ClinicNotesTextarea component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ClinicNotesTextarea } from '../ClinicNotesTextarea';

describe('ClinicNotesTextarea', () => {
  it('should render with default props', () => {
    const handleChange = vi.fn();
    render(<ClinicNotesTextarea value="" onChange={handleChange} />);
    
    const textarea = screen.getByPlaceholderText('診所內部備注（僅診所人員可見）');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('');
  });

  it('should render with custom value', () => {
    const handleChange = vi.fn();
    render(<ClinicNotesTextarea value="Test notes" onChange={handleChange} />);
    
    const textarea = screen.getByPlaceholderText('診所內部備注（僅診所人員可見）');
    expect(textarea).toHaveValue('Test notes');
  });

  it('should call onChange when text is entered', () => {
    const handleChange = vi.fn();
    render(<ClinicNotesTextarea value="" onChange={handleChange} />);
    
    const textarea = screen.getByPlaceholderText('診所內部備注（僅診所人員可見）');
    fireEvent.change(textarea, { target: { value: 'New notes' } });
    
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('should use custom placeholder when provided', () => {
    const handleChange = vi.fn();
    render(
      <ClinicNotesTextarea 
        value="" 
        onChange={handleChange} 
        placeholder="Custom placeholder" 
      />
    );
    
    const textarea = screen.getByPlaceholderText('Custom placeholder');
    expect(textarea).toBeInTheDocument();
  });

  it('should respect maxLength of 1000', () => {
    const handleChange = vi.fn();
    render(<ClinicNotesTextarea value="" onChange={handleChange} />);
    
    const textarea = screen.getByPlaceholderText('診所內部備注（僅診所人員可見）');
    expect(textarea).toHaveAttribute('maxLength', '1000');
  });

  it('should be disabled when disabled prop is true', () => {
    const handleChange = vi.fn();
    render(<ClinicNotesTextarea value="Test" onChange={handleChange} disabled />);
    
    const textarea = screen.getByPlaceholderText('診所內部備注（僅診所人員可見）');
    expect(textarea).toBeDisabled();
  });

  it('should use custom rows when provided', () => {
    const handleChange = vi.fn();
    render(<ClinicNotesTextarea value="" onChange={handleChange} rows={6} />);
    
    const textarea = screen.getByPlaceholderText('診所內部備注（僅診所人員可見）');
    expect(textarea).toHaveAttribute('rows', '6');
  });

  it('should apply custom className', () => {
    const handleChange = vi.fn();
    render(
      <ClinicNotesTextarea 
        value="" 
        onChange={handleChange} 
        className="custom-class" 
      />
    );
    
    const textarea = screen.getByPlaceholderText('診所內部備注（僅診所人員可見）');
    expect(textarea).toHaveClass('custom-class');
  });
});



