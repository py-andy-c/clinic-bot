import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePatientPhotos, useUploadPatientPhoto } from '../hooks/usePatientPhotos';
import { LoadingSpinner } from './shared';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { logger } from '../utils/logger';

// Simple SVG Icon
const UploadIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
  </svg>
);

interface RecentPhotosRibbonProps {
  clinicId: number | null;
  patientId: number;
  triggerUpload?: boolean;
  onUploadComplete?: () => void;
  hideUploadButton?: boolean;
}

export const RecentPhotosRibbon: React.FC<RecentPhotosRibbonProps> = ({
  clinicId,
  patientId,
  triggerUpload = false,
  onUploadComplete,
  hideUploadButton = false,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload state
  const [showAnnotationModal, setShowAnnotationModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [photoDescription, setPhotoDescription] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Fetch last 6 photos (all photos, not just unlinked)
  const { data: photosResponse, isLoading } = usePatientPhotos(clinicId, patientId, {
    limit: 6,
    skip: 0,
  });

  const uploadMutation = useUploadPatientPhoto(clinicId!, patientId);

  const photos = photosResponse?.items || [];
  const totalPhotos = photosResponse?.total || 0;

  // Handle external trigger for upload
  useEffect(() => {
    if (triggerUpload && fileInputRef.current) {
      fileInputRef.current.click();
      if (onUploadComplete) {
        onUploadComplete();
      }
    }
  }, [triggerUpload, onUploadComplete]);

  // Cleanup object URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (pendingPreview) {
        URL.revokeObjectURL(pendingPreview);
      }
    };
  }, [pendingPreview]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Only allow single file upload
    const file = files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setUploadError(t('檔案類型不支援'));
      event.target.value = '';
      return;
    }

    // Validate file size (20MB)
    if (file.size > 20 * 1024 * 1024) {
      setUploadError(t('檔案大小超過 20MB'));
      event.target.value = '';
      return;
    }

    // Generate preview using createObjectURL
    const previewUrl = URL.createObjectURL(file);
    setPendingPreview(previewUrl);

    // Set pending file and show annotation modal
    setPendingFile(file);
    setPhotoDescription(''); // Leave empty
    setShowAnnotationModal(true);
    setUploadError(null);

    // Reset input
    event.target.value = '';
  };

  const handleConfirmUpload = async () => {
    if (!pendingFile) return;

    try {
      setUploadProgress(0);
      
      await uploadMutation.mutateAsync({
        file: pendingFile,
        description: photoDescription,
        is_pending: false, // Active immediately
        onUploadProgress: (progressEvent: any) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      });

      // Clean up object URL to free memory
      if (pendingPreview) {
        URL.revokeObjectURL(pendingPreview);
      }

      // Reset state
      setShowAnnotationModal(false);
      setPendingFile(null);
      setPendingPreview(null);
      setPhotoDescription('');
      setUploadProgress(null);
    } catch (error) {
      logger.error('Failed to upload photo:', error);
      setUploadError(t('上傳失敗'));
      setUploadProgress(null);
    }
  };

  const handleCancelUpload = () => {
    // Clean up object URL to free memory
    if (pendingPreview) {
      URL.revokeObjectURL(pendingPreview);
    }
    
    setShowAnnotationModal(false);
    setPendingFile(null);
    setPendingPreview(null);
    setPhotoDescription('');
    setUploadProgress(null);
    setUploadError(null);
  };

  if (isLoading) {
    return (
      <div className="bg-white -mx-4 sm:mx-0 sm:rounded-lg shadow-none sm:shadow-md border-b sm:border-none border-gray-200 p-4 sm:p-6 mb-0 sm:mb-6">
        <div className="flex justify-center py-4">
          <LoadingSpinner size="md" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white -mx-4 sm:mx-0 sm:rounded-lg shadow-none sm:shadow-md border-b sm:border-none border-gray-200 p-4 sm:p-6 mb-0 sm:mb-6">
        {!hideUploadButton && (
          <div className="flex justify-end items-center mb-4">
            <div className="flex items-center gap-3">
              <label className="cursor-pointer inline-flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                <UploadIcon />
                <span className="ml-1.5">{t('上傳照片')}</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={uploadMutation.isPending}
                />
              </label>
              {totalPhotos > 0 && (
                <button
                  onClick={() => navigate(`/admin/clinic/patients/${patientId}/gallery`)}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
                >
                  {t('查看全部')} ({totalPhotos})
                </button>
              )}
            </div>
          </div>
        )}

        {/* Hidden file input for external trigger */}
        {hideUploadButton && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
            disabled={uploadMutation.isPending}
          />
        )}

        {totalPhotos === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">{t('尚無照片')}</p>
            <p className="text-xs mt-1">{t('點擊上方按鈕上傳照片')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {photos.map((photo) => (
              <div
                key={photo.id}
                className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
                onClick={() => navigate(`/admin/clinic/patients/${patientId}/gallery`)}
              >
                <img
                  src={photo.thumbnail_url || photo.url}
                  alt={photo.description || photo.filename}
                  className="w-full h-full object-cover"
                />
                {photo.description && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-2">
                    <p className="text-white text-xs truncate">{photo.description}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Annotation Modal */}
      {showAnnotationModal && (
        <BaseModal onClose={handleCancelUpload}>
          <ModalHeader title={t('照片標註')} onClose={handleCancelUpload} showClose />
          <ModalBody>
            <div className="space-y-4">
              {/* Preview */}
              {pendingPreview && (
                <div className="aspect-video rounded-lg overflow-hidden border border-gray-200">
                  <img
                    src={pendingPreview}
                    alt="Preview"
                    className="w-full h-full object-contain bg-gray-50"
                  />
                </div>
              )}

              {/* Description Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('照片說明')}
                </label>
                <input
                  type="text"
                  value={photoDescription}
                  onChange={(e) => setPhotoDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && uploadProgress === null) {
                      e.preventDefault();
                      handleConfirmUpload();
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('輸入照片說明...')}
                  autoFocus
                />
              </div>

              {/* Upload Progress */}
              {uploadProgress !== null && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">{t('上傳中...')}</span>
                    <span className="text-gray-900 font-medium">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Upload Error */}
              {uploadError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-800">{uploadError}</p>
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <button
              type="button"
              onClick={handleCancelUpload}
              disabled={uploadProgress !== null}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('取消')}
            </button>
            <button
              type="button"
              onClick={handleConfirmUpload}
              disabled={uploadProgress !== null}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('確認上傳')}
            </button>
          </ModalFooter>
        </BaseModal>
      )}
    </>
  );
};
