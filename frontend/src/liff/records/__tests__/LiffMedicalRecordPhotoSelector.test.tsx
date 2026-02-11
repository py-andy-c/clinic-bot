
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { LiffMedicalRecordPhotoSelector } from '../LiffMedicalRecordPhotoSelector';
import { useLiffUploadPatientPhoto, useLiffDeletePatientPhoto } from '../../hooks/medicalRecordHooks';
import React from 'react';

// Mock hooks
vi.mock('../../hooks/medicalRecordHooks', () => ({
    useLiffUploadPatientPhoto: vi.fn(),
    useLiffDeletePatientPhoto: vi.fn(),
}));

describe('LiffMedicalRecordPhotoSelector', () => {
    const mockOnPhotosChange = vi.fn();
    const defaultProps = {
        patientId: 1,
        recordId: 100,
        photos: [],
        onPhotosChange: mockOnPhotosChange,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useLiffUploadPatientPhoto as any).mockReturnValue({
            mutateAsync: vi.fn(),
            isPending: false,
        });
        (useLiffDeletePatientPhoto as any).mockReturnValue({
            mutateAsync: vi.fn(),
            isPending: false,
        });
    });

    it('renders upload button when no photos', () => {
        render(<LiffMedicalRecordPhotoSelector {...defaultProps} />);
        expect(screen.getByText('尚無照片')).toBeInTheDocument();
        expect(screen.getByText('上傳照片')).toBeInTheDocument();
    });

    it('renders existing photos', () => {
        const photos = [
            { id: 1, url: 'http://example.com/1.jpg', filename: '1.jpg' } as any,
            { id: 2, url: 'http://example.com/2.jpg', filename: '2.jpg' } as any,
        ];
        render(<LiffMedicalRecordPhotoSelector {...defaultProps} photos={photos} />);
        expect(screen.getAllByRole('img')).toHaveLength(2);
        expect(screen.queryByText('尚無照片')).not.toBeInTheDocument();
    });

    it('handles file upload', async () => {
        const mockUpload = vi.fn().mockResolvedValue({ id: 3, url: 'http://example.com/3.jpg' });
        (useLiffUploadPatientPhoto as any).mockReturnValue({
            mutateAsync: mockUpload,
            isPending: false,
        });

        const { container } = render(<LiffMedicalRecordPhotoSelector {...defaultProps} />);

        const file = new File(['(⌐□_□)'], 'chucknorris.png', { type: 'image/png' });
        // Use container query selector to find hidden file input
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;

        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => {
            expect(mockUpload).toHaveBeenCalledWith({
                file,
                medicalRecordId: 100,
            });
        });

        // Check if onPhotosChange was called with updater function
        // The component uses functional update: onPhotosChange((prev) => [...prev, id])
        // We can't easily check the result of functional update without rendering parent, 
        // but we can check it was called.
        expect(mockOnPhotosChange).toHaveBeenCalled();
    });

    it('handles photo deletion', async () => {
        const photos = [{ id: 1, url: 'url', filename: 'file' } as any];
        const mockDelete = vi.fn().mockResolvedValue({});

        (useLiffDeletePatientPhoto as any).mockReturnValue({
            mutateAsync: mockDelete,
            isPending: false,
        });

        render(<LiffMedicalRecordPhotoSelector {...defaultProps} photos={photos} />);

        const deleteButton = screen.getByLabelText('移除照片 file');
        fireEvent.click(deleteButton);

        await waitFor(() => {
            expect(mockDelete).toHaveBeenCalledWith(1);
        });

        expect(mockOnPhotosChange).toHaveBeenCalled();
    });
});
