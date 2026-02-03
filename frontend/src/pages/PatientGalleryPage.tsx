import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePatientPhotos, useDeletePatientPhoto, useUploadPatientPhoto } from '../hooks/usePatientPhotos';
import { usePatientDetail } from '../hooks/queries';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { BaseModal } from '../components/shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from '../components/shared/ModalParts';
import { PatientPhoto } from '../types/medicalRecord';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { PhotoEditModal } from '../components/PhotoEditModal';
import { logger } from '../utils/logger';
import { useModal } from '../contexts/ModalContext';

interface PhotosByDate {
  [date: string]: PatientPhoto[];
}

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

const LinkIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);

const PatientGalleryPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { confirm } = useModal();

  const patientId = id ? parseInt(id, 10) : undefined;
  const [selectedPhotoIndex, setSelectedPhotoIndex] = React.useState<number | null>(null);
  const [editingPhoto, setEditingPhoto] = React.useState<PatientPhoto | null>(null);
  
  // Upload state
  const [showAnnotationModal, setShowAnnotationModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [photoDescription, setPhotoDescription] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Fetch patient info for header
  const { data: patient, isLoading: loadingPatient } = usePatientDetail(patientId);

  // Fetch all photos (no limit, all photos including linked and unlinked)
  const { data: photosResponse, isLoading: loadingPhotos, error } = usePatientPhotos(
    activeClinicId ?? null,
    patientId ?? 0,
    { limit: 1000 } // Large limit to get all photos
  );

  const deleteMutation = useDeletePatientPhoto(activeClinicId!, patientId!);
  const uploadMutation = useUploadPatientPhoto(activeClinicId!, patientId!);

  const photos = photosResponse?.items || [];

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
    setPhotoDescription(''); // Leave empty for gallery context
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
        is_pending: false, // Gallery uploads are active immediately
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

  const handleDelete = async (photo: PatientPhoto) => {
    // Check if photo is linked to a medical record
    const isLinked = !!photo.medical_record_id;
    
    const message = isLinked
      ? '此照片已關聯至病歷記錄，刪除後將從病歷中移除。確定要刪除嗎？'
      : '確定要刪除此照片嗎？';
    
    const confirmed = await confirm(message, '刪除照片');
    if (!confirmed) return;

    try {
      await deleteMutation.mutateAsync(photo.id);
    } catch (error) {
      logger.error('Failed to delete photo:', error);
    }
  };

  // Group photos by upload date (YYYY-MM-DD)
  const photosByDate = useMemo(() => {
    const grouped: PhotosByDate = {};
    
    photos.forEach((photo) => {
      const date = new Date(photo.created_at).toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(photo);
    });
    
    return grouped;
  }, [photos]);

  // Get sorted dates (newest first)
  const sortedDates = useMemo(() => {
    return Object.keys(photosByDate).sort((a, b) => {
      const firstPhotoA = photosByDate[a]?.[0];
      const firstPhotoB = photosByDate[b]?.[0];
      
      if (!firstPhotoA || !firstPhotoB) return 0;
      
      const dateA = new Date(firstPhotoA.created_at).getTime();
      const dateB = new Date(firstPhotoB.created_at).getTime();
      return dateB - dateA; // Descending
    });
  }, [photosByDate]);

  if (loadingPatient || loadingPhotos) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <ErrorMessage
          message={t('無法載入照片')}
          onRetry={() => navigate(`/admin/clinic/patients/${patientId}`)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen py-6 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate(`/admin/clinic/patients/${patientId}`)}
            className="text-blue-600 hover:text-blue-800 font-medium transition-colors flex items-center gap-1 mb-4"
          >
            ← {t('返回病患詳情')}
          </button>
          
          <div className="bg-white -mx-4 sm:mx-0 sm:rounded-lg shadow-none sm:shadow-md border-b sm:border-none border-gray-200 p-4 sm:p-6">
            <div className="flex justify-between items-start mb-2">
              <h1 className="text-2xl font-bold text-gray-900">
                {patient.full_name} - {t('照片收藏')}
              </h1>
              <label className="cursor-pointer inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                <UploadIcon />
                <span className="ml-2">{t('上傳照片')}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={uploadMutation.isPending}
                />
              </label>
            </div>
            <p className="text-gray-600">
              {t('共')} {photos.length} {t('張照片')}
            </p>
          </div>
        </div>

        {/* Timeline View */}
        {photos.length === 0 ? (
          <div className="bg-white -mx-4 sm:mx-0 sm:rounded-lg shadow-none sm:shadow-md border-b sm:border-none border-gray-200 p-12 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-gray-600 text-lg">{t('尚無照片')}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {sortedDates.map((date) => {
              const photosForDate = photosByDate[date];
              if (!photosForDate) return null;
              
              return (
              <div key={date} className="bg-white -mx-4 sm:mx-0 sm:rounded-lg shadow-none sm:shadow-md border-b sm:border-none border-gray-200">
                {/* Date Header */}
                <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-gray-200">
                  <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                  <h2 className="text-lg font-semibold text-gray-900">{date}</h2>
                  <span className="text-sm text-gray-500">
                    ({photosForDate.length} {t('張')})
                  </span>
                </div>

                {/* Photos Grid - Edge-to-edge on mobile */}
                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-0.5 sm:gap-1 -mx-4 sm:mx-0">
                  {photosForDate.map((photo) => {
                    const photoIndex = photos.findIndex(p => p.id === photo.id);
                    
                    return (
                      <div
                        key={photo.id}
                        className="relative aspect-square bg-gray-100 overflow-hidden cursor-pointer group"
                      >
                        <img
                          src={photo.thumbnail_url || photo.url}
                          alt={photo.description || photo.filename}
                          className="w-full h-full object-cover"
                        />
                        
                        {/* Hover Overlay with Action Buttons */}
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all duration-200 flex items-center justify-center">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex space-x-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPhotoIndex(photoIndex);
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
                                handleDelete(photo);
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

                        {/* Medical Record Badge */}
                        {photo.medical_record_id && (
                          <div className="absolute top-1 right-1">
                            <div className="bg-blue-600 text-white p-1 rounded-full shadow-lg">
                              <LinkIcon />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
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
            clinicId={activeClinicId ?? null}
            patientId={patientId!}
            photo={editingPhoto}
            onClose={() => setEditingPhoto(null)}
          />
        )}

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
      </div>
    </div>
  );
};

export default PatientGalleryPage;
