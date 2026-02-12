import React, { useState } from 'react';
import { PatientPhotoResponse } from '../../services/liffApi';
import { useLiffUploadPatientPhoto, useLiffDeletePatientPhoto } from '../hooks/medicalRecordHooks';
import { logger } from '../../utils/logger';
import { LoadingSpinner } from '../../components/shared';

const UploadIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
);

const XIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

interface LiffMedicalRecordPhotoSelectorProps {
    patientId: number;
    recordId: number;
    photos: PatientPhotoResponse[];
    onPhotosChange: React.Dispatch<React.SetStateAction<number[]>>;
}

export const LiffMedicalRecordPhotoSelector: React.FC<LiffMedicalRecordPhotoSelectorProps> = ({
    patientId,
    recordId,
    photos,
    onPhotosChange,
}) => {
    const [uploadError, setUploadError] = useState<string | null>(null);
    const uploadMutation = useLiffUploadPatientPhoto(patientId);
    const deleteMutation = useLiffDeletePatientPhoto(patientId, recordId);

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            setUploadError('檔案類型不支援');
            return;
        }

        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        if (file.size > MAX_FILE_SIZE) {
            setUploadError('檔案大小不可超過 10MB');
            return;
        }

        try {
            const uploadedPhoto = await uploadMutation.mutateAsync({
                file,
                medicalRecordId: recordId,
            });

            // Add to selection using updater to avoid race conditions with stale props
            onPhotosChange((prev: number[]) => [...prev, uploadedPhoto.id]);
            setUploadError(null);
        } catch (error) {
            logger.error('Failed to upload photo:', error);
            setUploadError('上傳失敗');
        }

        event.target.value = '';
    };

    const removePhoto = async (photoId: number) => {
        try {
            await deleteMutation.mutateAsync(photoId);
            onPhotosChange((prev: number[]) => prev.filter(id => id !== photoId));
        } catch (error) {
            logger.error('Failed to delete photo:', error);
            setUploadError('刪除失敗');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <label className="block text-sm font-medium text-gray-700">
                    附圖 (選填)
                </label>
                <label
                    className={`inline-flex items-center px-4 py-2 text-sm bg-blue-600 text-white rounded-lg transition-all ${uploadMutation.isPending ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:bg-blue-700 cursor-pointer'}`}
                    aria-label="上傳照片"
                >
                    <UploadIcon />
                    <span className="ml-1.5">上傳照片</span>
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileSelect}
                        disabled={uploadMutation.isPending}
                        aria-hidden="true"
                    />
                </label>
            </div>

            {uploadError && (
                <p className="text-sm text-red-600 font-medium">{uploadError}</p>
            )}

            {(uploadMutation.isPending || deleteMutation.isPending) && (
                <div className="flex justify-center items-center py-2">
                    <LoadingSpinner size="sm" />
                    <span className="ml-2 text-xs text-gray-500">
                        {uploadMutation.isPending ? '正在上傳...' : '正在刪除...'}
                    </span>
                </div>
            )}

            {photos.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                    <div className="flex flex-col items-center">
                        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                            <UploadIcon />
                        </div>
                        <p>尚無照片</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-4">
                    {photos.map((photo) => (
                        <div key={photo.id} className="relative aspect-square rounded-2xl overflow-hidden shadow-sm border border-gray-100 bg-gray-50 group hover:shadow-md transition-all duration-300">
                            <img
                                src={photo.thumbnail_url || photo.url}
                                alt={photo.filename}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <button
                                type="button"
                                onClick={() => removePhoto(photo.id)}
                                className="absolute top-2 right-2 p-1.5 bg-white/90 text-red-500 rounded-full shadow-sm hover:bg-red-500 hover:text-white transition-all transform active:scale-90"
                                title="移除"
                                aria-label={`移除照片 ${photo.filename}`}
                                disabled={deleteMutation.isPending}
                            >
                                <XIcon />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
