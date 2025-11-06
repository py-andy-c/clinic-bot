import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingSpinner } from '../LoadingSpinner';

describe('LoadingSpinner', () => {
  it('renders with default size (md)', () => {
    render(<LoadingSpinner />);
    const spinner = screen.getByRole('status');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveClass('animate-spin', 'rounded-full', 'h-8', 'w-8', 'border-b-2', 'border-primary-600');
  });

  it('renders with small size', () => {
    render(<LoadingSpinner size="sm" />);
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveClass('h-6', 'w-6');
  });

  it('renders with large size', () => {
    render(<LoadingSpinner size="lg" />);
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveClass('h-12', 'w-12');
  });

  it('renders with extra large size', () => {
    render(<LoadingSpinner size="xl" />);
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveClass('h-32', 'w-32');
  });

  it('renders with custom className', () => {
    render(<LoadingSpinner className="custom-class" />);
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveClass('custom-class');
  });

  it('renders with custom aria-label', () => {
    render(<LoadingSpinner aria-label="Custom loading" />);
    const spinner = screen.getByLabelText('Custom loading');
    expect(spinner).toBeInTheDocument();
  });

  it('renders full screen when fullScreen prop is true', () => {
    render(<LoadingSpinner fullScreen />);
    const container = screen.getByRole('status').parentElement;
    expect(container).toHaveClass('min-h-screen', 'flex', 'items-center', 'justify-center');
  });

  it('renders screen reader text', () => {
    render(<LoadingSpinner />);
    expect(screen.getByText('載入中...')).toBeInTheDocument();
  });

  it('has proper accessibility attributes', () => {
    render(<LoadingSpinner />);
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveAttribute('aria-live', 'polite');
    expect(spinner).toHaveAttribute('aria-busy', 'true');
  });
});
