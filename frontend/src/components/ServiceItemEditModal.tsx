import React, { useState, useEffect, useMemo } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import { AppointmentType, Practitioner, ServiceTypeGroup, ResourceRequirement } from '../types';
import { LoadingSpinner, InfoButton, InfoModal, WarningPopover } from './shared';
import {
  ServiceItemBundleRequest,
  BillingScenarioBundleData,
  ResourceRequirementBundleData,
  FollowUpMessageBundleData
} from '../types';
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
import { FormInput } from './forms/FormInput';
import { generateTemporaryId } from '../utils/idUtils';
import { useUnsavedChangesDetection } from '../hooks/useUnsavedChangesDetection';
import { formatCurrency } from '../utils/currencyUtils';
import { useNumberInput } from '../hooks/useNumberInput';
import { preventScrollWheelChange } from '../utils/inputUtils';


interface ServiceItemEditModalProps {
  serviceItemId: number | null; // null for new
  isOpen: boolean;
  onClose: (refetch?: boolean) => void;
  practitioners: Practitioner[];
  isClinicAdmin: boolean;
  availableGroups: ServiceTypeGroup[];
  existingNames?: string[];
  clinicInfoAvailability?: {
    has_address: boolean;
    has_phone: boolean;
  };
}



export const ServiceItemEditModal: React.FC<ServiceItemEditModalProps> = ({
  serviceItemId,
  isOpen,
  onClose,
  practitioners,
  isClinicAdmin,
  availableGroups,
  existingNames = [],
  clinicInfoAvailability,
}) => {
  const queryClient = useQueryClient();
  const { alert } = useModal();
  const { data: bundle, isLoading: loadingBundle } = useServiceItemBundle(serviceItemId || 0, isOpen && serviceItemId !== null);

  // Instance-level temp ID counter to avoid collisions across modals
  // Removed tempIdCounter ref in favor of shared utility generateTemporaryId


  // Removed localItem state to avoid dual-state anti-pattern

  const isEdit = serviceItemId !== null;

  const refinedSchema = useMemo(() =>
    ServiceItemBundleSchema.superRefine((data, ctx) => {
      const currentName = data.name.trim().toLowerCase();
      const conflict = existingNames.some(name => name.toLowerCase() === currentName);

      if (conflict) {
        const originalName = bundle?.item.name.toLowerCase();
        if (!isEdit || currentName !== originalName) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: '服務項目名稱已存在',
            path: ['name'],
          });
        }
      }
    }),
    [existingNames, bundle?.item.name, isEdit]
  );

  const methods = useForm<ServiceItemBundleFormData>({
    resolver: zodResolver(refinedSchema),
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

  const { reset, handleSubmit, register, setValue, watch, formState: { errors, isDirty } } = methods;

  // Watch values for conditional rendering and warnings
  const allow_new_patient_booking = watch('allow_new_patient_booking');
  const allow_existing_patient_booking = watch('allow_existing_patient_booking');
  const name = watch('name');

  // Modal states
  const [showBufferModal, setShowBufferModal] = useState(false);
  const [showReceiptNameModal, setShowReceiptNameModal] = useState(false);
  const [showAllowNewPatientBookingModal, setShowAllowNewPatientBookingModal] = useState(false);
  const [showAllowExistingPatientBookingModal, setShowAllowExistingPatientBookingModal] = useState(false);
  const [showBillingScenarioModal, setShowBillingScenarioModal] = useState(false);
  const [showMultipleTimeSlotModal, setShowMultipleTimeSlotModal] = useState(false);
  const [showFollowUpInfoModal, setShowFollowUpInfoModal] = useState(false);

  // Validation state
  const [messageValidationErrors, setMessageValidationErrors] = useState<string[]>([]);

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
        billing_scenarios: bundle.associations.billing_scenarios.map(s => ({
          ...s,
          is_default: s.is_default // Ensure is_default is preserved
        })),
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

  /**
   * Dedicated type for the proxy object that satisfies individual section components.
   * This allows us to pass the form state as an AppointmentType-compatible object
   * even though it contains additional bundle-specific fields.
   */
  interface FormAppointmentTypeProxy extends AppointmentType {
    practitioner_ids: any[];
    billing_scenarios: any[];
    resource_requirements: any[];
    follow_up_messages: any[];
    created_at: string;
    updated_at: string;
  }

  const appointmentTypeProxy: FormAppointmentTypeProxy = {
    ...formValues,
    id: serviceItemId || 0,
    clinic_id: 0,
    is_deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    // Explicitly set these to satisfy the proxy interface and resolve type conflicts
    resource_requirements: formValues.resource_requirements || [],
    follow_up_messages: formValues.follow_up_messages || [],
    practitioner_ids: formValues.practitioner_ids || [],
    billing_scenarios: formValues.billing_scenarios || [],
  };

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
          billing_scenarios: (data.billing_scenarios || []).map(bs => {
            const scenario: BillingScenarioBundleData = {
              practitioner_id: bs.practitioner_id,
              name: bs.name,
              amount: bs.amount,
              revenue_share: bs.revenue_share,
              is_default: bs.is_default
            };
            if (bs.id && bs.id > 0) scenario.id = bs.id;
            return scenario;
          }),
          resource_requirements: (data.resource_requirements || []).map((req): ResourceRequirementBundleData => ({
            resource_type_id: req.resource_type_id,
            quantity: req.quantity
          })),
          follow_up_messages: (data.follow_up_messages || []).map((msg): FollowUpMessageBundleData => {
            const fm: FollowUpMessageBundleData = {
              timing_mode: msg.timing_mode,
              hours_after: msg.hours_after ?? null,
              days_after: msg.days_after ?? null,
              time_of_day: msg.time_of_day ?? null,
              message_template: msg.message_template,
              is_enabled: msg.is_enabled !== false, // Default to true if not explicitly false
              display_order: msg.display_order ?? 0,
            };
            if (msg.id && msg.id > 0) fm.id = msg.id;
            return fm;
          })
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

  const handleSave = async (data: ServiceItemBundleFormData) => {
    // Custom validation for message settings
    const messageErrors: string[] = [];

    if (data.send_patient_confirmation && data.patient_confirmation_message && data.patient_confirmation_message.length > 1000) {
      messageErrors.push('病患預約成功通知：訊息模板長度不能超過 1000 字元');
    }

    if (data.send_clinic_confirmation && data.clinic_confirmation_message && data.clinic_confirmation_message.length > 1000) {
      messageErrors.push('診所預約通知：訊息模板長度不能超過 1000 字元');
    }

    if (data.send_reminder && data.reminder_message && data.reminder_message.length > 3500) {
      messageErrors.push('提醒訊息：訊息模板長度不能超過 3500 字元');
    }

    if (messageErrors.length > 0) {
      setMessageValidationErrors(messageErrors);
      // Scroll to message settings section
      const messageSection = document.querySelector('[data-message-settings]');
      if (messageSection) {
        messageSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setMessageValidationErrors([]);

    saveMutation.mutate(data);
  };


  const [editingScenario, setEditingScenario] = useState<{ practitionerId: number, scenario?: BillingScenarioBundleData } | null>(null);
  const [scenarioForm, setScenarioForm] = useState<BillingScenarioBundleData>({
    name: '', amount: 0, revenue_share: 0, is_default: false, practitioner_id: 0
  });
  const [scenarioFormErrors, setScenarioFormErrors] = useState<{ name?: string; amount?: string; revenue_share?: string }>({});

  // Number input hooks for amount and revenue_share
  const amountInput = useNumberInput(
    Math.round(scenarioForm.amount),
    (value) => setScenarioForm(prev => ({ ...prev, amount: value })),
    { fallback: 0, parseFn: 'parseInt', min: 0, round: true }
  );

  const revenueShareInput = useNumberInput(
    Math.round(scenarioForm.revenue_share),
    (value) => setScenarioForm(prev => ({ ...prev, revenue_share: value })),
    { fallback: 0, parseFn: 'parseInt', min: 0, round: true }
  );

  const handleAddScenario = (practitionerId: number) => {
    setScenarioForm({ name: '', amount: 0, revenue_share: 0, is_default: false, practitioner_id: practitionerId });
    setScenarioFormErrors({});
    setEditingScenario({ practitionerId });
  };

  const handleEditScenario = (practitionerId: number, scenario: BillingScenarioBundleData) => {
    setScenarioForm(scenario);
    setScenarioFormErrors({});
    setEditingScenario({ practitionerId, scenario });
  };

  const handleConfirmScenario = () => {
    if (!editingScenario) return;

    const currentScenarios = methods.getValues('billing_scenarios') || [];

    // Validate required fields
    const errors: { name?: string; amount?: string; revenue_share?: string } = {};
    if (!scenarioForm.name.trim()) {
      errors.name = '請輸入方案名稱';
    } else {
      // Check for duplicate name for the same practitioner
      const duplicateExists = currentScenarios.some(s =>
        s.practitioner_id === scenarioForm.practitioner_id &&
        s.name.trim().toLowerCase() === scenarioForm.name.trim().toLowerCase() &&
        // Exclude the current scenario being edited: by ID if it exists, otherwise by reference
        (editingScenario.scenario?.id ? s.id !== editingScenario.scenario.id : s !== editingScenario.scenario)
      );
      if (duplicateExists) {
        errors.name = '此治療師已有相同名稱的方案';
      }
    }
    const amount = Number(scenarioForm.amount);
    const revenueShare = Number(scenarioForm.revenue_share);

    if (amount < 0) {
      errors.amount = '金額不能為負數';
    }
    if (revenueShare < 0) {
      errors.revenue_share = '分潤不能為負數';
    }
    if (revenueShare > amount) {
      errors.revenue_share = '分潤不能大於金額';
    }

    if (Object.keys(errors).length > 0) {
      setScenarioFormErrors(errors);
      return;
    }

    if (editingScenario.scenario) {
      let updated = currentScenarios.map(s => s === editingScenario.scenario ? scenarioForm : s);
      // If the modified scenario is set as default, unset others for the same practitioner
      if (scenarioForm.is_default) {
        updated = updated.map(s =>
          (s !== scenarioForm && s.practitioner_id === scenarioForm.practitioner_id)
            ? { ...s, is_default: false }
            : s
        );
      }
      setValue('billing_scenarios', updated, { shouldDirty: true });
    } else {
      let updated = [...currentScenarios, scenarioForm];
      // If the new scenario is set as default, unset others for the same practitioner
      if (scenarioForm.is_default) {
        updated = updated.map(s =>
          (s !== scenarioForm && s.practitioner_id === scenarioForm.practitioner_id)
            ? { ...s, is_default: false }
            : s
        );
      }
      setValue('billing_scenarios', updated, { shouldDirty: true });
    }
    setEditingScenario(null);
  };

  if (loadingBundle && serviceItemId !== null) {
    return (
      <BaseModal onClose={() => onClose()} aria-label="載入中" fullScreen>
        <div className="flex items-center justify-center h-full">
          <LoadingSpinner />
        </div>
      </BaseModal>
    );
  }

  return (
    <FormProvider {...methods}>
      <BaseModal
        onClose={() => onClose()}
        aria-label={serviceItemId ? '編輯服務項目' : '新增服務項目'}
        showCloseButton={false}
        fullScreen={true}
      >
        <form onSubmit={handleSubmit(handleSave)} className="flex flex-col h-full bg-gray-50/50">
          <ModalHeader
            title={serviceItemId ? '編輯服務項目' : '新增服務項目'}
            showClose
            onClose={() => onClose()}
          />

          <ModalBody className="p-0">
            {/* Scrollable Content inside ModalBody */}
            <div className="p-3 md:p-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-8 max-w-7xl mx-auto w-full">
                {/* Left Column: Basic Info & Restrictions */}
                <div className="space-y-3 md:space-y-8">
                  <section className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 md:mb-6 flex items-center gap-2">
                      <span className="w-1.5 h-6 bg-blue-500 rounded-full"></span>
                      基本資訊
                    </h3>
                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">項目名稱 <span className="text-red-500">*</span></label>
                        <input
                          {...register('name', { required: '請輸入名稱' })}
                          className={`input w-full ${errors.name ? 'border-red-500' : ''}`}
                          placeholder="例如：初診評估"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                          收據項目名稱
                          <InfoButton onClick={() => setShowReceiptNameModal(true)} />
                        </label>
                        <input
                          {...register('receipt_name')}
                          className="input w-full"
                          placeholder={name || '例如：初診評估'}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">群組</label>
                        <select
                          {...register('service_type_group_id', {
                            setValueAs: (value) => value === '' ? null : Number(value)
                          })}
                          className="input w-full"
                        >
                          <option value="">未分類</option>
                          {availableGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          服務時長 (分鐘)
                        </label>
                        <FormInput
                          type="number"
                          step="5"
                          name="duration_minutes"
                          placeholder="30"
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                          排程緩衝時間 (分鐘)
                          <InfoButton onClick={() => setShowBufferModal(true)} />
                        </label>
                        <FormInput
                          type="number"
                          step="5"
                          name="scheduling_buffer_minutes"
                          placeholder="0"
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                          說明
                          {!allow_new_patient_booking && !allow_existing_patient_booking && (
                            <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                              <span className="text-amber-600 hover:text-amber-700 cursor-pointer">⚠️</span>
                            </WarningPopover>
                          )}
                        </label>
                        <textarea
                          {...register('description')}
                          className="input w-full min-h-[80px]"
                          placeholder="服務說明（顯示在 LINE 預約系統）"
                        />
                      </div>
                    </div>
                  </section>

                  <section className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 md:mb-6 flex items-center gap-2">
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
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-900">新病患可自行預約</span>
                          <span className="text-xs text-gray-500">新病患可透過 LINE 預約系統看到並選擇此服務</span>
                        </div>
                        <div className="ml-2"><InfoButton onClick={() => setShowAllowNewPatientBookingModal(true)} /></div>
                      </label>
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          {...register('allow_existing_patient_booking')}
                          className="w-4 h-4 text-primary-600 rounded border-gray-300 mr-3"
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-900">舊病患可自行預約</span>
                          <span className="text-xs text-gray-500">舊病患可透過 LINE 預約系統看到並選擇此服務</span>
                        </div>
                        <div className="ml-2"><InfoButton onClick={() => setShowAllowExistingPatientBookingModal(true)} /></div>
                      </label>
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          {...register('allow_patient_practitioner_selection')}
                          className="w-4 h-4 text-primary-600 rounded border-gray-300 mr-3"
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-900">開放病患指定治療師</span>
                          <span className="text-xs text-gray-500">病患預約時可自由選擇想看診的治療師</span>
                        </div>
                        {!allow_new_patient_booking && !allow_existing_patient_booking && (
                          <div className="ml-2">
                            <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                              <span className="text-amber-600 hover:text-amber-700 cursor-pointer">⚠️</span>
                            </WarningPopover>
                          </div>
                        )}
                      </label>
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          {...register('allow_multiple_time_slot_selection')}
                          className="w-4 h-4 text-primary-600 rounded border-gray-300 mr-3"
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-900">允許患者選擇多個時段</span>
                          <span className="text-xs text-gray-500">病患預約時可選擇多個偏好時段供診所確認</span>
                        </div>
                        <div className="ml-2"><InfoButton onClick={() => setShowMultipleTimeSlotModal(true)} /></div>
                        {!allow_new_patient_booking && !allow_existing_patient_booking && (
                          <div className="ml-2">
                            <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                              <span className="text-amber-600 hover:text-amber-700 cursor-pointer">⚠️</span>
                            </WarningPopover>
                          </div>
                        )}
                      </label>
                    </div>
                  </section>

                  <section className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 md:mb-6 flex items-center gap-2">
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
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-900">要求填寫備註</span>
                          <span className="text-xs text-gray-500">病患透過Line自行預約此服務時必須填寫備註</span>
                        </div>
                        {!allow_new_patient_booking && !allow_existing_patient_booking && (
                          <div className="ml-2">
                            <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                              <span className="text-amber-600 hover:text-amber-700 cursor-pointer">⚠️</span>
                            </WarningPopover>
                          </div>
                        )}
                      </label>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                          備註填寫指引
                          {!allow_new_patient_booking && !allow_existing_patient_booking && (
                            <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                              <span className="text-amber-600 hover:text-amber-700 cursor-pointer">⚠️</span>
                            </WarningPopover>
                          )}
                        </label>
                        <textarea
                          {...register('notes_instructions')}
                          className="input w-full min-h-[100px] resize-none"
                          placeholder="病患在透過Line預約，填寫備註時，將會看到此指引（若未填寫，將使用「預約設定」頁面中的「備註填寫指引」）"
                        />
                      </div>
                    </div>
                  </section>



                  <section className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <span className="w-1.5 h-6 bg-pink-500 rounded-full"></span>
                      資源需求
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">設定此服務項目需要的資源類型和數量</p>
                    <ResourceRequirementsSection
                      appointmentTypeId={serviceItemId || 0}
                      isClinicAdmin={isClinicAdmin}
                      currentResourceRequirements={(formValues.resource_requirements || []) as unknown as ResourceRequirement[]}
                      updateResourceRequirements={(_id, reqs) => setValue('resource_requirements', reqs as unknown as ResourceRequirementBundleData[], { shouldDirty: true })}
                    />
                  </section>
                </div>

                {/* Right Column: Practitioners & Others */}
                <div className="space-y-3 md:space-y-8">
                  <section className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 md:mb-6 flex items-center gap-2">
                      <span className="w-1.5 h-6 bg-indigo-500 rounded-full"></span>
                      治療師指派
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">選擇提供此服務的治療師，並為每位治療師設定計費方案。</p>
                    <div className="space-y-4">
                      {practitioners.map(m => {
                        const practitionerIds = formValues.practitioner_ids || [];
                        const billingScenarios = formValues.billing_scenarios || [];
                        const isAssigned = practitionerIds.includes(m.id);
                        const scenarios = billingScenarios.filter(s => s.practitioner_id === m.id);

                        return (

                          <div key={m.id} className={`p-4 rounded-xl border transition-all ${isAssigned ? 'bg-blue-50/50 border-blue-200 ring-1 ring-blue-100' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                            <div className="flex items-center justify-between mb-3 gap-2">
                              <label className="flex items-center cursor-pointer min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isAssigned}
                                  onChange={(e) => {
                                    const newIds = e.target.checked
                                      ? [...practitionerIds, m.id]
                                      : practitionerIds.filter(id => id !== m.id);
                                    setValue('practitioner_ids', newIds, { shouldDirty: true });
                                  }}
                                  className="w-5 h-5 text-indigo-600 rounded border-gray-300 mr-3 flex-shrink-0"
                                />
                                <span className="font-semibold text-gray-900 truncate">{m.full_name}</span>
                              </label>
                              <button
                                type="button"
                                onClick={() => handleAddScenario(m.id)}
                                className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
                              >
                                + 新增計費方案
                              </button>
                            </div>

                            <div className="space-y-2 pl-8">
                              {scenarios.length > 0 ? scenarios.map((s, idx) => (
                                <div key={idx} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                                  <div className="flex items-center flex-wrap gap-y-1 min-w-0 flex-1 mr-2">
                                    <span className="font-medium text-gray-900 truncate mr-2" title={s.name}>{s.name}</span>
                                    {s.is_default && (
                                      <span className="px-1.5 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 rounded border border-amber-200 flex-shrink-0 mr-2">
                                        預設
                                      </span>
                                    )}
                                    <span className="text-gray-300 mr-2 hidden sm:inline">|</span>
                                    <span className="text-sm text-gray-600">
                                      金額: {formatCurrency(s.amount)} <span className="text-gray-300 mx-1">|</span> 診所分潤: {formatCurrency(s.revenue_share)}
                                    </span>
                                  </div>
                                  <div className="flex gap-1 flex-shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleEditScenario(m.id, s as BillingScenarioBundleData)}
                                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                      title="編輯方案"
                                    >
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setValue('billing_scenarios', (billingScenarios).filter((bs) => bs !== s), { shouldDirty: true })}
                                      className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                      title="刪除方案"
                                    >
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                  </div>
                                </div>
                              )) : (
                                <p className="text-sm text-gray-400 italic py-1">尚未設定計費方案</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 md:mb-6 flex items-center gap-2">
                      <span className="w-1.5 h-6 bg-orange-500 rounded-full"></span>
                      訊息設定
                    </h3>
                    {isClinicAdmin && (
                      <MessageSettingsSection
                        appointmentType={appointmentTypeProxy}
                        onUpdate={onUpdateLocalItem}
                        disabled={!isClinicAdmin}
                        {...(clinicInfoAvailability !== undefined && { clinicInfoAvailability })}
                      />
                    )}
                    {messageValidationErrors.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4">
                        <div className="text-sm font-medium text-red-800 mb-2">請修正以下錯誤：</div>
                        <ul className="list-disc list-inside space-y-1 text-sm text-red-700">
                          {messageValidationErrors.map((error, index) => (
                            <li key={index}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>

                  <section className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100">
                    <div className="mb-4 md:mb-6">
                      <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <span className="w-1.5 h-6 bg-cyan-500 rounded-full"></span>
                        追蹤訊息設定
                        <InfoButton
                          onClick={() => setShowFollowUpInfoModal(true)}
                          ariaLabel="追蹤訊息設定說明"
                          size="small"
                        />
                      </h3>
                    </div>
                    <FollowUpMessagesSection
                      appointmentType={appointmentTypeProxy}
                      onUpdate={onUpdateLocalItem}
                      disabled={!isClinicAdmin}
                      clinicInfoAvailability={clinicInfoAvailability || {}}
                    />
                  </section>
                </div>
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <div className="flex-1 text-sm text-gray-500 text-left">
              {isDirty && <span className="flex items-center gap-1.5 text-amber-600 font-medium">● 有未儲存的變更</span>}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => onClose()} className="btn-secondary">
                取消
              </button>
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="btn-primary min-w-[120px]"
              >
                {saveMutation.isPending ? '儲存中...' : '儲存設定'}
              </button>
            </div>
          </ModalFooter>
        </form>

        {editingScenario && (
          <BaseModal
            onClose={() => setEditingScenario(null)}
            aria-label="編輯計費方案"
            className="max-w-md"
          >
            <ModalHeader title="計費方案設定" showClose onClose={() => setEditingScenario(null)} />
            <ModalBody>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    方案名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={scenarioForm.name}
                    onChange={(e) => {
                      setScenarioForm({ ...scenarioForm, name: e.target.value });
                      if (scenarioFormErrors.name) setScenarioFormErrors(prev => { const { name, ...rest } = prev; return rest; });
                    }}
                    className={`input w-full ${scenarioFormErrors.name ? 'border-red-500' : ''}`}
                    placeholder="例如：原價、特惠價"
                  />
                  {scenarioFormErrors.name && (
                    <p className="text-xs text-red-500 mt-1">{scenarioFormErrors.name}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    金額 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="10"
                    min="0"
                    value={amountInput.displayValue}
                    onChange={amountInput.onChange}
                    onBlur={amountInput.onBlur}
                    onWheel={preventScrollWheelChange}
                    className={`input w-full ${scenarioFormErrors.amount ? 'border-red-500' : ''}`}
                  />
                  {scenarioFormErrors.amount && (
                    <p className="text-xs text-red-500 mt-1">{scenarioFormErrors.amount}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    診所分潤 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="10"
                    min="0"
                    value={revenueShareInput.displayValue}
                    onChange={revenueShareInput.onChange}
                    onBlur={revenueShareInput.onBlur}
                    onWheel={preventScrollWheelChange}
                    className={`input w-full ${scenarioFormErrors.revenue_share ? 'border-red-500' : ''}`}
                  />
                  {scenarioFormErrors.revenue_share && (
                    <p className="text-xs text-red-500 mt-1">{scenarioFormErrors.revenue_share}</p>
                  )}
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
            </ModalBody>
            <ModalFooter>
              <button type="button" onClick={() => setEditingScenario(null)} className="btn-secondary flex-1">取消</button>
              <button type="button" onClick={handleConfirmScenario} className="btn-primary flex-1">確定</button>
            </ModalFooter>
          </BaseModal>
        )}
        {/* Info Modals */}
        <InfoModal isOpen={showBufferModal} onClose={() => setShowBufferModal(false)} title="排程緩衝時間 (分鐘)">
          <p><strong>服務時長</strong>是病患看到的實際服務時間，<strong>排程緩衝時間</strong>是系統排程時額外保留的準備時間。</p>
          <p className="mt-2">總排程時間 = 服務時長 + 排程緩衝時間。</p>
        </InfoModal>
        <InfoModal isOpen={showReceiptNameModal} onClose={() => setShowReceiptNameModal(false)} title="收據項目名稱">
          <p>此名稱會顯示在收據上，取代服務項目名稱</p>
        </InfoModal>
        <InfoModal isOpen={showAllowNewPatientBookingModal} onClose={() => setShowAllowNewPatientBookingModal(false)} title="新病患可自行預約">
          <div className="space-y-2">
            <p>啟用後，新病患可透過 LINE 預約系統看到並選擇此服務項目。</p>
            <p className="text-sm text-gray-600"><strong>新病患定義：</strong>尚未指派過治療師的病患（不論是否曾經預約過）。</p>
            <p className="text-sm text-gray-600">系統會檢查病患是否已有治療師指派記錄，而非檢查過往預約記錄。</p>
          </div>
        </InfoModal>
        <InfoModal isOpen={showAllowExistingPatientBookingModal} onClose={() => setShowAllowExistingPatientBookingModal(false)} title="舊病患可自行預約">
          <div className="space-y-2">
            <p>啟用後，已指派治療師的病患可透過 LINE 預約系統看到並選擇此服務項目。</p>
            <p className="text-sm text-gray-600"><strong>舊病患定義：</strong>已指派過治療師的病患。</p>
            <p className="text-sm text-gray-600">系統會檢查病患是否已有治療師指派記錄，而非檢查過往預約記錄。</p>
          </div>
        </InfoModal>
        <InfoModal isOpen={showBillingScenarioModal} onClose={() => setShowBillingScenarioModal(false)} title="計費方案說明">
          <p>計費方案讓您為每位治療師的每項服務設定多種定價選項...</p>
        </InfoModal>
        <InfoModal isOpen={showMultipleTimeSlotModal} onClose={() => setShowMultipleTimeSlotModal(false)} title="多時段選擇說明">
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-gray-900 mb-2">功能概述</h4>
              <p className="text-sm text-gray-700">
                啟用後，病患預約時可選擇多個偏好時段（最多 10 個），系統會從病患選擇的時段中保留最早的可用時段，並將預約狀態設為「待安排」，等待診所確認最終時間。
              </p>
            </div>

            <div>
              <h4 className="font-medium text-gray-900 mb-2">病患體驗</h4>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>• 在 LINE 預約系統中看到「預約時間: 待安排」</li>
                <li>• 預約成功後收到確認訊息，顯示「待安排」狀態</li>
                <li>• 診所確認時間後，再次收到 LINE 通知包含確定的時間</li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium text-gray-900 mb-2">診所工作流程</h4>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>• 預約出現在「待確認預約」頁面中</li>
                <li>• 管理員或指定治療師可查看病患的所有偏好時段</li>
                <li>• 可從病患偏好中選擇最終時間，或選擇其他可用時段</li>
                <li>• 確認後自動發送 LINE 通知給病患並產生行事曆邀請</li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium text-gray-900 mb-2">自動確認機制</h4>
              <p className="text-sm text-gray-700 mb-2">
                系統會在預約時間前自動確認最早的偏好時段，確認機制取決於診所的預約限制設定：
              </p>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>• <strong>小時限制模式</strong>（預設）：在預約時間前 X 小時自動確認（預設為 24 小時）</li>
                <li>• <strong>截止時間模式</strong>：在指定截止時間自動確認（例如前一天上午 8:00 或當天上午 8:00）</li>
                <li>• 自動確認同樣會發送 LINE 通知給行事曆邀請</li>
              </ul>
            </div>
          </div>
        </InfoModal>
        <InfoModal isOpen={showFollowUpInfoModal} onClose={() => setShowFollowUpInfoModal(false)} title="追蹤訊息設定說明">
          <p>
            <strong>什麼是追蹤訊息？</strong>
          </p>
          <p>
            追蹤訊息是在病患完成預約後，系統自動發送的 LINE 訊息。您可以設定多個追蹤訊息，每個訊息可以有不同的發送時機和內容。
          </p>
          <p>
            <strong>發送時機：</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>預約結束後 X 小時：</strong>在預約結束時間後，延遲指定小時數發送（例如：2 小時後）。X=0 表示預約結束後立即發送。</li>
            <li><strong>預約日期後 Y 天的特定時間：</strong>在預約日期後的第 Y 天，於指定時間發送（例如：1 天後的晚上 9 點）。Y=0 表示預約當天的指定時間。</li>
          </ul>
          <p>
            <strong>注意事項：</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>如果預約被取消，已排程的追蹤訊息將不會發送</li>
            <li>如果預約時間變更，系統會自動重新排程追蹤訊息</li>
          </ul>
        </InfoModal>
      </BaseModal>
    </FormProvider>
  );
};
