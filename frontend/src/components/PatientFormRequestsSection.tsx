import React, { useState } from 'react';
import { usePatientFormRequests, useCreatePatientFormRequest } from '../hooks/usePatientForms';
import { useMedicalRecordTemplates } from '../hooks/useMedicalRecordTemplates';
import { usePatientAppointments } from '../hooks/queries/usePatientAppointments';
import { LoadingSpinner } from './shared/LoadingSpinner';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { useModal } from '../contexts/ModalContext';
import { getErrorMessage } from '../types/api';
import { logger } from '../utils/logger';
import { Link } from 'react-router-dom';
import { DEFAULT_PATIENT_FORM_MESSAGE } from '../constants/messageTemplates';

interface PatientFormRequestsSectionProps {
  patientId: number;
  clinicId: number | null;
  patient?: any;
}

export const PatientFormRequestsSection: React.FC<PatientFormRequestsSectionProps> = ({
  patientId,
  clinicId,
  patient,
}) => {
  const { data: requests, isLoading } = usePatientFormRequests(clinicId, patientId);
  const { data: templates } = useMedicalRecordTemplates(clinicId, 'patient_form');
  const { data: appointmentsData } = usePatientAppointments(patientId);
  const createMutation = useCreatePatientFormRequest(clinicId, patientId);
  const { alert, confirm } = useModal();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    template_id: 0,
    appointment_id: null as number | null,
    message_template: DEFAULT_PATIENT_FORM_MESSAGE,
    flex_button_text: '填寫表單',
    notify_admin: false,
    notify_appointment_practitioner: true,
    notify_assigned_practitioner: false,
  });
  const [messageError, setMessageError] = useState<string | null>(null);

  const getDaysAgo = (dateString: string): number => {
    const sentDate = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - sentDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  const handleOpenModal = async () => {
    if (!patient?.line_user_id) {
      await alert('此病患尚未綁定 LINE 帳號，無法發送表單。', '無法發送');
      return;
    }
    setIsModalOpen(true);
    setMessageError(null);
  };

  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setFormData({ ...formData, message_template: value });
    if (!value.includes('{表單連結}')) {
      setMessageError('訊息內容必須包含 {表單連結} 變數');
    } else {
      setMessageError(null);
    }
  };

  const handleSend = async () => {
    if (!formData.template_id) {
      await alert('請選擇表單模板');
      return;
    }
    if (!formData.message_template.includes('{表單連結}')) {
      await alert('訊息內容必須包含 {表單連結} 變數');
      return;
    }
    try {
      await createMutation.mutateAsync(formData);
      setIsModalOpen(false);
      await alert('表單已發送');
    } catch (error) {
      logger.error('Failed to send patient form:', error);
      await alert(getErrorMessage(error), '發送失敗');
    }
  };

  const handleResend = async (req: import('../types/medicalRecord').PatientFormRequest) => {
    const confirmed = await confirm(`確定要重新發送「${req.template_name}」給病患嗎？`);
    if (!confirmed) return;

    try {
      await createMutation.mutateAsync({
        template_id: req.template_id,
        appointment_id: req.appointment_id || null,
        message_template: DEFAULT_PATIENT_FORM_MESSAGE,
        notify_admin: req.notify_admin,
        notify_appointment_practitioner: req.notify_appointment_practitioner,
        notify_assigned_practitioner: req.notify_assigned_practitioner,
      });
      await alert('表單已重新發送');
    } catch (error) {
      logger.error('Failed to resend patient form:', error);
      await alert(getErrorMessage(error), '發送失敗');
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
        <h3 className="text-lg font-semibold text-gray-900">患者表單</h3>
        <button
          onClick={handleOpenModal}
          className="btn btn-primary text-sm px-3 py-1.5"
        >
          + 發送表單
        </button>
      </div>

      <div className="divide-y divide-gray-200">
        {!requests || requests.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">尚無表單記錄</div>
        ) : (
          requests.map((req) => (
            <div key={req.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-900">{req.template_name || '載入中...'}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    發送於 {new Date(req.sent_at).toLocaleString('zh-TW')}
                    {req.status === 'pending' && (
                      <span 
                        className={`ml-2 font-medium ${getDaysAgo(req.sent_at) >= 7 ? 'text-red-600' : 'text-amber-600'}`}
                        title={getDaysAgo(req.sent_at) >= 7 ? '此表單已發送超過 7 天' : ''}
                      >
                        ({getDaysAgo(req.sent_at)} 天前)
                      </span>
                    )}
                    {req.submitted_at && ` • 提交於 ${new Date(req.submitted_at).toLocaleString('zh-TW')}`}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {req.status === 'pending' && (
                    <button
                      onClick={() => handleResend(req)}
                      disabled={createMutation.isPending}
                      className="text-sm text-primary-600 hover:underline disabled:opacity-50"
                    >
                      重新發送
                    </button>
                  )}
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    req.status === 'submitted' ? 'bg-green-100 text-green-700' :
                    req.status === 'skipped' ? 'bg-gray-100 text-gray-600' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {req.status === 'submitted' ? '已提交' : req.status === 'skipped' ? '已跳過' : '待填寫'}
                  </span>
                  {req.medical_record_id && (
                    <Link
                      to={`/admin/clinic/patients/${patientId}/records/${req.medical_record_id}`}
                      className="text-sm text-primary-600 hover:underline"
                    >
                      查看病歷
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {isModalOpen && (
        <BaseModal onClose={() => setIsModalOpen(false)} className="max-w-lg">
          <ModalHeader title="發送患者表單" showClose onClose={() => setIsModalOpen(false)} />
          <ModalBody className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">選擇模板 *</label>
              <select
                value={formData.template_id}
                onChange={e => setFormData({ ...formData, template_id: Number(e.target.value) })}
                className="w-full border-gray-300 rounded-lg text-sm"
              >
                <option value={0}>請選擇...</option>
                {templates?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">關聯預約 (選填)</label>
              <select
                value={formData.appointment_id || ''}
                onChange={e => setFormData({ ...formData, appointment_id: e.target.value ? Number(e.target.value) : null })}
                className="w-full border-gray-300 rounded-lg text-sm"
              >
                <option value="">不關聯預約</option>
                {appointmentsData?.appointments.map(a => (
                  <option key={a.id} value={a.id}>
                    {new Date(a.start_time).toLocaleDateString('zh-TW')} {a.appointment_type_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">訊息內容</label>
              <textarea
                value={formData.message_template}
                onChange={handleMessageChange}
                rows={4}
                className={`w-full border-gray-300 rounded-lg text-sm ${messageError ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''}`}
              />
              {messageError && <p className="text-red-500 text-xs mt-1">{messageError}</p>}
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">通知對象</label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={formData.notify_admin} onChange={e => setFormData({ ...formData, notify_admin: e.target.checked })} />
                  管理員
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={formData.notify_appointment_practitioner} onChange={e => setFormData({ ...formData, notify_appointment_practitioner: e.target.checked })} />
                  預約治療師
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={formData.notify_assigned_practitioner} onChange={e => setFormData({ ...formData, notify_assigned_practitioner: e.target.checked })} />
                  病患主責治療師
                </label>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <button onClick={() => setIsModalOpen(false)} className="btn-secondary">取消</button>
            <button onClick={handleSend} disabled={createMutation.isPending || !!messageError} className="btn-primary">
              {createMutation.isPending ? '發送中...' : '確認發送'}
            </button>
          </ModalFooter>
        </BaseModal>
      )}
    </section>
  );
};
