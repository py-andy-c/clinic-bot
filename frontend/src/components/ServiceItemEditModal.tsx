import React, { useState, useEffect, useRef } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AppointmentType, Member, BillingScenario, ServiceTypeGroup, ResourceRequirement } from '../types';
import { preventScrollWheelChange } from '../utils/inputUtils';
import { formatCurrency } from '../utils/currencyUtils';
import { isTemporaryServiceItemId } from '../utils/idUtils';
import { useModal } from '../contexts/ModalContext';
import { BaseModal } from './shared/BaseModal';
import { InfoButton, InfoModal } from './shared';
import { useServiceItemsStore } from '../stores/serviceItemsStore';
import { ResourceRequirementsSection } from './ResourceRequirementsSection';
import { MessageSettingsSection } from './MessageSettingsSection';
import { FollowUpMessagesSection } from './FollowUpMessagesSection';
import { FormField, FormInput, FormTextarea } from './forms';
import { WarningPopover } from './shared/WarningPopover';

// Schema for single appointment type
const ServiceItemFormSchema = z.object({
  id: z.number(),
  clinic_id: z.number(),
  name: z.string().min(1, '項目名稱不能為空'),
  duration_minutes: z.coerce.number().min(15, '時長至少需 15 分鐘').max(480, '時長最多 480 分鐘'),
  receipt_name: z.string().nullable().optional(),
  allow_patient_booking: z.boolean().optional(), // DEPRECATED: Use allow_new_patient_booking and allow_existing_patient_booking
  allow_new_patient_booking: z.boolean().optional(),
  allow_existing_patient_booking: z.boolean().optional(),
  allow_patient_practitioner_selection: z.boolean().optional(),
  allow_multiple_time_slot_selection: z.boolean().optional(),
  description: z.string().nullable().optional(),
  scheduling_buffer_minutes: z.coerce.number().min(0, '排程緩衝時間不能小於 0').max(60, '排程緩衝時間不能超過 60 分鐘').optional(),
  service_type_group_id: z.number().nullable().optional(),
  display_order: z.number().optional(),
  // Message customization fields (for schema completeness, but validation is done separately)
  send_patient_confirmation: z.boolean().optional(),
  send_clinic_confirmation: z.boolean().optional(),
  send_reminder: z.boolean().optional(),
  patient_confirmation_message: z.string().optional(),
  clinic_confirmation_message: z.string().optional(),
  reminder_message: z.string().optional(),
  // Notes customization fields
  require_notes: z.boolean().optional(),
  notes_instructions: z.string().nullable().optional(),
});

type ServiceItemFormData = z.infer<typeof ServiceItemFormSchema>;

interface ServiceItemEditModalProps {
  appointmentType: AppointmentType;
  isOpen: boolean;
  onClose: (wasConfirmed?: boolean) => void; // wasConfirmed: true if closed after 確認編輯, false/undefined if canceled
  onUpdate: (updatedItem: AppointmentType) => void; // Synchronous update to staging store
  onDelete?: (appointmentType: AppointmentType) => void; // Delete handler
  members: Member[];
  isClinicAdmin: boolean;
  availableGroups: ServiceTypeGroup[]; // Groups from staging store (includes temporary ones)
  practitionerAssignments: number[]; // Current assignments for this item
  billingScenarios: Record<string, BillingScenario[]>; // All billing scenarios
  resourceRequirements: ResourceRequirement[]; // Resource requirements for this item
  onUpdatePractitionerAssignments: (practitionerIds: number[]) => void;
  onUpdateBillingScenarios: (key: string, scenarios: BillingScenario[]) => void;
  onUpdateResourceRequirements: (requirements: ResourceRequirement[]) => void;
  updateResourceRequirements: (serviceItemId: number, requirements: ResourceRequirement[]) => void; // Direct store function
  clinicInfoAvailability?: {
    has_address?: boolean;
    has_phone?: boolean;
  };
}

export const ServiceItemEditModal: React.FC<ServiceItemEditModalProps> = ({
  appointmentType,
  isOpen,
  onClose,
  onUpdate,
  onDelete,
  members,
  isClinicAdmin,
  availableGroups,
  practitionerAssignments: currentPractitionerAssignments,
  billingScenarios: allBillingScenarios,
  resourceRequirements: _currentResourceRequirements,
  clinicInfoAvailability,
  onUpdatePractitionerAssignments,
  onUpdateBillingScenarios,
  onUpdateResourceRequirements: _onUpdateResourceRequirements,
  updateResourceRequirements,
}) => {
  const {
    loadBillingScenarios,
    loadingScenarios,
    billingScenarios: mainStoreBillingScenarios,
  } = useServiceItemsStore();
  
  const { confirm } = useModal();
  
  // Get billing scenarios for current item
  // Priority: staging store (for newly created/edited scenarios) > main store (for loaded scenarios)
  // This ensures newly created scenarios are visible immediately
  const getBillingScenariosForItem = (practitionerId: number) => {
    const key = `${appointmentType.id}-${practitionerId}`;
    // Check staging store first (for newly created scenarios not yet saved)
    const stagingScenarios = allBillingScenarios[key];
    // Fall back to main store (where loadBillingScenarios stores data from API)
    const mainStoreScenarios = mainStoreBillingScenarios[key];
    // Prefer staging if it exists (has new/edited scenarios), otherwise use main store
    const scenarios = stagingScenarios !== undefined ? stagingScenarios : (mainStoreScenarios || []);
    return scenarios;
  };
  
  // Get assigned practitioner IDs
  const assignedPractitionerIds = currentPractitionerAssignments;

  const methods = useForm<ServiceItemFormData>({
    resolver: zodResolver(ServiceItemFormSchema),
    defaultValues: {
      id: appointmentType.id,
      clinic_id: appointmentType.clinic_id,
      name: appointmentType.name || '',
      duration_minutes: appointmentType.duration_minutes || 30,
      receipt_name: appointmentType.receipt_name || null,
      allow_patient_booking: appointmentType.allow_patient_booking ?? true, // DEPRECATED
      allow_new_patient_booking: appointmentType.allow_new_patient_booking ?? true,
      allow_existing_patient_booking: appointmentType.allow_existing_patient_booking ?? true,
      allow_patient_practitioner_selection: appointmentType.allow_patient_practitioner_selection ?? true,
      allow_multiple_time_slot_selection: appointmentType.allow_multiple_time_slot_selection ?? false,
      description: appointmentType.description || null,
      scheduling_buffer_minutes: appointmentType.scheduling_buffer_minutes || 0,
      service_type_group_id: appointmentType.service_type_group_id || null,
      display_order: appointmentType.display_order || 0,
      require_notes: appointmentType.require_notes ?? false,
      notes_instructions: appointmentType.notes_instructions || null,
    },
    mode: 'onBlur',
  });

  const { watch, register, setValue, formState: { isDirty, errors }, reset, trigger, getValues } = methods;
  
  // Watch specific fields to avoid infinite loops from watch() returning new object references
  const name = watch('name');
  const duration_minutes = watch('duration_minutes');
  const receipt_name = watch('receipt_name');
  const allow_patient_booking = watch('allow_patient_booking'); // DEPRECATED
  const allow_new_patient_booking = watch('allow_new_patient_booking');
  const allow_existing_patient_booking = watch('allow_existing_patient_booking');
  const allow_patient_practitioner_selection = watch('allow_patient_practitioner_selection');
  const allow_multiple_time_slot_selection = watch('allow_multiple_time_slot_selection');
  const description = watch('description');
  const scheduling_buffer_minutes = watch('scheduling_buffer_minutes');
  const service_type_group_id = watch('service_type_group_id');
  const display_order = watch('display_order');
  const require_notes = watch('require_notes');
  const notes_instructions = watch('notes_instructions');

  // Track previous appointmentType ID to detect when switching items
  const previousAppointmentTypeIdRef = useRef<number | undefined>(appointmentType?.id);
  
  // Reset form only when appointmentType ID changes (switching items), not when fields change
  useEffect(() => {
    const currentId = appointmentType?.id;
    const previousId = previousAppointmentTypeIdRef.current;
    
    // Only reset if:
    // 1. Modal is open
    // 2. AppointmentType exists
    // 3. ID actually changed (switching to different item)
    if (isOpen && appointmentType && currentId !== previousId) {
      reset({
        id: appointmentType.id,
        clinic_id: appointmentType.clinic_id,
        name: appointmentType.name || '',
        duration_minutes: appointmentType.duration_minutes || 30,
        receipt_name: appointmentType.receipt_name || null,
        allow_patient_booking: appointmentType.allow_patient_booking ?? true, // DEPRECATED
        allow_new_patient_booking: appointmentType.allow_new_patient_booking ?? true,
        allow_existing_patient_booking: appointmentType.allow_existing_patient_booking ?? true,
        allow_patient_practitioner_selection: appointmentType.allow_patient_practitioner_selection ?? true,
      allow_multiple_time_slot_selection: appointmentType.allow_multiple_time_slot_selection ?? false,
        description: appointmentType.description || null,
        scheduling_buffer_minutes: appointmentType.scheduling_buffer_minutes || 0,
        service_type_group_id: appointmentType.service_type_group_id || null,
        display_order: appointmentType.display_order || 0,
        require_notes: appointmentType.require_notes ?? false,
        notes_instructions: appointmentType.notes_instructions || null,
      });
      previousAppointmentTypeIdRef.current = currentId;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, appointmentType?.id, reset]);

  // Load billing scenarios for ALL practitioners when modal opens
  // Scenarios are independent of PAT assignment, so we show them regardless
  useEffect(() => {
    if (isOpen) {
      // Load scenarios for all practitioners, not just assigned ones
      members.forEach(practitioner => {
        const key = `${appointmentType.id}-${practitioner.id}`;
        const mainStoreScenarios = mainStoreBillingScenarios[key];
        const isCurrentlyLoading = loadingScenarios.has(key);
        // Only load if not in main store and not currently loading (prevent duplicate loads)
        if (!mainStoreScenarios && !isCurrentlyLoading) {
          loadBillingScenarios(appointmentType.id, practitioner.id);
        }
      });
    }
  }, [isOpen, appointmentType.id, loadBillingScenarios, mainStoreBillingScenarios, loadingScenarios, members]);

  const handleGroupChange = (groupId: number | null) => {
    setValue('service_type_group_id', groupId, { shouldDirty: true });
  };

  // Info modals
  const [showDurationModal, setShowDurationModal] = useState(false);
  const [showBufferModal, setShowBufferModal] = useState(false);
  const [showAllowNewPatientBookingModal, setShowAllowNewPatientBookingModal] = useState(false);
  const [showAllowExistingPatientBookingModal, setShowAllowExistingPatientBookingModal] = useState(false);
  const [showReceiptNameModal, setShowReceiptNameModal] = useState(false);
  const [showBillingScenarioModal, setShowBillingScenarioModal] = useState(false);

  // Billing scenario editing
  const [editingScenario, setEditingScenario] = useState<{ practitionerId: number; scenarioId?: number } | null>(null);
  const [scenarioForm, setScenarioForm] = useState({ name: '', amount: '', revenue_share: '', is_default: false });
  const [scenarioErrors, setScenarioErrors] = useState<{ name?: string; amount?: string; revenue_share?: string }>({});

  const handleAddScenario = (practitionerId: number) => {
    setEditingScenario({ practitionerId });
    setScenarioForm({ name: '', amount: '', revenue_share: '', is_default: false });
    setScenarioErrors({});
  };

  const handleEditScenario = (practitionerId: number, scenario: BillingScenario) => {
    setEditingScenario({ practitionerId, scenarioId: scenario.id });
    const normalizedAmount = typeof scenario.amount === 'string' ? parseFloat(scenario.amount) : scenario.amount;
    const normalizedRevenueShare = typeof scenario.revenue_share === 'string' ? parseFloat(scenario.revenue_share) : scenario.revenue_share;
    setScenarioForm({
      name: scenario.name,
      amount: isNaN(normalizedAmount) ? '' : normalizedAmount.toString(),
      revenue_share: isNaN(normalizedRevenueShare) ? '' : normalizedRevenueShare.toString(),
      is_default: scenario.is_default,
    });
    setScenarioErrors({});
  };

  const handleConfirmScenario = () => {
    if (!editingScenario) return;
    const { practitionerId, scenarioId } = editingScenario;
    
    // Clear previous errors
    const errors: { name?: string; amount?: string; revenue_share?: string } = {};
    
    // Validate name
    if (!scenarioForm.name || scenarioForm.name.trim() === '') {
      errors.name = '方案名稱不能為空';
    }
    
    // Validate amount
    if (!scenarioForm.amount || scenarioForm.amount.trim() === '') {
      errors.amount = '金額不能為空';
    } else {
      const amount = parseFloat(scenarioForm.amount);
      if (isNaN(amount) || amount <= 0) {
        errors.amount = '金額必須大於 0';
      }
    }
    
    // Validate revenue_share
    if (!scenarioForm.revenue_share || scenarioForm.revenue_share.trim() === '') {
      errors.revenue_share = '診所分潤不能為空';
    } else {
      const revenue_share = parseFloat(scenarioForm.revenue_share);
      const amount = parseFloat(scenarioForm.amount);
      if (isNaN(revenue_share) || revenue_share < 0) {
        errors.revenue_share = '診所分潤不能小於 0';
      } else if (!isNaN(amount) && revenue_share > amount) {
        errors.revenue_share = '診所分潤不能大於金額';
      }
    }
    
    // If there are errors, show them and scroll to first error
    if (Object.keys(errors).length > 0) {
      setScenarioErrors(errors);
      // Scroll to first error field
      const firstErrorField = Object.keys(errors)[0];
      const errorElement = document.querySelector(`[name="scenario_${firstErrorField}"]`);
      if (errorElement) {
        errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        (errorElement as HTMLElement).focus();
      }
      return;
    }
    
    // Clear errors if validation passes
    setScenarioErrors({});
    
    const amount = parseFloat(scenarioForm.amount);
    const revenue_share = parseFloat(scenarioForm.revenue_share);

    const key = `${appointmentType.id}-${practitionerId}`;
    // Use getBillingScenariosForItem to get current scenarios (handles both stores)
    const currentScenarios = getBillingScenariosForItem(practitionerId);
    
    if (scenarioId) {
      const updatedScenarios = currentScenarios.map((s: BillingScenario) => 
        s.id === scenarioId 
          ? { ...s, name: scenarioForm.name, amount, revenue_share, is_default: scenarioForm.is_default }
          : scenarioForm.is_default ? { ...s, is_default: false } : s
      );
      onUpdateBillingScenarios(key, updatedScenarios);
    } else {
      const newScenario: BillingScenario = {
        id: -Date.now(),
        practitioner_id: practitionerId,
        appointment_type_id: appointmentType.id,
        clinic_id: appointmentType.clinic_id,
        name: scenarioForm.name,
        amount,
        revenue_share,
        is_default: scenarioForm.is_default,
      };
      const updatedScenarios = scenarioForm.is_default
        ? [...currentScenarios.map((s: BillingScenario) => ({ ...s, is_default: false })), newScenario]
        : [...currentScenarios, newScenario];
      onUpdateBillingScenarios(key, updatedScenarios);
    }
    setEditingScenario(null);
    setScenarioForm({ name: '', amount: '', revenue_share: '', is_default: false });
    setScenarioErrors({});
  };

  // Update staging store when form changes - use refs to prevent infinite loops
  const lastValuesRef = useRef<string>('');
  const isUpdatingRef = useRef(false);
  
  useEffect(() => {
    // Update staging store when form values change, even if not dirty yet
    // This ensures changes are reflected immediately in the table
    if (!isUpdatingRef.current) {
      const currentValues = JSON.stringify({
        name,
        duration_minutes,
        receipt_name,
        allow_patient_booking,
        allow_new_patient_booking,
        allow_existing_patient_booking,
        allow_patient_practitioner_selection,
        allow_multiple_time_slot_selection,
        description,
        scheduling_buffer_minutes,
        service_type_group_id,
        display_order,
        require_notes,
        notes_instructions,
      });
      
      // Only update if values actually changed
      if (currentValues !== lastValuesRef.current) {
        isUpdatingRef.current = true;
        lastValuesRef.current = currentValues;
        
        const updatedItem: AppointmentType = {
          ...appointmentType,
          name,
          duration_minutes,
          receipt_name,
          allow_patient_booking,
          allow_new_patient_booking,
          allow_existing_patient_booking,
          allow_patient_practitioner_selection,
          allow_multiple_time_slot_selection,
          description,
          scheduling_buffer_minutes,
          service_type_group_id,
          display_order,
          require_notes,
          notes_instructions,
        };
        
        // Use setTimeout to break the update cycle
        setTimeout(() => {
          onUpdate(updatedItem);
          isUpdatingRef.current = false;
        }, 0);
      }
    }
  }, [name, duration_minutes, receipt_name, allow_patient_booking, 
      allow_patient_practitioner_selection, description, scheduling_buffer_minutes,
      service_type_group_id, display_order, require_notes, notes_instructions, isDirty, appointmentType, onUpdate]);

  const handleCancel = () => {
    // Reset form to original values
    reset({
      id: appointmentType.id,
      clinic_id: appointmentType.clinic_id,
      name: appointmentType.name || '',
      duration_minutes: appointmentType.duration_minutes || 30,
      receipt_name: appointmentType.receipt_name || null,
      allow_patient_booking: appointmentType.allow_patient_booking ?? true, // DEPRECATED
      allow_new_patient_booking: appointmentType.allow_new_patient_booking ?? true,
      allow_existing_patient_booking: appointmentType.allow_existing_patient_booking ?? true,
      allow_patient_practitioner_selection: appointmentType.allow_patient_practitioner_selection ?? true,
      allow_multiple_time_slot_selection: appointmentType.allow_multiple_time_slot_selection ?? false,
      description: appointmentType.description || null,
      scheduling_buffer_minutes: appointmentType.scheduling_buffer_minutes || 0,
      service_type_group_id: appointmentType.service_type_group_id || null,
      display_order: appointmentType.display_order || 0,
      require_notes: appointmentType.require_notes ?? false,
      notes_instructions: appointmentType.notes_instructions || null,
    });
    onClose();
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    
    // Confirm deletion using custom modal
    const confirmed = await confirm(
      `確定要刪除「${appointmentType.name}」嗎？`,
      '刪除服務項目'
    );
    if (!confirmed) return;
    
    await onDelete(appointmentType);
    onClose();
  };

  const [messageValidationErrors, setMessageValidationErrors] = useState<string[]>([]);

  const handleConfirm = async () => {
    // Validate all fields
    const isValid = await trigger();
    
    if (!isValid) {
      // Find first error field and scroll to it
      const errorFields = Object.keys(errors);
      if (errorFields.length > 0) {
        const firstErrorField = errorFields[0];
        const errorElement = document.querySelector(`[name="${firstErrorField}"]`);
        if (errorElement) {
          errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (errorElement as HTMLElement).focus();
        }
      }
      return;
    }

    // Validate message fields (managed outside form)
    const messageErrors: string[] = [];
    if (appointmentType.send_patient_confirmation && (!appointmentType.patient_confirmation_message || !appointmentType.patient_confirmation_message.trim())) {
      messageErrors.push('病患確認訊息：當開關開啟時，訊息模板為必填');
    }
    if (appointmentType.send_patient_confirmation && appointmentType.patient_confirmation_message && appointmentType.patient_confirmation_message.length > 3500) {
      messageErrors.push('病患確認訊息：訊息模板長度不能超過 3500 字元');
    }
    if (appointmentType.send_clinic_confirmation && (!appointmentType.clinic_confirmation_message || !appointmentType.clinic_confirmation_message.trim())) {
      messageErrors.push('診所確認訊息：當開關開啟時，訊息模板為必填');
    }
    if (appointmentType.send_clinic_confirmation && appointmentType.clinic_confirmation_message && appointmentType.clinic_confirmation_message.length > 3500) {
      messageErrors.push('診所確認訊息：訊息模板長度不能超過 3500 字元');
    }
    if (appointmentType.send_reminder && (!appointmentType.reminder_message || !appointmentType.reminder_message.trim())) {
      messageErrors.push('提醒訊息：當開關開啟時，訊息模板為必填');
    }
    if (appointmentType.send_reminder && appointmentType.reminder_message && appointmentType.reminder_message.length > 3500) {
      messageErrors.push('提醒訊息：訊息模板長度不能超過 3500 字元');
    }

    if (messageErrors.length > 0) {
      setMessageValidationErrors(messageErrors);
      // Scroll to message settings section and expand it
      const messageSection = document.querySelector('[data-message-settings]');
      if (messageSection) {
        messageSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Try to expand the section with the first error
        // Parse error message to find which message type has the error
        const firstError = messageErrors[0];
        if (firstError) {
          let targetType: string | null = null;
          if (firstError.includes('病患確認訊息')) {
            targetType = 'patient_confirmation';
          } else if (firstError.includes('診所確認訊息')) {
            targetType = 'clinic_confirmation';
          } else if (firstError.includes('提醒訊息')) {
            targetType = 'reminder';
          }
          
          if (targetType) {
            const errorSection = messageSection.querySelector(`[data-message-type="${targetType}"]`);
            if (errorSection) {
              // Find the button to expand the section
              const sectionButton = errorSection.querySelector('button');
              if (sectionButton) {
                // Check if section is collapsed by checking if content is hidden
                const sectionContent = errorSection.querySelector('[class*="p-4"]');
                if (!sectionContent || !sectionContent.parentElement?.classList.contains('block')) {
                  (sectionButton as HTMLElement).click();
                }
              }
            }
          } else {
            // Fallback: expand first section
            const firstErrorSection = messageSection.querySelector('[data-message-type]');
            if (firstErrorSection) {
              const sectionButton = firstErrorSection.querySelector('button');
              if (sectionButton) {
                (sectionButton as HTMLElement).click();
              }
            }
          }
        }
      }
      return;
    }

    setMessageValidationErrors([]);

    // Get current form values and update staging store
    const currentValues = getValues();
    const updatedItem: AppointmentType = {
      ...appointmentType,
      name: currentValues.name || '',
      duration_minutes: currentValues.duration_minutes,
      receipt_name: currentValues.receipt_name || null,
      allow_patient_booking: currentValues.allow_patient_booking ?? true,
      allow_patient_practitioner_selection: currentValues.allow_patient_practitioner_selection ?? true,
      allow_multiple_time_slot_selection: currentValues.allow_multiple_time_slot_selection ?? false,
      description: currentValues.description || null,
      scheduling_buffer_minutes: currentValues.scheduling_buffer_minutes || 0,
      service_type_group_id: currentValues.service_type_group_id || null,
      display_order: currentValues.display_order || 0,
      require_notes: currentValues.require_notes ?? false,
      notes_instructions: currentValues.notes_instructions || null,
      // Include message fields from appointmentType (updated by MessageSettingsSection)
      send_patient_confirmation: appointmentType.send_patient_confirmation,
      send_clinic_confirmation: appointmentType.send_clinic_confirmation,
      send_reminder: appointmentType.send_reminder,
      patient_confirmation_message: appointmentType.patient_confirmation_message,
      clinic_confirmation_message: appointmentType.clinic_confirmation_message,
      reminder_message: appointmentType.reminder_message,
      // Include follow-up messages from appointmentType (updated by FollowUpMessagesSection)
      follow_up_messages: appointmentType.follow_up_messages ?? [],
    };
    
    // Update staging store with final values
    onUpdate(updatedItem);
    
    // Close modal after successful validation (pass true to indicate it was confirmed)
    onClose(true);
  };

  if (!isOpen) return null;

  return (
    <FormProvider {...methods}>
      <BaseModal
        onClose={handleCancel}
        aria-label="編輯服務項目"
        fullScreen={true}
        showCloseButton={false}
        className="p-0"
      >
        <div className="flex flex-col h-full overflow-y-auto">
          {/* Header matching settings pages */}
          <div className="bg-white border-b border-gray-200 px-4 py-4 md:px-6">
            <div className="max-w-7xl mx-auto">
              <div className="flex justify-between items-center mb-2 md:mb-8">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="inline-flex items-center justify-center w-8 h-8 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
                    aria-label="返回"
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                    {name || '編輯服務項目'}
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  {isClinicAdmin && onDelete && !isTemporaryServiceItemId(appointmentType.id) && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="text-red-600 hover:text-red-800 text-sm px-4 py-2 rounded border border-red-200 hover:border-red-300"
                    >
                      刪除項目
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className="btn-primary text-sm px-4 py-2"
                  >
                    確認編輯
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <main className="flex-1 bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 py-6 md:px-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                
                {/* Left Column: Basic Info */}
                <div className="space-y-4 md:space-y-6">
                  <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
                    <div className="px-4 py-4 md:px-0 md:py-0 space-y-4 md:space-y-5">
                      <FormField name="name" label="項目名稱">
                        <FormInput name="name" placeholder="例如：初診評估" disabled={!isClinicAdmin} />
                      </FormField>

                      <FormField name="receipt_name" label="收據項目名稱">
                        <div className="flex items-center gap-2">
                          <FormInput name="receipt_name" placeholder={name || '例如：初診評估'} disabled={!isClinicAdmin} />
                          <InfoButton onClick={() => setShowReceiptNameModal(true)} />
                        </div>
                      </FormField>

                      {isClinicAdmin && (
                        <FormField name="service_type_group_id" label="群組">
                          <div className="space-y-2">
                            <select
                              value={service_type_group_id || ''}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === '') {
                                  handleGroupChange(null);
                                } else {
                                  handleGroupChange(Number(value));
                                }
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 transition-shadow"
                              disabled={!isClinicAdmin}
                            >
                              <option value="">未分類</option>
                              {availableGroups.map((group) => (
                                <option key={group.id} value={group.id}>
                                  {group.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </FormField>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormField name="duration_minutes" label="服務時長 (分鐘)">
                          <div className="flex items-center gap-2">
                            <FormInput name="duration_minutes" type="number" min="15" max="480" disabled={!isClinicAdmin} onWheel={preventScrollWheelChange} />
                            <InfoButton onClick={() => setShowDurationModal(true)} />
                          </div>
                        </FormField>
                        <FormField name="scheduling_buffer_minutes" label="排程緩衝時間 (分鐘)">
                          <div className="flex items-center gap-2">
                            <FormInput name="scheduling_buffer_minutes" type="number" min="0" max="60" disabled={!isClinicAdmin} onWheel={preventScrollWheelChange} />
                            <InfoButton onClick={() => setShowBufferModal(true)} />
                          </div>
                        </FormField>
                      </div>

                      <FormField 
                        name="description" 
                        label={
                          <div className="flex items-center gap-2">
                            <span>說明</span>
                            {!allow_new_patient_booking && !allow_existing_patient_booking && (
                              <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                                <span className="text-amber-600 hover:text-amber-700 cursor-pointer">⚠️</span>
                              </WarningPopover>
                            )}
                          </div>
                        }
                      >
                        <FormTextarea name="description" placeholder="服務說明（顯示在 LINE 預約系統）" rows={4} disabled={!isClinicAdmin} className="resize-none" />
                      </FormField>

                      {/* LIFF booking options and notes customization */}
                      <div className="pt-4">
                        <div className="flex flex-col gap-3">
                          <label className="flex items-center cursor-pointer">
                            <input type="checkbox" {...register('allow_new_patient_booking')} className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 mr-3" disabled={!isClinicAdmin} />
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-gray-900">新病患可自行預約</span>
                              <span className="text-xs text-gray-500">新病患可透過 LINE 預約系統看到並選擇此服務</span>
                            </div>
                            <InfoButton onClick={() => setShowAllowNewPatientBookingModal(true)} />
                          </label>
                          <label className="flex items-center cursor-pointer">
                            <input type="checkbox" {...register('allow_existing_patient_booking')} className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 mr-3" disabled={!isClinicAdmin} />
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-gray-900">舊病患可自行預約</span>
                              <span className="text-xs text-gray-500">舊病患可透過 LINE 預約系統看到並選擇此服務</span>
                            </div>
                            <InfoButton onClick={() => setShowAllowExistingPatientBookingModal(true)} />
                          </label>
                          <label className="flex items-center cursor-pointer">
                            <input type="checkbox" {...register('allow_patient_practitioner_selection')} className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 mr-3" disabled={!isClinicAdmin} />
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-gray-900">開放病患指定治療師</span>
                              <span className="text-xs text-gray-500">病患預約時可自由選擇想看診的治療師</span>
                            </div>
                            {!allow_new_patient_booking && !allow_existing_patient_booking && (
                              <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                                <span className="ml-2 text-amber-600 hover:text-amber-700">⚠️</span>
                              </WarningPopover>
                            )}
                          </label>
                          <label className="flex items-center cursor-pointer">
                            <input type="checkbox" {...register('allow_multiple_time_slot_selection')} className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 mr-3" disabled={!isClinicAdmin} />
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-gray-900">允許患者選擇多個時段</span>
                              <span className="text-xs text-gray-500">病患預約時可選擇多個偏好時段供診所確認</span>
                            </div>
                            {!allow_new_patient_booking && !allow_existing_patient_booking && (
                              <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                                <span className="ml-2 text-amber-600 hover:text-amber-700">⚠️</span>
                              </WarningPopover>
                            )}
                          </label>
                          <FormField name="require_notes" label="">
                            <label className="flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                {...register('require_notes')}
                                className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 mr-3"
                                disabled={!isClinicAdmin}
                              />
                              <div className="flex flex-col">
                                <span className="text-sm font-medium text-gray-900">要求填寫備註</span>
                                <span className="text-xs text-gray-500">病患透過Line自行預約此服務時必須填寫備註</span>
                              </div>
                              {!allow_new_patient_booking && !allow_existing_patient_booking && (
                                <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                                  <span className="ml-2 text-amber-600 hover:text-amber-700">⚠️</span>
                                </WarningPopover>
                              )}
                            </label>
                          </FormField>
                        </div>
                      </div>
                      <FormField 
                        name="notes_instructions" 
                        label={
                          <div className="flex items-center gap-2">
                            <span>備註填寫指引</span>
                            {!allow_new_patient_booking && !allow_existing_patient_booking && (
                              <WarningPopover message="此服務項目未開放病患自行預約，此設定不會生效。">
                                <span className="text-amber-600 hover:text-amber-700 cursor-pointer">⚠️</span>
                              </WarningPopover>
                            )}
                          </div>
                        }
                      >
                        <FormTextarea
                          name="notes_instructions"
                          placeholder="病患在透過Line預約，填寫備註時，將會看到此指引（若未填寫，將使用「預約設定」頁面中的「備註填寫指引」）"
                          rows={4}
                          disabled={!isClinicAdmin}
                          className="resize-none"
                        />
                      </FormField>
                    </div>
                  </div>

                  <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
                    <div className="px-4 py-4 md:px-0 md:py-0 space-y-4 md:space-y-6">

                      {isClinicAdmin && (
                        <ResourceRequirementsSection
                          appointmentTypeId={appointmentType.id}
                          isClinicAdmin={isClinicAdmin}
                          currentResourceRequirements={_currentResourceRequirements}
                          updateResourceRequirements={updateResourceRequirements}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: Practitioners & Billing */}
                <div className="space-y-4 md:space-y-6">
                  {isClinicAdmin && (
                    <MessageSettingsSection
                      appointmentType={appointmentType}
                      onUpdate={onUpdate}
                      disabled={!isClinicAdmin}
                      {...(clinicInfoAvailability !== undefined && { clinicInfoAvailability })}
                    />
                  )}
                  {messageValidationErrors.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="text-sm font-medium text-red-800 mb-2">請修正以下錯誤：</div>
                      <ul className="list-disc list-inside space-y-1 text-sm text-red-700">
                        {messageValidationErrors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {isClinicAdmin && (
                    <FollowUpMessagesSection
                      appointmentType={appointmentType}
                      onUpdate={onUpdate}
                      disabled={!isClinicAdmin}
                      {...(clinicInfoAvailability !== undefined && { clinicInfoAvailability })}
                    />
                  )}
                  
                  <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
                      <div className="px-4 py-4 md:px-0 md:py-0">
                        <p className="text-sm text-gray-600 mb-4">
                          選擇提供此服務的治療師，並為每位治療師設定計費方案。
                        </p>
                        
                        <div className="space-y-4 md:space-y-6">
                        {members.map(practitioner => {
                          const isAssigned = assignedPractitionerIds.includes(practitioner.id);
                          const key = `${appointmentType.id}-${practitioner.id}`;
                          const scenarios = getBillingScenariosForItem(practitioner.id);
                          const isLoading = loadingScenarios.has(key);

                          return (
                            <div key={practitioner.id} className={`p-3 md:p-4 rounded-lg border transition-all ${isAssigned ? 'bg-blue-50/50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
                              <div className="flex items-center space-x-3 mb-2">
                                <input
                                  type="checkbox"
                                  checked={isAssigned}
                                  onChange={(e) => {
                                    const shouldAssign = e.target.checked;
                                    if (shouldAssign) {
                                      onUpdatePractitionerAssignments([...assignedPractitionerIds, practitioner.id]);
                                    } else {
                                      onUpdatePractitionerAssignments(assignedPractitionerIds.filter((id: number) => id !== practitioner.id));
                                    }
                                    // Don't clear billing scenarios - they're independent of PAT assignment
                                  }}
                                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                />
                                <span className="text-sm font-medium text-gray-900">{practitioner.full_name}</span>
                              </div>
                              
                              {/* Always show billing scenarios section, regardless of assignment */}
                              <div className="mt-3 pl-7 space-y-3">
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-2">
                                    <label className="text-xs font-medium text-gray-700">計費方案</label>
                                    {!isAssigned && (
                                      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                                        治療師尚未指派到此服務項目
                                      </span>
                                    )}
                                    <InfoButton onClick={() => setShowBillingScenarioModal(true)} />
                                  </div>
                                  <button 
                                    type="button" 
                                    onClick={() => handleAddScenario(practitioner.id)} 
                                    className="text-xs text-blue-600 hover:text-blue-800"
                                  >
                                    + 新增方案
                                  </button>
                                </div>
                                
                                {isLoading ? (
                                  <p className="text-xs text-gray-500">載入中...</p>
                                ) : scenarios.length === 0 ? (
                                  <p className="text-xs text-gray-500">尚無計費方案</p>
                                ) : (
                                  <div className="space-y-2">
                                    {scenarios.map((scenario: BillingScenario) => (
                                      <div key={scenario.id} className="flex items-center justify-between bg-white p-2 rounded border border-gray-200">
                                        <div className="flex-1">
                                          <div className="flex items-center space-x-2">
                                            <span className="text-sm font-medium text-gray-900">{scenario.name}</span>
                                            {scenario.is_default && <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">預設</span>}
                                          </div>
                                          <div className="text-xs text-gray-600 mt-1">
                                            金額: {formatCurrency(scenario.amount)} | 診所分潤: {formatCurrency(scenario.revenue_share)}
                                          </div>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                          <button type="button" onClick={() => handleEditScenario(practitioner.id, scenario)} className="text-xs text-blue-600 hover:text-blue-800">編輯</button>
                                          <button type="button" onClick={() => onUpdateBillingScenarios(key, scenarios.filter((s: BillingScenario) => s.id !== scenario.id))} className="text-xs text-red-600 hover:text-red-800">刪除</button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        </div>
                      </div>
                  </div>
                </div>
              </div>
            </div>
          </main>

          {/* Mobile Footer */}
          <div className="md:hidden sticky bottom-0 z-10 bg-white border-t border-gray-200 px-4 py-4 shadow-sm">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCancel}
                className="btn-secondary flex-1 text-sm px-4 py-2"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      </BaseModal>

      {/* Billing Scenario Edit Modal */}
      {editingScenario && (
        <BaseModal onClose={() => {
          setEditingScenario(null);
          setScenarioErrors({});
        }} aria-label="編輯計費方案">
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">{editingScenario.scenarioId ? '編輯' : '新增'}計費方案</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">方案名稱</label>
                <input
                  name="scenario_name"
                  type="text"
                  value={scenarioForm.name}
                  onChange={(e) => {
                    setScenarioForm(prev => ({ ...prev, name: e.target.value }));
                    if (scenarioErrors.name) {
                      setScenarioErrors(prev => {
                        const { name, ...rest } = prev;
                        return rest;
                      });
                    }
                  }}
                  className={`input ${scenarioErrors.name ? 'border-red-500' : ''}`}
                  placeholder="例如：原價、九折、會員價"
                />
                {scenarioErrors.name && (
                  <p className="text-red-600 text-xs mt-1">{scenarioErrors.name}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">金額</label>
                  <input
                    name="scenario_amount"
                    type="number"
                    value={scenarioForm.amount}
                    onChange={(e) => {
                      setScenarioForm(prev => ({ ...prev, amount: e.target.value }));
                      if (scenarioErrors.amount) {
                        setScenarioErrors(prev => {
                          const { amount, ...rest } = prev;
                          return rest;
                        });
                      }
                    }}
                    className={`input ${scenarioErrors.amount ? 'border-red-500' : ''}`}
                    min="0"
                    placeholder="0"
                    onWheel={preventScrollWheelChange}
                  />
                  {scenarioErrors.amount && (
                    <p className="text-red-600 text-xs mt-1">{scenarioErrors.amount}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">診所分潤</label>
                  <input
                    name="scenario_revenue_share"
                    type="number"
                    value={scenarioForm.revenue_share}
                    onChange={(e) => {
                      setScenarioForm(prev => ({ ...prev, revenue_share: e.target.value }));
                      if (scenarioErrors.revenue_share) {
                        setScenarioErrors(prev => {
                          const { revenue_share, ...rest } = prev;
                          return rest;
                        });
                      }
                    }}
                    className={`input ${scenarioErrors.revenue_share ? 'border-red-500' : ''}`}
                    min="0"
                    placeholder="0"
                    onWheel={preventScrollWheelChange}
                  />
                  {scenarioErrors.revenue_share && (
                    <p className="text-red-600 text-xs mt-1">{scenarioErrors.revenue_share}</p>
                  )}
                </div>
              </div>
              <label className="flex items-center">
                <input type="checkbox" checked={scenarioForm.is_default} onChange={(e) => setScenarioForm(prev => ({ ...prev, is_default: e.target.checked }))} className="mr-2" />
                <span className="text-sm font-medium text-gray-700">設為預設方案</span>
              </label>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setEditingScenario(null);
                  setScenarioErrors({});
                }}
                className="btn-secondary"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmScenario}
                className="btn-primary"
              >
                確認
              </button>
            </div>
          </div>
        </BaseModal>
      )}

      {/* Info Modals */}
      <InfoModal isOpen={showDurationModal} onClose={() => setShowDurationModal(false)} title="服務時長 (分鐘)">
        <p>此為實際服務時間長度...</p>
      </InfoModal>
      <InfoModal isOpen={showBufferModal} onClose={() => setShowBufferModal(false)} title="排程緩衝時間 (分鐘)">
        <p>此為排程時額外保留的時間...</p>
      </InfoModal>
      <InfoModal isOpen={showReceiptNameModal} onClose={() => setShowReceiptNameModal(false)} title="收據項目名稱">
        <p>此名稱會顯示在收據上，取代服務項目名稱...</p>
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
    </FormProvider>
  );
};

