import React, { useState, useEffect } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { useLiffPatientForm, useSubmitLiffPatientForm, useUpdateLiffPatientForm } from '../../hooks/usePatientForms';
import { LoadingSpinner } from '../../components/shared/LoadingSpinner';
import { MedicalRecordDynamicForm } from '../../components/MedicalRecordDynamicForm';
import { ErrorMessage } from '../components/StatusComponents';
import { liffApiService } from '../../services/liffApi';
import { useModal } from '../../contexts/ModalContext';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';

export const MAX_PATIENT_PHOTO_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_PATIENT_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

interface PatientFormPageProps {
  accessToken: string;
  onBack: () => void;
}

const PatientFormPage: React.FC<PatientFormPageProps> = ({ accessToken, onBack }) => {
  const { data, isLoading, error, refetch } = useLiffPatientForm(accessToken);
  const submitMutation = useSubmitLiffPatientForm(accessToken);
  const updateMutation = useUpdateLiffPatientForm(accessToken);
  const { alert, confirm } = useModal();
  const [isSuccess, setIsSuccess] = useState(false);
  const [photoIds, setPhotoIds] = useState<number[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [deletingPhotoIds, setDeletingPhotoIds] = useState<Set<number>>(new Set());

  const methods = useForm({
    defaultValues: {
      values: {},
    }
  });

  useEffect(() => {
    if (data?.values) {
      methods.reset({ values: data.values });
    }
    if (data?.medical_record?.photos) {
      setPhotoIds(data.medical_record.photos.map(p => p.id));
    }
  }, [data, methods]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation
    if (!ALLOWED_PATIENT_PHOTO_TYPES.includes(file.type)) {
      await alert('僅支援 JPG、PNG、GIF、WebP 格式', '格式錯誤');
      e.target.value = '';
      return;
    }

    if (file.size > MAX_PATIENT_PHOTO_SIZE) {
      await alert('檔案大小不可超過 10MB', '檔案過大');
      e.target.value = '';
      return;
    }

    // Total photos on the record (clinic + patient)
    // We count:
    // 1. Patient-uploaded photos already in the medical record (those with uploaded_by_patient_id)
    // 2. New photos uploaded in this session but not yet in the record (photoIds not in record)
    // 3. In-flight uploads (uploadingCount)
    // This correctly implements the mixed ownership model from the design doc:
    // "The patient's upload limit only applies to their own upload actions; photos already added by the clinic do not count"
    const patientPhotoCount = (data?.medical_record?.photos?.filter(p => 
      p.uploaded_by_patient_id !== null && p.uploaded_by_patient_id !== undefined
    ).length || 0) + photoIds.filter(id => 
      !data?.medical_record?.photos?.some(p => p.id === id)
    ).length + uploadingCount;

    if (patientPhotoCount >= (data?.template.max_photos || 0)) {
      await alert(`您已達照片上傳上限 ${data?.template.max_photos} 張`);
      return;
    }

    setUploadingCount(prev => prev + 1);
    setIsUploading(true);
    try {
      const photo = await liffApiService.uploadPatientFormPhoto(accessToken, file);
      setPhotoIds(prev => [...prev, photo.id]);
    } catch (error) {
      logger.error('Photo upload failed:', error);
      await alert(getErrorMessage(error), '上傳失敗');
    } finally {
      setUploadingCount(prev => prev - 1);
      setIsUploading(false);
      // Reset input value to allow uploading the same file again
      e.target.value = '';
    }
  };

  const handleRemovePhoto = async (id: number) => {
    setDeletingPhotoIds(prev => new Set(prev).add(id));
    try {
      await liffApiService.deletePatientFormPhoto(accessToken, id);
      setPhotoIds(prev => prev.filter(p => p !== id));
    } catch (error) {
      logger.error('Failed to delete photo:', error);
      await alert('刪除照片失敗，請稍後再試');
    } finally {
      setDeletingPhotoIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const onSubmit = async (formData: any) => {
    try {
      if (data?.request.status === 'submitted') {
        const confirmed = await confirm('確定要更新已提交的表單嗎？');
        if (!confirmed) return;
        await updateMutation.mutateAsync({
          values: formData.values,
          photo_ids: photoIds,
          version: data.medical_record?.version || 1
        });
      } else {
        await submitMutation.mutateAsync({
          values: formData.values,
          photo_ids: photoIds,
        });
      }
      setIsSuccess(true);
    } catch (error: any) {
      logger.error('Form submission failed:', error);
      
      // Handle version conflict (409)
      if (error?.response?.status === 409) {
        await alert(
          '抱歉，此表單已被更新。我們將重新載入最新版本。',
          '表單已更新'
        );
        refetch();
        return;
      }
      
      await alert(getErrorMessage(error), '提交失敗');
    }
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="無法載入表單" onRetry={refetch} />;
  if (!data) return null;

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">提交成功</h1>
        <p className="text-gray-600 mb-8">感謝您的填寫，資料已成功傳送至診所。</p>
        <button
          onClick={onBack}
          className="w-full py-3 bg-primary-600 text-white rounded-xl font-bold shadow-lg"
        >
          返回列表
        </button>
      </div>
    );
  }

  const isEdit = data.request.status === 'submitted';

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-white px-4 py-4 border-b sticky top-0 z-10 flex items-center">
        <button onClick={onBack} className="p-2 -ml-2 text-gray-600" aria-label="返回列表">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold flex-1 text-center mr-8">{data.template.name}</h1>
      </div>

      <div className="p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          {data.template.description && (
            <p className="text-sm text-gray-600 mb-8 bg-gray-50 p-4 rounded-xl border border-gray-100">
              {data.template.description}
            </p>
          )}

          <FormProvider {...methods}>
            <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-8">
              <MedicalRecordDynamicForm fields={data.template.fields} />

              {data.template.max_photos > 0 && (
                <div className="space-y-4 pt-6 border-t">
                  <h3 className="text-sm font-bold text-gray-900 flex items-center justify-between">
                    <span>照片上傳</span>
                    <span className="text-xs font-normal text-gray-500">{photoIds.length} / {data.template.max_photos}</span>
                  </h3>
                  
                  <div className="grid grid-cols-3 gap-3">
                    {photoIds.map((id, index) => {
                      const photo = data?.medical_record?.photos?.find(p => p.id === id);
                      return (
                        <div key={id} className="relative aspect-square bg-gray-100 rounded-xl overflow-hidden group">
                          <img 
                            src={`${import.meta.env.VITE_API_BASE_URL}/clinic/patient-photos/${id}/file`} 
                            alt={photo?.description || `上傳的照片 ${index + 1}`}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                          <button
                            type="button"
                            onClick={() => handleConfirmDeletePhoto(id)}
                            className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full disabled:opacity-50"
                            disabled={deletingPhotoIds.has(id)}
                            aria-label="刪除照片"
                          >
                            {deletingPhotoIds.has(id) ? (
                              <LoadingSpinner size="sm" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            )}
                          </button>
                        </div>
                      );
                    })}
                    
                    {photoIds.length < data.template.max_photos && (
                      <label 
                        className={`aspect-square border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 transition-colors ${
                          isUploading ? 'bg-gray-50 opacity-50 cursor-not-allowed' : 'active:bg-gray-50 active:border-primary-300 cursor-pointer'
                        }`}
                        aria-label="上傳照片"
                      >
                        {isUploading ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <>
                            <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            <span className="text-[10px]">上傳照片</span>
                          </>
                        )}
                        <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={isUploading} />
                      </label>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-6">
                <button
                  type="submit"
                  disabled={submitMutation.isPending || updateMutation.isPending}
                  className="w-full py-4 bg-primary-600 text-white rounded-2xl font-bold shadow-lg shadow-primary-200 disabled:opacity-50"
                >
                  {submitMutation.isPending || updateMutation.isPending ? '提交中...' : isEdit ? '更新表單' : '提交表單'}
                </button>
              </div>
            </form>
          </FormProvider>
        </div>
      </div>
    </div>
  );

  async function handleConfirmDeletePhoto(id: number) {
    const confirmed = await confirm('確定要刪除這張照片嗎？');
    if (confirmed) {
      handleRemovePhoto(id);
    }
  }
};

export default PatientFormPage;
