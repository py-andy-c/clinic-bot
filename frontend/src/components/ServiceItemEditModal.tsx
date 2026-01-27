import React, { useState, useEffect } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BaseModal } from './shared/BaseModal';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import { AppointmentType, Member, ServiceTypeGroup, ResourceRequirement } from '../types';
import { LoadingSpinner } from './shared';
import {
  ServiceItemBundleRequest,
  BillingScenarioBundleData,
  ResourceRequirementBundleData,
  FollowUpMessageBundleData
} from '../types';
import { zodResolver } from '@hookform/resolvers/zod';
import { ServiceItemBundleSchema, ServiceItemBundleFormData } from '../schemas/api';
import { useModal } from '../contexts/ModalContext';
import { useServiceItemBundle } from '../hooks/queries/useServiceItemBundle';
import {
  DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
  DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
  DEFAULT_REMINDER_MESSAGE
} from '../constants/messageTemplates';
import { MessageSettingsSection } from './MessageSettingsSection';
import { FollowUpMessagesSection } from './FollowUpMessagesSection';
import { ResourceRequirementsSection } from './ResourceRequirementsSection';
import { generateTemporaryId } from '../utils/idUtils';
import { useUnsavedChangesDetection } from '../hooks/useUnsavedChangesDetection';


interface ServiceItemEditModalProps {
  serviceItemId: number | null; // null for new
  isOpen: boolean;
  onClose: (refetch?: boolean) => void;
  members: Member[];
  isClinicAdmin: boolean;
  availableGroups: ServiceTypeGroup[];
  clinicInfoAvailability?: {
    has_address: boolean;
    has_phone: boolean;
  };
}



export const ServiceItemEditModal: React.FC<ServiceItemEditModalProps> = ({
  serviceItemId,
  isOpen,
  onClose,
  members,
  isClinicAdmin,
  availableGroups,
  clinicInfoAvailability,
}) => {
  const queryClient = useQueryClient();
  const { alert } = useModal();
  const { data: bundle, isLoading: loadingBundle } = useServiceItemBundle(serviceItemId || 0, isOpen && serviceItemId !== null);

  // Instance-level temp ID counter to avoid collisions across modals
  // Removed tempIdCounter ref in favor of shared utility generateTemporaryId


  // Removed localItem state to avoid dual-state anti-pattern


  // Associations are now managed by RHF
  // Removed localItem state to avoid dual-state anti-pattern

  const methods = useForm<ServiceItemBundleFormData>({
    resolver: zodResolver(ServiceItemBundleSchema),
    defaultValues: {
      name: '',
      duration_minutes: 30,
      allow_new_patient_booking: true,
      allow_existing_patient_booking: true,
      allow_patient_practitioner_selection: true,
      allow_multiple_time_slot_selection: false,
      scheduling_buffer_minutes: 0,
      send_patient_confirmation: true,
      send_clinic_confirmation: true,
      send_reminder: true,
      patient_confirmation_message: DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
      clinic_confirmation_message: DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
      reminder_message: DEFAULT_REMINDER_MESSAGE,
      receipt_name: '',
      description: '',
      require_notes: false,
      notes_instructions: '',
      practitioner_ids: [],
      billing_scenarios: [],
      resource_requirements: [],
      follow_up_messages: [],
    }
  });

  const { reset, handleSubmit, register, setValue, formState: { errors, isDirty } } = methods;

  useEffect(() => {
    if (bundle) {
      // Map resource requirements
      const requirements = bundle.associations.resource_requirements.map((req) => ({
        id: generateTemporaryId(), // Unique temp ID for UI key
        appointment_type_id: bundle.item.id,
        resource_type_id: req.resource_type_id,
        resource_type_name: req.resource_type_name || 'Unknown',
        quantity: req.quantity,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const formData: ServiceItemBundleFormData = {
        name: bundle.item.name,
        duration_minutes: bundle.item.duration_minutes,
        service_type_group_id: bundle.item.service_type_group_id,
        allow_new_patient_booking: bundle.item.allow_new_patient_booking,
        allow_existing_patient_booking: bundle.item.allow_existing_patient_booking,
        allow_patient_practitioner_selection: bundle.item.allow_patient_practitioner_selection,
        allow_multiple_time_slot_selection: bundle.item.allow_multiple_time_slot_selection,
        scheduling_buffer_minutes: bundle.item.scheduling_buffer_minutes,
        receipt_name: bundle.item.receipt_name || '',
        description: bundle.item.description || '',
        require_notes: bundle.item.require_notes,
        notes_instructions: bundle.item.notes_instructions || '',
        send_patient_confirmation: bundle.item.send_patient_confirmation,
        send_clinic_confirmation: bundle.item.send_clinic_confirmation,
        send_reminder: bundle.item.send_reminder,
        patient_confirmation_message: bundle.item.patient_confirmation_message || DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
        clinic_confirmation_message: bundle.item.clinic_confirmation_message || DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
        reminder_message: bundle.item.reminder_message || DEFAULT_REMINDER_MESSAGE,
        practitioner_ids: bundle.associations.practitioner_ids,
        billing_scenarios: bundle.associations.billing_scenarios,
        resource_requirements: requirements,
        follow_up_messages: bundle.associations.follow_up_messages,
      };

      reset(formData);
    } else if (serviceItemId === null) {
      const newItem: ServiceItemBundleFormData = {
        name: '',
        duration_minutes: 30,
        allow_new_patient_booking: true,
        allow_existing_patient_booking: true,
        allow_patient_practitioner_selection: true,
        allow_multiple_time_slot_selection: false,
        scheduling_buffer_minutes: 0,
        receipt_name: '',
        description: '',
        require_notes: false,
        notes_instructions: '',
        send_patient_confirmation: true,
        send_clinic_confirmation: true,
        send_reminder: true,
        patient_confirmation_message: DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
        clinic_confirmation_message: DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
        reminder_message: DEFAULT_REMINDER_MESSAGE,
        practitioner_ids: [],
        billing_scenarios: [],
        resource_requirements: [],
        follow_up_messages: [],
      };
      reset(newItem);
    }
  }, [bundle, serviceItemId, reset]);

  const onUpdateLocalItem = (updates: Partial<AppointmentType>) => {
    // Removed setLocalItem
    Object.entries(updates).forEach(([key, val]) => {
      // Use cast to any for dynamic key assignment while satisfying RHF Path type
      setValue(key as any, val, { shouldDirty: true, shouldValidate: true });
    });
  };

  useUnsavedChangesDetection({
    hasUnsavedChanges: () => methods.formState.isDirty,
  });

  const formValues = methods.watch(); // Watch all form values for child components

  // Satisfy child component requirements for AppointmentType interface
  const appointmentTypeProxy: AppointmentType = {
    ...formValues,
    id: serviceItemId || 0,
    clinic_id: 0,
    is_deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as AppointmentType; // Still needs cast as formValues contains non-AppointmentType fields

  const saveMutation = useMutation({
    mutationFn: async (data: ServiceItemBundleFormData) => {
      const request: ServiceItemBundleRequest = {
        item: {
          name: data.name,
          duration_minutes: data.duration_minutes,
          service_type_group_id: data.service_type_group_id ?? null,
          allow_new_patient_booking: data.allow_new_patient_booking ?? true,
          allow_existing_patient_booking: data.allow_existing_patient_booking ?? true,
          allow_patient_practitioner_selection: data.allow_patient_practitioner_selection ?? true,
          allow_multiple_time_slot_selection: data.allow_multiple_time_slot_selection ?? false,
          scheduling_buffer_minutes: data.scheduling_buffer_minutes ?? 0,
          send_patient_confirmation: data.send_patient_confirmation ?? true,
          send_clinic_confirmation: data.send_clinic_confirmation ?? true,
          send_reminder: data.send_reminder ?? true,
          patient_confirmation_message: data.patient_confirmation_message ?? null,
          clinic_confirmation_message: data.clinic_confirmation_message ?? null,
          reminder_message: data.reminder_message ?? null,
          require_notes: data.require_notes ?? false,
          notes_instructions: data.notes_instructions ?? null,
          receipt_name: data.receipt_name ?? null,
          description: data.description ?? null,
        },
        associations: {
          practitioner_ids: data.practitioner_ids || [],
          billing_scenarios: (data.billing_scenarios || []).map(bs => ({
            ...(bs.id && bs.id > 0 ? { id: bs.id } : {}),
            practitioner_id: bs.practitioner_id,
            name: bs.name,
            amount: bs.amount,
            revenue_share: bs.revenue_share,
            is_default: bs.is_default
          })),
          resource_requirements: (data.resource_requirements || []).map((req): ResourceRequirementBundleData => ({
            resource_type_id: req.resource_type_id,
            quantity: req.quantity
          })),
          follow_up_messages: (data.follow_up_messages || []).map((msg): FollowUpMessageBundleData => ({
            ...(msg.id && msg.id > 0 ? { id: msg.id } : {}),
            timing_mode: msg.timing_mode,
            hours_after: msg.hours_after ?? null,
            message_template: msg.message_template
          }))
        }
      };

      if (serviceItemId) {
        return apiService.updateServiceItemBundle(serviceItemId, request);
      } else {
        return apiService.createServiceItemBundle(request);
      }
    },
    onSuccess: async () => {
      if (serviceItemId) {
        await queryClient.invalidateQueries({ queryKey: ['settings', 'service-item', serviceItemId] });
      }
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      onClose(true);
    },
    onError: async (err: any) => {
      logger.error('Error saving bundle:', err);
      await alert(getErrorMessage(err) || '儲存失敗', '錯誤');
    }
  });

  const handleSave = (data: ServiceItemBundleFormData) => {
    saveMutation.mutate(data);
  };


  const [editingScenario, setEditingScenario] = useState<{ practitionerId: number, scenario?: BillingScenarioBundleData } | null>(null);
  const [scenarioForm, setScenarioForm] = useState<BillingScenarioBundleData>({
    name: '', amount: 0, revenue_share: 0, is_default: false, practitioner_id: 0
  });

  const handleAddScenario = (practitionerId: number) => {
    setScenarioForm({ name: '', amount: 0, revenue_share: 0, is_default: false, practitioner_id: practitionerId });
    setEditingScenario({ practitionerId });
  };

  const handleEditScenario = (practitionerId: number, scenario: BillingScenarioBundleData) => {
    setScenarioForm(scenario);
    setEditingScenario({ practitionerId, scenario });
  };

  const handleConfirmScenario = () => {
    if (!editingScenario) return;
    const currentScenarios = methods.getValues('billing_scenarios') || [];

    if (editingScenario.scenario) {
      const updated = currentScenarios.map(s => s === editingScenario.scenario ? scenarioForm : s);
      setValue('billing_scenarios', updated, { shouldDirty: true });
    } else {
      setValue('billing_scenarios', [...currentScenarios, scenarioForm], { shouldDirty: true });
    }
    setEditingScenario(null);
  };

  if (loadingBundle && serviceItemId !== null) {
    return (
      <BaseModal onClose={() => onClose()} aria-label="載入中">
        <div className="p-12 flex justify-center"><LoadingSpinner /></div>
      </BaseModal>
    );
  }

  return (
    <FormProvider {...methods}>
      <BaseModal
        onClose={() => onClose()}
        aria-label={serviceItemId ? '編輯服務項目' : '新增服務項目'}
        className="max-w-6xl"
      >
        <form onSubmit={handleSubmit(handleSave)} className="flex flex-col h-[90vh]">
          {/* Header */}
          <div className="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-white rounded-t-2xl">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                {serviceItemId ? '編輯服務項目' : '新增服務項目'}
              </h2>
              {serviceItemId && <p className="text-sm text-gray-500 mt-1">ID: {serviceItemId}</p>}
            </div>
            <button type="button" onClick={() => onClose()} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable Content */}
          <main className="flex-1 overflow-y-auto p-8 bg-gray-50/30">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left Column: Basic Info & Restrictions */}
              <div className="space-y-8">
                <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                  <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-blue-500 rounded-full"></span>
                    基本資訊
                  </h3>
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">項目名稱 <span className="text-red-500">*</span></label>
                      <input
                        {...register('name', { required: '請輸入名稱' })}
                        className={`input w-full ${errors.name ? 'border-red-500' : ''}`}
                        placeholder="例如：復健治療、初診評估"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">服務時長 (分鐘)</label>
                      <input
                        type="number"
                        {...register('duration_minutes', { valueAsNumber: true })}
                        className="input w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">所屬群組</label>
                      <select
                        {...register('service_type_group_id', { valueAsNumber: true })}
                        className="input w-full"
                      >
                        <option value="">未分類</option>
                        {availableGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">收據名稱 (選填)</label>
                      <input
                        {...register('receipt_name')}
                        className="input w-full"
                        placeholder="若未填寫則顯示項目名稱"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">描述 (選填)</label>
                      <textarea
                        {...register('description')}
                        className="input w-full min-h-[80px]"
                        placeholder="此服務項目的詳細說明..."
                      />
                    </div>
                  </div>
                </section>

                <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                  <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-purple-500 rounded-full"></span>
                    預約規則
                  </h3>
                  <div className="space-y-4">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        {...register('allow_new_patient_booking')}
                        className="w-4 h-4 text-primary-600 rounded border-gray-300 mr-3"
                      />
                      <span className="text-gray-700">開放新病患預約</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        {...register('allow_existing_patient_booking')}
                        className="w-4 h-4 text-primary-600 rounded border-gray-300 mr-3"
                      />
                      <span className="text-gray-700">開放現有病患預約</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        {...register('allow_patient_practitioner_selection')}
                        className="w-4 h-4 text-primary-600 rounded border-gray-300 mr-3"
                      />
                      <span className="text-gray-700">允許病患選擇治療師</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        {...register('allow_multiple_time_slot_selection')}
                        className="w-4 h-4 text-primary-600 rounded border-gray-300 mr-3"
                      />
                      <span className="text-gray-700">允許單次預約多個時段</span>
                    </label>
                  </div>
                </section>

                <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                  <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-teal-500 rounded-full"></span>
                    預約備註
                  </h3>
                  <div className="space-y-4">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        {...register('require_notes')}
                        className="w-4 h-4 text-primary-600 rounded border-gray-300 mr-3"
                      />
                      <span className="text-gray-700">強制病患填寫備註</span>
                    </label>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">備註填寫說明 (選填)</label>
                      <input
                        {...register('notes_instructions')}
                        className="input w-full"
                        placeholder="例如：請簡述您的症狀..."
                      />
                    </div>
                  </div>
                </section>

                <MessageSettingsSection
                  appointmentType={appointmentTypeProxy}
                  onUpdate={onUpdateLocalItem}
                  disabled={!isClinicAdmin}
                  clinicInfoAvailability={clinicInfoAvailability || {}}
                />

                <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                  <ResourceRequirementsSection
                    appointmentTypeId={serviceItemId || 0}
                    isClinicAdmin={isClinicAdmin}
                    currentResourceRequirements={(formValues.resource_requirements || []) as unknown as ResourceRequirement[]}
                    updateResourceRequirements={(_id, reqs) => setValue('resource_requirements', reqs as unknown as ResourceRequirementBundleData[], { shouldDirty: true })}
                  />
                </section>
              </div>

              {/* Right Column: Practitioners & Others */}
              <div className="space-y-8">
                <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                  <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-indigo-500 rounded-full"></span>
                    治療師指派
                  </h3>
                  <div className="space-y-4">
                    {members.map(m => {
                      const practitionerIds = formValues.practitioner_ids || [];
                      const billingScenarios = formValues.billing_scenarios || [];
                      const isAssigned = practitionerIds.includes(m.id);
                      const scenarios = billingScenarios.filter(s => s.practitioner_id === m.id);

                      return (
                        <div key={m.id} className={`p-4 rounded-2xl border transition-all ${isAssigned ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-100'}`}>
                          <div className="flex items-center justify-between mb-3">
                            <label className="flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isAssigned}
                                onChange={(e) => {
                                  if (e.target.checked) setValue('practitioner_ids', [...practitionerIds, m.id], { shouldDirty: true });
                                  else setValue('practitioner_ids', practitionerIds.filter(id => id !== m.id), { shouldDirty: true });
                                }}
                                className="w-4 h-4 text-indigo-600 rounded border-gray-300 mr-3"
                              />
                              <span className="font-semibold text-gray-900">{m.full_name}</span>
                            </label>
                            {isAssigned && (
                              <button
                                type="button"
                                onClick={() => handleAddScenario(m.id)}
                                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                              >
                                + 新增計費方案
                              </button>
                            )}
                          </div>

                          {isAssigned && (
                            <div className="space-y-2 pl-7">
                              {scenarios.length > 0 ? scenarios.map((s, idx) => (
                                <div key={idx} className="flex items-center justify-between bg-white/60 p-2.5 rounded-xl border border-indigo-100/50">
                                  <div className="text-sm">
                                    <span className="font-medium text-gray-800">{s.name}</span>
                                    <span className="mx-2 text-gray-300">|</span>
                                    <span className="text-gray-600">${s.amount}</span>
                                  </div>
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => handleEditScenario(m.id, s as BillingScenarioBundleData)} className="p-1.5 hover:bg-indigo-50 rounded-lg text-indigo-600 transition-colors">
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                    </button>
                                    <button type="button" onClick={() => setValue('billing_scenarios', (billingScenarios).filter((bs) => bs !== s), { shouldDirty: true })} className="p-1.5 hover:bg-red-50 rounded-lg text-red-500 transition-colors">
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                  </div>
                                </div>
                              )) : (
                                <p className="text-xs text-gray-400 italic">尚無計費方案</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <FollowUpMessagesSection
                  appointmentType={appointmentTypeProxy}
                  onUpdate={onUpdateLocalItem}
                  disabled={!isClinicAdmin}
                  clinicInfoAvailability={clinicInfoAvailability || {}}
                />
              </div>
            </div>
          </main>

          {/* Footer */}
          <div className="px-8 py-6 border-t border-gray-100 bg-white flex justify-between items-center rounded-b-2xl">
            <div className="text-sm text-gray-500">
              {isDirty && <span className="flex items-center gap-1.5 text-amber-600 font-medium">● 有未儲存的變更</span>}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => onClose()} className="px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl transition-colors">
                取消
              </button>
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="px-8 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-lg shadow-blue-200 transition-all transform active:scale-[0.98]"
              >
                {saveMutation.isPending ? '儲存中...' : '儲存設定'}
              </button>
            </div>
          </div>
        </form>

        {editingScenario && (
          <BaseModal
            onClose={() => setEditingScenario(null)}
            aria-label="編輯計費方案"
            className="max-w-md"
          >
            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-6">計費方案設定</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">方案名稱</label>
                  <input
                    type="text"
                    value={scenarioForm.name}
                    onChange={(e) => setScenarioForm({ ...scenarioForm, name: e.target.value })}
                    className="input w-full"
                    placeholder="例如：原價、特惠價"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">金額</label>
                  <input
                    type="number"
                    value={scenarioForm.amount}
                    onChange={(e) => setScenarioForm({ ...scenarioForm, amount: parseInt(e.target.value) || 0 })}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">診所分潤</label>
                  <input
                    type="number"
                    value={scenarioForm.revenue_share}
                    onChange={(e) => setScenarioForm({ ...scenarioForm, revenue_share: parseInt(e.target.value) || 0 })}
                    className="input w-full"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    checked={scenarioForm.is_default}
                    onChange={(e) => setScenarioForm({ ...scenarioForm, is_default: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300"
                  />
                  <span className="text-sm font-medium text-gray-700">設為預設方案</span>
                </label>
              </div>
              <div className="mt-8 flex gap-3">
                <button type="button" onClick={() => setEditingScenario(null)} className="btn-secondary flex-1">取消</button>
                <button type="button" onClick={handleConfirmScenario} className="btn-primary flex-1">確定</button>
              </div>
            </div>
          </BaseModal>
        )}
      </BaseModal>
    </FormProvider>
  );
};
