import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePatientPhotos, useDeletePatientPhoto } from '../hooks/usePatientPhotos';
import { usePatientDetail } from '../hooks/queries';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { PatientPhoto } from '../types/medicalRecord';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { PhotoEditModal } from '../components/PhotoEditModal';
import { logger } from '../utils/logger';

interface PhotosByDate {
  [date: string]: PatientPhoto[];
}

// Simple SVG Icons
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

const PatientGalleryPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  const patientId = id ? parseInt(id, 10) : undefined;
  const [selectedPhotoIndex, setSelectedPhotoIndex] = React.useState<number | null>(null);
  const [editingPhoto, setEditingPhoto] = React.useState<PatientPhoto | null>(null);

  // Fetch patient info for header
  const { data: patient, isLoading: loadingPatient } = usePatientDetail(patientId);

  // Fetch all photos (no limit, all photos including linked and unlinked)
  const { data: photosResponse, isLoading: loadingPhotos, error } = usePatientPhotos(
    activeClinicId ?? null,
    patientId ?? 0,
    { limit: 1000 } // Large limit to get all photos
  );

  const deleteMutation = useDeletePatientPhoto(activeClinicId!, patientId!);

  const photos = photosResponse?.items || [];

  const handleDelete = async (photoId: number) => {
    if (!confirm(t('確定要刪除此照片嗎？'))) return;

    try {
      await deleteMutation.mutateAsync(photoId);
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
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate(`/admin/clinic/patients/${patientId}`)}
            className="text-blue-600 hover:text-blue-800 font-medium transition-colors flex items-center gap-1 mb-4"
          >
            ← {t('返回病患詳情')}
          </button>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {patient.full_name} - {t('照片收藏')}
            </h1>
            <p className="text-gray-600">
              {t('共')} {photos.length} {t('張照片')}
            </p>
          </div>
        </div>

        {/* Timeline View */}
        {photos.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
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
              <div key={date} className="bg-white rounded-lg shadow-md p-6">
                {/* Date Header */}
                <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-200">
                  <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                  <h2 className="text-lg font-semibold text-gray-900">{date}</h2>
                  <span className="text-sm text-gray-500">
                    ({photosForDate.length} {t('張')})
                  </span>
                </div>

                {/* Photos Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {photosForDate.map((photo) => {
                    const photoIndex = photos.findIndex(p => p.id === photo.id);
                    
                    return (
                      <div
                        key={photo.id}
                        className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all group"
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

                        {/* Medical Record Badge */}
                        {photo.medical_record_id && (
                          <div className="absolute top-2 right-2">
                            <div className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
                              {t('已連結')}
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
      </div>
    </div>
  );
};

export default PatientGalleryPage;
