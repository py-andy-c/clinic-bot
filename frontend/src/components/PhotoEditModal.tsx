import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { PatientPhoto, PatientPhotoUpdateRequest } from '../types/medicalRecord';
import { useUpdatePatientPhoto } from '../hooks/usePatientPhotos';
import { logger } from '../utils/logger';

interface PhotoEditModalProps {
  clinicId: number | null;
  patientId: number;
  photo: PatientPhoto;
  onClose: () => void;
}

export const PhotoEditModal: React.FC<PhotoEditModalProps> = ({
  clinicId,
  patientId,
  photo,
  onClose,
}) => {
  const { t } = useTranslation();
  const [description, setDescription] = useState(photo.description || '');
  const updateMutation = useUpdatePatientPhoto(clinicId, patientId);

  const handleSave = async () => {
    try {
      const updateData: PatientPhotoUpdateRequest = {};
      if (description.trim()) {
        updateData.description = description.trim();
      }
      
      await updateMutation.mutateAsync({
        photoId: photo.id,
        data: updateData,
      });
      onClose();
    } catch (error) {
      logger.error('Failed to update photo:', error);
    }
  };

  return (
    <BaseModal onClose={onClose}>
      <ModalHeader title={t('編輯照片')} onClose={onClose} showClose />
      
      <ModalBody>
        <div className="space-y-4">
          {/* Photo Preview */}
          <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden">
            <img
              src={photo.url}
              alt={photo.description || photo.filename}
              className="w-full h-full object-contain"
            />
          </div>

          {/* Description Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('照片說明')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              placeholder={t('輸入照片說明...')}
            />
          </div>

          {/* File Info */}
          <div className="text-sm text-gray-500 space-y-1">
            <p>{t('檔案名稱')}: {photo.filename}</p>
            <p>{t('檔案大小')}: {(photo.size_bytes / 1024 / 1024).toFixed(2)} MB</p>
            <p>{t('上傳時間')}: {new Date(photo.created_at).toLocaleString('zh-TW')}</p>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          disabled={updateMutation.isPending}
        >
          {t('取消')}
        </button>
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? t('儲存中...') : t('儲存')}
        </button>
      </ModalFooter>
    </BaseModal>
  );
};
