import React, { useState, useMemo } from 'react';
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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showAnnotationModal, setShowAnnotationModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [photoDescription, setPhotoDescription] = useState<string>('');
  
  // Track locally uploaded photos (for new records where photos aren't yet visible from server)
  const [localPhotos, setLocalPhotos] = useState<PatientPhoto[]>([]);

  // Fetch photos already linked to this record (for edit mode)
  const { data: linkedPhotosResponse } = usePatientPhotos(
    clinicId,
    patientId,
    recordId ? { medical_record_id: recordId } : undefined
  );

  // Fetch unlinked photos (for new records - these are staged photos)
  const { data: unlinkedPhotosResponse } = usePatientPhotos(
    clinicId,
    patientId,
    { unlinked_only: true }
  );

  const uploadMutation = useUploadPatientPhoto(clinicId!, patientId);

  const linkedPhotos = linkedPhotosResponse?.items || [];
  const unlinkedPhotos = unlinkedPhotosResponse?.items || [];

  // Merge and deduplicate photos: server photos + local photos, filtered by selectedPhotoIds
  const visiblePhotos = useMemo(() => {
    // Combine all sources
    const allPhotos = [...linkedPhotos, ...unlinkedPhotos, ...localPhotos];
    
    // Deduplicate by ID
    const uniquePhotos = Array.from(new Map(allPhotos.map(p => [p.id, p])).values());
    
    // Filter by selectedPhotoIds to handle removals
    const filtered = uniquePhotos.filter(p => selectedPhotoIds.includes(p.id));
    
    return filtered;
  }, [linkedPhotos, unlinkedPhotos, localPhotos, selectedPhotoIds]);

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

    // Generate preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPendingPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Set pending file and show annotation modal
    setPendingFile(file);
    
    // Auto-suggest description: 附圖 X
    // Use visiblePhotos.length since it's already deduplicated and filtered
    const suggestedDescription = `附圖 ${visiblePhotos.length + 1}`;
    setPhotoDescription(suggestedDescription);
    
    setShowAnnotationModal(true);
    setUploadError(null);

    // Reset input
    event.target.value = '';
  };

  const handleConfirmUpload = async () => {
    if (!pendingFile) return;

    try {
      setUploadProgress(0);
      
      const uploadedPhoto = await uploadMutation.mutateAsync({
        file: pendingFile,
        description: photoDescription,
        is_pending: true, // Stage the photo
        ...(recordId && { medical_record_id: recordId }), // Link to record if exists
        onUploadProgress: (progressEvent: any) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      });

      // Add to local photos state (for immediate visibility)
      setLocalPhotos(prev => [...prev, uploadedPhoto]);

      // Add newly uploaded photo ID to selection
      onPhotoIdsChange([...selectedPhotoIds, uploadedPhoto.id]);

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
    setShowAnnotationModal(false);
    setPendingFile(null);
    setPendingPreview(null);
    setPhotoDescription('');
    setUploadProgress(null);
    setUploadError(null);
  };

  const removePhoto = (photoId: number) => {
    onPhotoIdsChange(selectedPhotoIds.filter(id => id !== photoId));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <label className="block text-sm font-medium text-gray-700">
          {t('附錄')} ({t('選填')})
        </label>
        <label className="cursor-pointer inline-flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          <UploadIcon />
          <span className="ml-1.5">{t('上傳照片')}</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
            disabled={uploadMutation.isPending}
          />
        </label>
      </div>

      {/* Upload Error */}
      {uploadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-800">{uploadError}</p>
        </div>
      )}

      {/* Photo Grid - Appendix Style */}
      {visiblePhotos.length === 0 ? (
        <div className="text-center py-6 text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-lg">
          <p>{t('尚無附錄照片')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {visiblePhotos.map((photo) => (
            <div
              key={photo.id}
              className="relative aspect-square rounded-lg overflow-hidden border border-gray-200"
            >
              <img
                src={photo.thumbnail_url || photo.url}
                alt={photo.description || photo.filename}
                className="w-full h-full object-cover"
              />

              {/* Description Label */}
              {photo.description && (
                <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 text-white text-xs px-2 py-1 truncate">
                  {photo.description}
                </div>
              )}

              {/* Remove Button */}
              <button
                onClick={() => removePhoto(photo.id)}
                className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors"
                title={t('移除')}
              >
                <XIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Annotation Modal */}
      {showAnnotationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">{t('照片標註')}</h3>

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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('例如：附圖 1')}
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

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleCancelUpload}
                disabled={uploadProgress !== null}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('取消')}
              </button>
              <button
                onClick={handleConfirmUpload}
                disabled={uploadProgress !== null}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('確認上傳')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
