import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatientPhotos, useUploadPatientPhoto, useDeletePatientPhoto } from '../hooks/usePatientPhotos';
import { PatientPhoto } from '../types/medicalRecord';
import { logger } from '../utils/logger';
import { PhotoLightbox } from './PhotoLightbox';
import { PhotoEditModal } from './PhotoEditModal';

// Simple SVG Icons
const UploadIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
  </svg>
);

const EyeIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const EditIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

interface PatientPhotoGalleryProps {
  clinicId: number | null;
  patientId: number;
  unlinkedOnly?: boolean;
}

interface UploadError {
  fileName: string;
  error: string;
}

export const PatientPhotoGallery: React.FC<PatientPhotoGalleryProps> = ({
  clinicId,
  patientId,
  unlinkedOnly = false,
}) => {
  const { t } = useTranslation();
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<PatientPhoto | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadErrors, setUploadErrors] = useState<UploadError[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const { data: photos = [], isLoading, error } = usePatientPhotos(clinicId, patientId, { unlinked_only: unlinkedOnly });
  const uploadMutation = useUploadPatientPhoto(clinicId!, patientId);
  const deleteMutation = useDeletePatientPhoto(clinicId!, patientId);

  const validateAndUploadFile = async (file: File): Promise<void> => {
    const fileId = `${file.name}-${Date.now()}`;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      setUploadErrors(prev => [...prev, { fileName: file.name, error: t('檔案類型不支援') }]);
      return;
    }

    // Validate file size (20MB client limit)
    if (file.size > 20 * 1024 * 1024) {
      setUploadErrors(prev => [...prev, { fileName: file.name, error: t('檔案大小超過 20MB') }]);
      return;
    }

    try {
      await uploadMutation.mutateAsync({
        file,
        is_pending: false, // Gallery uploads are active immediately
        onUploadProgress: (progressEvent: any) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(prev => ({ ...prev, [fileId]: percentCompleted }));
        },
      });
      
      // Clear progress after successful upload
      setUploadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[fileId];
        return newProgress;
      });
    } catch (error) {
      logger.error('Failed to upload photo:', error);
      setUploadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[fileId];
        return newProgress;
      });
      setUploadErrors(prev => [...prev, { fileName: file.name, error: t('上傳失敗') }]);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Clear previous errors
    setUploadErrors([]);

    // Upload files in parallel
    await Promise.all(Array.from(files).map(file => validateAndUploadFile(file)));

    // Reset input
    event.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the drop zone entirely
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    // Clear previous errors
    setUploadErrors([]);

    // Upload files in parallel
    await Promise.all(Array.from(files).map(file => validateAndUploadFile(file)));
  };

  const handleDelete = async (photoId: number) => {
    if (!confirm(t('確定要刪除此照片嗎？'))) return;
    
    try {
      await deleteMutation.mutateAsync(photoId);
    } catch (error) {
      logger.error('Failed to delete photo:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-600 text-center py-4">
        {t('載入照片失敗')}
      </div>
    );
  }

  const hasUploadingFiles = Object.keys(uploadProgress).length > 0;

  return (
    <div className="space-y-4">
      {/* Upload Button */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">{t('照片收藏')}</h3>
        <label className="cursor-pointer inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          <UploadIcon />
          <span className="ml-2">{t('上傳照片')}</span>
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

      {/* Drag and Drop Zone */}
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${isDragging 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-gray-300 hover:border-gray-400'
          }
        `}
      >
        <div className="flex flex-col items-center justify-center space-y-2">
          <div className="w-12 h-12 text-gray-400">
            <UploadIcon />
          </div>
          <p className="text-gray-600">
            {isDragging ? t('放開以上傳照片') : t('拖曳照片到此處，或點擊上方按鈕上傳')}
          </p>
          <p className="text-sm text-gray-500">
            {t('支援 JPG、PNG、HEIC 格式，單檔最大 20MB')}
          </p>
        </div>
      </div>

      {/* Upload Errors */}
      {uploadErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-red-800 mb-2">{t('上傳失敗的檔案')}:</h4>
          <ul className="space-y-1">
            {uploadErrors.map((error, index) => (
              <li key={index} className="text-sm text-red-700">
                <span className="font-medium">{error.fileName}</span>: {error.error}
              </li>
            ))}
          </ul>
          <button
            onClick={() => setUploadErrors([])}
            className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
          >
            {t('清除錯誤訊息')}
          </button>
        </div>
      )}

      {/* Upload Progress */}
      {hasUploadingFiles && (
        <div className="space-y-2">
          {Object.entries(uploadProgress).map(([fileId, progress]) => (
            <div key={fileId} className="bg-gray-50 rounded-lg p-3">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">{t('上傳中...')}</span>
                <span className="text-gray-900 font-medium">{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Photo Grid */}
      {photos.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <div className="w-12 h-12 mx-auto mb-3 opacity-50">
            <UploadIcon />
          </div>
          <p>{t('尚無照片')}</p>
          <p className="text-sm mt-1">{t('點擊上方按鈕上傳照片')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photos.map((photo, index) => (
            <div
              key={photo.id}
              className="relative group aspect-square bg-gray-100 rounded-lg overflow-hidden cursor-pointer"
              onClick={() => setSelectedPhotoIndex(index)}
            >
              <img
                src={photo.thumbnail_url || photo.url}
                alt={photo.description || photo.filename}
                className="w-full h-full object-cover"
              />
              
              {/* Hover Overlay */}
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all duration-200 flex items-center justify-center">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex space-x-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPhotoIndex(index);
                    }}
                    className="p-2 bg-white rounded-full hover:bg-gray-100 transition-colors"
                    title={t('檢視')}
                  >
                    <EyeIcon />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingPhoto(photo);
                    }}
                    className="p-2 bg-white rounded-full hover:bg-gray-100 transition-colors"
                    title={t('編輯')}
                  >
                    <EditIcon />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(photo.id);
                    }}
                    className="p-2 bg-white rounded-full hover:bg-red-50 transition-colors"
                    title={t('刪除')}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              {/* Description Badge */}
              {photo.description && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-2">
                  <p className="text-white text-xs truncate">{photo.description}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {selectedPhotoIndex !== null && (
        <PhotoLightbox
          photos={photos}
          initialIndex={selectedPhotoIndex}
          onClose={() => setSelectedPhotoIndex(null)}
        />
      )}

      {/* Edit Modal */}
      {editingPhoto && (
        <PhotoEditModal
          clinicId={clinicId}
          patientId={patientId}
          photo={editingPhoto}
          onClose={() => setEditingPhoto(null)}
        />
      )}
    </div>
  );
};
