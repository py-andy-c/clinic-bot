/**
 * Unit tests for BaseModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BaseModal } from '../BaseModal';

// Mock createPortal to render directly
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

describe('BaseModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children', () => {
    render(
      <BaseModal onClose={() => {}}>
        <div>Test Content</div>
      </BaseModal>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('should have dialog role and aria-modal', () => {
    render(
      <BaseModal onClose={() => {}} aria-label="Test Modal">
        <div>Content</div>
      </BaseModal>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Test Modal');
  });

  it('should call onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(
      <BaseModal onClose={onClose} closeOnOverlayClick={true}>
        <div>Content</div>
      </BaseModal>
    );

    const overlay = screen.getByRole('dialog');
    overlay.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should not call onClose when modal content is clicked', () => {
    const onClose = vi.fn();
    render(
      <BaseModal onClose={onClose}>
        <div data-testid="content">Content</div>
      </BaseModal>
    );

    const content = screen.getByTestId('content');
    content.click();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should apply custom className', () => {
    render(
      <BaseModal onClose={() => {}} className="custom-class">
        <div>Content</div>
      </BaseModal>
    );

    const modalContent = screen.getByText('Content').parentElement;
    expect(modalContent).toHaveClass('custom-class');
  });

  it('should work without onClose', () => {
    render(
      <BaseModal>
        <div>Content</div>
      </BaseModal>
    );

    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('should support aria-labelledby', () => {
    render(
      <BaseModal onClose={() => {}} aria-labelledby="modal-title">
        <h2 id="modal-title">Modal Title</h2>
      </BaseModal>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
  });
});

