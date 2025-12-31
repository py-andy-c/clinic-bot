/**
 * Unit tests for PageHeader component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PageHeader from '../PageHeader';

describe('PageHeader', () => {
  it('should render title', () => {
    render(<PageHeader title="Test Title" />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('should render action when provided', () => {
    render(
      <PageHeader title="Test Title" action={<button>Action Button</button>} />
    );
    expect(screen.getByRole('button', { name: 'Action Button' })).toBeInTheDocument();
  });

  it('should not render action when not provided', () => {
    render(<PageHeader title="Test Title" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('should apply custom className', () => {
    render(
      <PageHeader title="Test Title" className="custom-class" />
    );
    const header = container.firstChild;
    expect(header).toHaveClass('custom-class');
  });

  it('should have proper heading structure', () => {
    render(<PageHeader title="Test Title" />);
    const heading = screen.getByRole('heading', { name: 'Test Title' });
    expect(heading).toBeInTheDocument();
    expect(heading.tagName).toBe('H1');
  });

  it('should render multiple action elements', () => {
    render(
      <PageHeader
        title="Test Title"
        action={
          <>
            <button>Button 1</button>
            <button>Button 2</button>
          </>
        }
      />
    );
    expect(screen.getByRole('button', { name: 'Button 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Button 2' })).toBeInTheDocument();
  });
});

