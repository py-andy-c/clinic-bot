import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatientPhotos, useUploadPatientPhoto } from '../hooks/usePatientPhotos';
import { PatientPhoto } from '../types/medicalRecord';
import { logger } from '../utils/logger';

// Simple SVG Icons
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

interface MedicalRecordPhotoSelectorProps {
  clinicId: number | null;
  patientId: number;
  selectedPhotoIds: number[];
  onPhotoIdsChange: (photoIds: number[]) => void;
  recordId?: number | null; // For edit mode
}

export const MedicalRecordPhotoSelector: React.FC<MedicalRecordPhotoSelectorProps> = ({
  clinicId,
  patientId,
  selectedPhotoIds,
  onPhotoIdsChange,
  recordId,
}) => {
  const { t } = useTranslation();
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  // Fetch unlinked photos (photos not attached to any record)
  const { data: unlinkedPhotos = [] } = usePatientPhotos(clinicId, patientId, { unlinked_only: true });
  
  // Fetch photos already linked to this record (for edit mode)
  const { data: linkedPhotos = [] } = usePatientPhotos(
    clinicId, 
    patientId, 
    recordId ? { medical_record_id: recordId } : undefined
  );

  const uploadMutation = useUploadPatientPhoto(clinicId!, patientId);

  // Combine available photos: unlinked + already linked to this record
  const availablePhotos = recordId 
    ? [...unlinkedPhotos, ...linkedPhotos]
    : unlinkedPhotos;

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploadErrors([]);

    // Upload files with staging (is_pending=true)
    const uploadPromises = Array.from(files).map(async (file) => {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setUploadErrors(prev => [...prev, `${file.name}: ${t('檔案類型不支援')}`]);
        return null;
      }

      // Validate file size (20MB)
      if (file.size > 20 * 1024 * 1024) {
        setUploadErrors(prev => [...prev, `${file.name}: ${t('檔案大小超過 20MB')}`]);
        return null;
      }

      const fileId = `${file.name}-${Date.now()}`;

      try {
        const uploadedPhoto = await uploadMutation.mutateAsync({
          file,
          is_pending: true, // Stage the photo
          ...(recordId && { medical_record_id: recordId }), // Link to record if exists
          onUploadProgress: (progressEvent: any) => {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(prev => ({ ...prev, [fileId]: percentCompleted }));
          },
        });

        // Clear progress
        setUploadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[fileId];
          return newProgress;
        });

        return uploadedPhoto;
      } catch (error) {
        logger.error('Failed to upload photo:', error);
        setUploadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[fileId];
          return newProgress;
        });
        setUploadErrors(prev => [...prev, `${file.name}: ${t('上傳失敗')}`]);
        return null;
      }
    });

    const uploadedPhotos = (await Promise.all(uploadPromises)).filter(Boolean) as PatientPhoto[];
    
    // Add newly uploaded photo IDs to selection
    if (uploadedPhotos.length > 0) {
      const newPhotoIds = uploadedPhotos.map(p => p.id);
      onPhotoIdsChange([...selectedPhotoIds, ...newPhotoIds]);
    }

    // Reset input
    event.target.value = '';
  };

  const togglePhotoSelection = (photoId: number) => {
    if (selectedPhotoIds.includes(photoId)) {
      onPhotoIdsChange(selectedPhotoIds.filter(id => id !== photoId));
    } else {
      onPhotoIdsChange([...selectedPhotoIds, photoId]);
    }
  };

  const hasUploadingFiles = Object.keys(uploadProgress).length > 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <label className="block text-sm font-medium text-gray-700">
          {t('附加照片')} ({t('選填')})
        </label>
        <label className="cursor-pointer inline-flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          <UploadIcon />
          <span className="ml-1.5">{t('上傳新照片')}</span>
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
            disabled={uploadMutation.isPending}
          />
        </label>
      </div>

      {/* Upload Progress */}
      {hasUploadingFiles && (
        <div className="space-y-2">
          {Object.entries(uploadProgress).map(([fileId, progress]) => (
            <div key={fileId} className="bg-gray-50 rounded-lg p-2">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600">{t('上傳中...')}</span>
                <span className="text-gray-900 font-medium">{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Errors */}
      {uploadErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm font-medium text-red-800 mb-1">{t('上傳失敗')}:</p>
          <ul className="text-xs text-red-700 space-y-0.5">
            {uploadErrors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Photo Grid */}
      {availablePhotos.length === 0 ? (
        <div className="text-center py-6 text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-lg">
          <p>{t('尚無可選擇的照片')}</p>
          <p className="text-xs mt-1">{t('請上傳新照片或從照片收藏中選擇')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {availablePhotos.map((photo) => {
            const isSelected = selectedPhotoIds.includes(photo.id);
            return (
              <div
                key={photo.id}
                onClick={() => togglePhotoSelection(photo.id)}
                className={`
                  relative aspect-square rounded-lg overflow-hidden cursor-pointer
                  border-2 transition-all
                  ${isSelected 
                    ? 'border-blue-500 ring-2 ring-blue-200' 
                    : 'border-gray-200 hover:border-gray-300'
                  }
                `}
              >
                <img
                  src={photo.thumbnail_url || photo.url}
                  alt={photo.description || photo.filename}
                  className="w-full h-full object-cover"
                />
                
                {/* Selection Indicator */}
                {isSelected && (
                  <div className="absolute inset-0 bg-blue-500 bg-opacity-20 flex items-center justify-center">
                    <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                )}

                {/* Remove Button (for selected photos) */}
                {isSelected && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePhotoSelection(photo.id);
                    }}
                    className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors"
                    title={t('移除')}
                  >
                    <XIcon />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedPhotoIds.length > 0 && (
        <p className="text-sm text-gray-600">
          {t('已選擇')} {selectedPhotoIds.length} {t('張照片')}
        </p>
      )}
    </div>
  );
};
