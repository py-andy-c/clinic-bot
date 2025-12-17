import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProfileForm from '../ProfileForm';

// Mock InfoModal and InfoButton
vi.mock('../shared', () => ({
  InfoButton: ({ onClick, ariaLabel }: { onClick: () => void; ariaLabel?: string }) => (
    <button onClick={onClick} aria-label={ariaLabel}>ℹ️</button>
  ),
  InfoModal: ({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) => 
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
}));

describe('ProfileForm', () => {
  const mockProfile = {
    id: 1,
    email: 'test@example.com',
    full_name: 'Test User',
    title: '',
    roles: ['practitioner'],
    active_clinic_id: 1,
    created_at: new Date().toISOString(),
    last_login_at: null,
    settings: null,
    line_linked: false
  };

  const defaultProps = {
    profile: mockProfile,
    fullName: 'Test User',
    title: '',
    onFullNameChange: vi.fn(),
    onTitleChange: vi.fn(),
    showSaveButton: false,
    onSave: vi.fn(),
    saving: false
  };

  it('renders email field as read-only', () => {
    render(<ProfileForm {...defaultProps} />);
    
    const emailInput = screen.getByDisplayValue('test@example.com');
    expect(emailInput).toBeDisabled();
    expect(screen.getByText('無法修改')).toBeInTheDocument();
  });

  it('renders full name field as editable', () => {
    render(<ProfileForm {...defaultProps} />);
    
    const nameInput = screen.getByDisplayValue('Test User') as HTMLInputElement;
    expect(nameInput).not.toBeDisabled();
    
    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    expect(defaultProps.onFullNameChange).toHaveBeenCalledWith('New Name');
  });

  it('renders title field with info button', () => {
    render(<ProfileForm {...defaultProps} />);
    
    const titleInput = screen.getByPlaceholderText('例如：治療師、醫師、復健師') as HTMLInputElement;
    expect(titleInput).toBeInTheDocument();
    expect(titleInput.value).toBe('');
    
    // Check for info button
    const infoButton = screen.getByLabelText('查看稱謂說明');
    expect(infoButton).toBeInTheDocument();
  });

  it('allows editing title field', () => {
    render(<ProfileForm {...defaultProps} />);
    
    const titleInput = screen.getByPlaceholderText('例如：治療師、醫師、復健師') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: '治療師' } });
    
    expect(defaultProps.onTitleChange).toHaveBeenCalledWith('治療師');
  });

  it('shows info modal when info button is clicked', async () => {
    render(<ProfileForm {...defaultProps} />);
    
    const infoButton = screen.getByLabelText('查看稱謂說明');
    fireEvent.click(infoButton);
    
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '稱謂說明' })).toBeInTheDocument();
    });
    
    expect(screen.getByText('內部顯示：')).toBeInTheDocument();
    expect(screen.getByText('外部顯示：')).toBeInTheDocument();
  });

  it('displays existing title value', () => {
    render(<ProfileForm {...defaultProps} title="治療師" />);
    
    const titleInput = screen.getByDisplayValue('治療師') as HTMLInputElement;
    expect(titleInput.value).toBe('治療師');
  });

  it('shows save button when showSaveButton is true', () => {
    render(<ProfileForm {...defaultProps} showSaveButton={true} />);
    
    const saveButton = screen.getByText('儲存更變');
    expect(saveButton).toBeInTheDocument();
  });

  it('calls onSave when save button is clicked', () => {
    render(<ProfileForm {...defaultProps} showSaveButton={true} />);
    
    const saveButton = screen.getByText('儲存更變');
    fireEvent.click(saveButton);
    
    expect(defaultProps.onSave).toHaveBeenCalled();
  });

  it('disables save button when saving', () => {
    render(<ProfileForm {...defaultProps} showSaveButton={true} saving={true} />);
    
    const saveButton = screen.getByText('儲存中...');
    expect(saveButton).toBeDisabled();
  });

  it('does not render when profile is null', () => {
    const { container } = render(<ProfileForm {...defaultProps} profile={null} />);
    expect(container.firstChild).toBeNull();
  });
});

