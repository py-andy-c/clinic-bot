import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatientPhotos, useUploadPatientPhoto, useUpdatePatientPhoto } from '../hooks/usePatientPhotos';
import { useLiffUploadPatientPhoto, useLiffUpdatePatientPhoto } from '../liff/hooks/medicalRecordHooks';
import { PatientPhoto } from '../types/medicalRecord';
import { PatientPhotoResponse } from '../services/liffApi';
import { logger } from '../utils/logger';
import { useModal } from '../contexts/ModalContext';
import { PhotoLightbox } from './PhotoLightbox';
import { PhotoEditModal } from './PhotoEditModal';

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

const PencilIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </svg>
);

interface MedicalRecordPhotoSelectorProps {
  clinicId: number | null;
  patientId: number;
  selectedPhotoIds: number[];
  onPhotoIdsChange: (photoIds: number[]) => void;
  onPhotoUpdate?: (photoId: number, updates: Partial<PatientPhoto>) => void; // For description edits
  recordId?: number | null; // For edit mode
  variant?: 'clinic' | 'liff';
  initialPhotos?: PatientPhotoResponse[];
}

export const MedicalRecordPhotoSelector: React.FC<MedicalRecordPhotoSelectorProps> = ({
  clinicId,
  patientId,
  selectedPhotoIds,
  onPhotoIdsChange,
  onPhotoUpdate,
  recordId,
  variant = 'clinic',
  initialPhotos,
}) => {
  const { t } = useTranslation();
  const { confirm } = useModal();
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showAnnotationModal, setShowAnnotationModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [photoDescription, setPhotoDescription] = useState<string>('');

  // Track locally uploaded photos (for new records where photos aren't yet visible from server)
  const [localPhotos, setLocalPhotos] = useState<PatientPhoto[]>([]);

  // Track description overrides (for edited descriptions that haven't been saved yet)
  const [descriptionOverrides, setDescriptionOverrides] = useState<Record<number, string>>({});

  // Track which photos have loaded their full-resolution version
  const [loadedFullImages, setLoadedFullImages] = useState<Set<number>>(new Set());

  // Track which photo is being edited via modal
  const [editingPhoto, setEditingPhoto] = useState<PatientPhoto | null>(null);

  // Track lightbox state
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);

  // Cleanup object URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (pendingPreview) {
        URL.revokeObjectURL(pendingPreview);
      }
    };
  }, [pendingPreview]);

  // Fetch photos already linked to this record (for edit mode)
  const { data: linkedPhotosResponseClinic } = usePatientPhotos(
    variant === 'clinic' ? clinicId : null,
    patientId,
    recordId ? { medical_record_id: recordId } : undefined
  );

  // Fetch unlinked photos (for new records - these are staged photos)
  const { data: unlinkedPhotosResponseClinic } = usePatientPhotos(
    variant === 'clinic' ? clinicId : null,
    patientId,
    { unlinked_only: true }
  );

  const linkedPhotos = useMemo(() => {
    if (variant === 'liff') {
      return (initialPhotos || []).map(p => ({
        ...p,
        patient_id: patientId,
        clinic_id: 0,
        is_pending: false,
        url: p.url || '',
        thumbnail_url: p.thumbnail_url || '',
        description: p.description || '',
      }));
    }
    return linkedPhotosResponseClinic?.items || [];
  }, [variant, initialPhotos, linkedPhotosResponseClinic, patientId]);

  const uploadMutationClinic = useUploadPatientPhoto(clinicId!, patientId);
  const uploadMutationLiff = useLiffUploadPatientPhoto(patientId);
  const uploadMutation = variant === 'liff' ? uploadMutationLiff : uploadMutationClinic;

  const updateMutationClinic = useUpdatePatientPhoto(clinicId!, patientId);
  const updateMutationLiff = useLiffUpdatePatientPhoto(patientId, recordId || undefined);
  const updateMutation = variant === 'liff' ? updateMutationLiff : updateMutationClinic;

  const unlinkedPhotos = variant === 'liff' ? [] : (unlinkedPhotosResponseClinic?.items || []);

  // Merge and deduplicate photos: server photos + local photos, filtered by selectedPhotoIds
  const visiblePhotos = useMemo(() => {
    // Combine all sources
    const allPhotos = [...linkedPhotos, ...unlinkedPhotos, ...localPhotos];

    // Deduplicate by ID
    const uniquePhotos = Array.from(new Map(allPhotos.map(p => [p.id, p])).values());

    // Apply description overrides
    const photosWithOverrides = uniquePhotos.map(p => {
      const overrideDescription = descriptionOverrides[p.id];
      return {
        ...p,
        ...(overrideDescription !== undefined && { description: overrideDescription })
      };
    });

    // Filter by selectedPhotoIds to handle removals
    const filtered = photosWithOverrides.filter(p => selectedPhotoIds.includes(p.id));

    // Sort by created_at DESC to match backend ordering (newest first)
    const sorted = filtered.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      if (dateB !== dateA) return dateB - dateA; // Descending by date
      return b.id - a.id; // Descending by ID as tiebreaker
    });

    return sorted;
  }, [linkedPhotos, unlinkedPhotos, localPhotos, selectedPhotoIds, descriptionOverrides]);

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

    // Generate preview using createObjectURL (more memory-efficient than Base64)
    const previewUrl = URL.createObjectURL(file);
    setPendingPreview(previewUrl);

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

      const uploadParams: any = {
        file: pendingFile,
        description: photoDescription,
        ...(variant === 'clinic' && { is_pending: true }),
        ...(recordId && { 
          [variant === 'liff' ? 'medicalRecordId' : 'medical_record_id']: recordId 
        }),
      };

      // Progress only supported in clinic variant for now
      if (variant === 'clinic') {
        uploadParams.onUploadProgress = (progressEvent: any) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        };
      }

      const uploadedPhoto = await uploadMutation.mutateAsync(uploadParams);

      // Normalize the response to PatientPhoto type
      const normalizedPhoto: PatientPhoto = {
        id: uploadedPhoto.id,
        filename: uploadedPhoto.filename,
        content_type: uploadedPhoto.content_type || 'image/jpeg',
        size_bytes: uploadedPhoto.size_bytes || 0,
        created_at: uploadedPhoto.created_at || new Date().toISOString(),
        url: uploadedPhoto.url || '',
        thumbnail_url: uploadedPhoto.thumbnail_url || '',
        description: (uploadedPhoto as any).description || photoDescription,
        patient_id: patientId,
        clinic_id: clinicId || 0,
        is_pending: variant === 'clinic',
      };

      // Add to local photos state (for immediate visibility)
      setLocalPhotos(prev => [...prev, normalizedPhoto]);

      // Add newly uploaded photo ID to selection
      onPhotoIdsChange([...selectedPhotoIds, normalizedPhoto.id]);

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

  const removePhoto = async (photoId: number) => {
    // Confirm before removing
    const confirmed = await confirm(t('確定要移除此照片嗎？'), t('移除照片'));
    if (confirmed) {
      // For LIFF, we might want to actually delete the photo from server if it's unlinked
      // but for now, we just remove it from the selection list like the clinic does.
      // The actual deletion is usually handled by a separate cleanup or explicit delete button.
      onPhotoIdsChange(selectedPhotoIds.filter(id => id !== photoId));
    }
  };

  const handlePhotoEdit = (photo: PatientPhoto) => {
    setEditingPhoto(photo);
  };

  const handlePhotoEditClose = () => {
    setEditingPhoto(null);
  };

  const handlePhotoEditSave = async (photoId: number, description: string) => {
    try {
      await updateMutation.mutateAsync({ photoId, data: { description } });

      // Store the description override locally (for immediate UI update)
      setDescriptionOverrides(prev => ({
        ...prev,
        [photoId]: description
      }));

      // Notify parent of the change (triggers unsaved changes detection)
      if (onPhotoUpdate) {
        onPhotoUpdate(photoId, { description });
      }

      setEditingPhoto(null);
    } catch (error) {
      logger.error('Failed to update photo description:', error);
      // Show error feedback to user (using alert as fallback if toast not available)
      alert(t('更新照片描述失敗，請稍後再試'));
    }
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

      {/* Photo List - Appendix Style (Vertical Layout, Two Columns on Desktop) */}
      {visiblePhotos.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-lg">
          <p>{t('尚無附錄照片')}</p>
          <p className="text-xs mt-2 text-gray-400">{t('點擊上方按鈕上傳照片')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {visiblePhotos.map((photo, index) => {
            // Determine which image to show (progressive loading)
            const showFullImage = loadedFullImages.has(photo.id);
            const imageSrc = showFullImage ? (photo.url || photo.thumbnail_url) : (photo.thumbnail_url || photo.url);

            return (
              <div
                key={photo.id}
                className="relative border border-gray-200 rounded-lg p-4 bg-white shadow-sm"
              >
                {/* Remove Button - Top Right */}
                <button
                  type="button"
                  onClick={() => removePhoto(photo.id)}
                  className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                  title={t('移除')}
                >
                  <XIcon />
                </button>

                {/* Description Label with Edit Button */}
                <div className="mb-3 pr-8 flex items-center gap-2">
                  <span className="font-medium text-gray-900 text-base">
                    {photo.description || `附圖 ${index + 1}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handlePhotoEdit(photo)}
                    className="text-gray-400 hover:text-blue-600 transition-colors"
                    title={t('編輯說明')}
                  >
                    <PencilIcon />
                  </button>
                </div>

                {/* Image Container - Clickable for full-screen view */}
                <div
                  className="mb-3 flex justify-center cursor-pointer group/image bg-gray-50 rounded-lg overflow-hidden h-[300px] sm:h-[400px]"
                  onClick={() => setSelectedPhotoIndex(index)}
                  title={t('點擊查看大圖')}
                >
                  <img
                    src={imageSrc || ''}
                    alt={photo.description || photo.filename}
                    loading="lazy"
                    className="w-full h-full object-contain rounded border border-gray-100 group-hover/image:border-blue-300 transition-colors"
                    onLoad={() => {
                      // Progressive loading: after thumbnail loads, preload full image
                      if (!showFullImage && photo.thumbnail_url && photo.url && photo.url !== photo.thumbnail_url) {
                        const fullImg = new Image();
                        fullImg.src = photo.url;
                        fullImg.onload = () => {
                          setLoadedFullImages(prev => new Set(prev).add(photo.id));
                        };
                      }
                    }}
                    onError={(e) => {
                      // Fallback to thumbnail if full image fails to load
                      if (photo.thumbnail_url && e.currentTarget.src === photo.url) {
                        e.currentTarget.src = photo.thumbnail_url;
                      }
                    }}
                  />
                </div>
              </div>
            );
          })}
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
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
                type="button"
                onClick={handleCancelUpload}
                disabled={uploadProgress !== null}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('取消')}
              </button>
              <button
                type="button"
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

      {/* Photo Lightbox */}
      {selectedPhotoIndex !== null && (
        <PhotoLightbox
          photos={visiblePhotos}
          initialIndex={selectedPhotoIndex}
          onClose={() => setSelectedPhotoIndex(null)}
        />
      )}

      {/* Photo Edit Modal */}
      {editingPhoto && (
        <PhotoEditModal
          clinicId={clinicId}
          patientId={patientId}
          photo={editingPhoto}
          onClose={handlePhotoEditClose}
          onSave={handlePhotoEditSave}
        />
      )}
    </div>
  );
};
