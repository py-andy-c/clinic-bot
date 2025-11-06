import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorMessage } from '../ErrorMessage';

describe('ErrorMessage', () => {
  it('renders error message', () => {
    render(<ErrorMessage message="Test error message" />);
    expect(screen.getByText('Test error message')).toBeInTheDocument();
    expect(screen.getByText('發生錯誤')).toBeInTheDocument();
  });

  it('renders warning icon by default', () => {
    render(<ErrorMessage message="Test error" />);
    // The icon is a div with an emoji, not an img element
    const iconContainer = screen.getByText('⚠️');
    expect(iconContainer).toBeInTheDocument();
    expect(iconContainer).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not render icon when showIcon is false', () => {
    render(<ErrorMessage message="Test error" showIcon={false} />);
    // The icon is a div with an emoji, not an img element
    const iconContainer = screen.queryByText('⚠️');
    expect(iconContainer).not.toBeInTheDocument();
  });

  it('renders retry button when onRetry is provided', () => {
    const mockOnRetry = vi.fn();
    render(<ErrorMessage message="Test error" onRetry={mockOnRetry} />);
    const retryButton = screen.getByRole('button', { name: /重試/i });
    expect(retryButton).toBeInTheDocument();
  });

  it('does not render retry button when onRetry is not provided', () => {
    render(<ErrorMessage message="Test error" />);
    const retryButton = screen.queryByRole('button', { name: /重試/i });
    expect(retryButton).not.toBeInTheDocument();
  });

  it('calls onRetry when retry button is clicked', () => {
    const mockOnRetry = vi.fn();
    render(<ErrorMessage message="Test error" onRetry={mockOnRetry} />);
    const retryButton = screen.getByRole('button', { name: /重試/i });
    fireEvent.click(retryButton);
    expect(mockOnRetry).toHaveBeenCalledTimes(1);
  });

  it('renders custom retry button text', () => {
    const mockOnRetry = vi.fn();
    render(<ErrorMessage message="Test error" onRetry={mockOnRetry} retryText="Try Again" />);
    const retryButton = screen.getByRole('button', { name: 'Try Again' });
    expect(retryButton).toBeInTheDocument();
  });

  it('renders full screen when fullScreen prop is true', () => {
    render(<ErrorMessage message="Test error" fullScreen />);
    const container = screen.getByRole('alert').parentElement;
    expect(container).toHaveClass('min-h-screen');
  });

  it('renders inline when fullScreen prop is false', () => {
    render(<ErrorMessage message="Test error" fullScreen={false} />);
    const container = screen.getByRole('alert').parentElement;
    expect(container).not.toHaveClass('min-h-screen');
  });

  it('renders with custom className', () => {
    render(<ErrorMessage message="Test error" className="custom-error" />);
    const container = screen.getByRole('alert');
    expect(container).toHaveClass('text-center', 'custom-error');
  });

  it('has proper accessibility attributes', () => {
    render(<ErrorMessage message="Test error" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('renders multiline messages correctly', () => {
    const multilineMessage = 'Line 1\nLine 2\nLine 3';
    render(<ErrorMessage message={multilineMessage} />);
    // The message is rendered with whitespace-pre-line, so all lines are in one text node
    const messageElement = screen.getByText(/Line 1/);
    expect(messageElement).toBeInTheDocument();
    expect(messageElement.textContent).toContain('Line 1');
    expect(messageElement.textContent).toContain('Line 2');
    expect(messageElement.textContent).toContain('Line 3');
  });
});
