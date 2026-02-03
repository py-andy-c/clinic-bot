import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePatientPhotos } from '../hooks/usePatientPhotos';
import { LoadingSpinner } from './shared';

interface RecentPhotosRibbonProps {
  clinicId: number | null;
  patientId: number;
}

export const RecentPhotosRibbon: React.FC<RecentPhotosRibbonProps> = ({
  clinicId,
  patientId,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Fetch last 6 photos (all photos, not just unlinked)
  const { data: photosResponse, isLoading } = usePatientPhotos(clinicId, patientId, {
    limit: 6,
    skip: 0,
  });

  const photos = photosResponse?.items || [];
  const totalPhotos = photosResponse?.total || 0;

  if (isLoading) {
    return (
      <div className="bg-white -mx-4 sm:mx-0 sm:rounded-lg shadow-none sm:shadow-md border-b sm:border-none border-gray-200 p-4 sm:p-6 mb-0 sm:mb-6">
        <div className="flex justify-center py-4">
          <LoadingSpinner size="md" />
        </div>
      </div>
    );
  }

  if (totalPhotos === 0) {
    return null; // Don't show the section if there are no photos
  }

  return (
    <div className="bg-white -mx-4 sm:mx-0 sm:rounded-lg shadow-none sm:shadow-md border-b sm:border-none border-gray-200 p-4 sm:p-6 mb-0 sm:mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900">{t('照片')}</h2>
        <button
          onClick={() => navigate(`/admin/clinic/patients/${patientId}/gallery`)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          {t('查看全部')} ({totalPhotos})
        </button>
      </div>

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
    </div>
  );
};
