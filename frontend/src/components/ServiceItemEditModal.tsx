import React, { useState, useEffect, useRef } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AppointmentType, Member, BillingScenario, ServiceTypeGroup, ResourceRequirement } from '../types';
import { preventScrollWheelChange } from '../utils/inputUtils';
import { formatCurrency } from '../utils/currencyUtils';
import { BaseModal } from './shared/BaseModal';
import { InfoButton, InfoModal } from './shared';
import { useServiceItemsStore } from '../stores/serviceItemsStore';
import { ResourceRequirementsSection } from './ResourceRequirementsSection';
import { FormField, FormInput, FormTextarea } from './forms';
import { useModal } from '../contexts/ModalContext';

// Schema for single appointment type
const ServiceItemFormSchema = z.object({
  id: z.number(),
  clinic_id: z.number(),
  name: z.string().min(1, '項目名稱不能為空'),
  duration_minutes: z.coerce.number().min(15, '時長至少需 15 分鐘').max(480, '時長最多 480 分鐘'),
  receipt_name: z.string().nullable().optional(),
  allow_patient_booking: z.boolean().optional(),
  allow_patient_practitioner_selection: z.boolean().optional(),
  description: z.string().nullable().optional(),
  scheduling_buffer_minutes: z.coerce.number().min(0).max(60).optional(),
  service_type_group_id: z.number().nullable().optional(),
  display_order: z.number().optional(),
});

type ServiceItemFormData = z.infer<typeof ServiceItemFormSchema>;

interface ServiceItemEditModalProps {
  appointmentType: AppointmentType;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (updatedItem: AppointmentType) => void; // Synchronous update to staging store
  members: Member[];
  isClinicAdmin: boolean;
  availableGroups: ServiceTypeGroup[]; // Groups from staging store (includes temporary ones)
  practitionerAssignments: number[]; // Current assignments for this item
  billingScenarios: Record<string, BillingScenario[]>; // All billing scenarios
  resourceRequirements: ResourceRequirement[]; // Resource requirements for this item
  onUpdatePractitionerAssignments: (practitionerIds: number[]) => void;
  onUpdateBillingScenarios: (key: string, scenarios: BillingScenario[]) => void;
  onUpdateResourceRequirements: (requirements: ResourceRequirement[]) => void;
}

export const ServiceItemEditModal: React.FC<ServiceItemEditModalProps> = ({
  appointmentType,
  isOpen,
  onClose,
  onUpdate,
  members,
  isClinicAdmin,
  availableGroups,
  practitionerAssignments: currentPractitionerAssignments,
  billingScenarios: allBillingScenarios,
  resourceRequirements: _currentResourceRequirements,
  onUpdatePractitionerAssignments,
  onUpdateBillingScenarios,
  onUpdateResourceRequirements: _onUpdateResourceRequirements,
}) => {
  const { alert } = useModal();

  const {
    loadBillingScenarios,
    loadingScenarios,
  } = useServiceItemsStore();
  
  // Get billing scenarios for current item
  const getBillingScenariosForItem = (practitionerId: number) => {
    const key = `${appointmentType.id}-${practitionerId}`;
    return allBillingScenarios[key] || [];
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
      allow_patient_booking: appointmentType.allow_patient_booking ?? true,
      allow_patient_practitioner_selection: appointmentType.allow_patient_practitioner_selection ?? true,
      description: appointmentType.description || null,
      scheduling_buffer_minutes: appointmentType.scheduling_buffer_minutes || 0,
      service_type_group_id: appointmentType.service_type_group_id || null,
      display_order: appointmentType.display_order || 0,
    },
    mode: 'onBlur',
  });

  const { watch, register, setValue, formState: { isDirty }, reset } = methods;
  
  // Watch specific fields to avoid infinite loops from watch() returning new object references
  const name = watch('name');
  const duration_minutes = watch('duration_minutes');
  const receipt_name = watch('receipt_name');
  const allow_patient_booking = watch('allow_patient_booking');
  const allow_patient_practitioner_selection = watch('allow_patient_practitioner_selection');
  const description = watch('description');
  const scheduling_buffer_minutes = watch('scheduling_buffer_minutes');
  const service_type_group_id = watch('service_type_group_id');
  const display_order = watch('display_order');

  // Reset form when appointmentType changes
  useEffect(() => {
    if (isOpen && appointmentType) {
      reset({
        id: appointmentType.id,
        clinic_id: appointmentType.clinic_id,
        name: appointmentType.name || '',
        duration_minutes: appointmentType.duration_minutes || 30,
        receipt_name: appointmentType.receipt_name || null,
        allow_patient_booking: appointmentType.allow_patient_booking ?? true,
        allow_patient_practitioner_selection: appointmentType.allow_patient_practitioner_selection ?? true,
        description: appointmentType.description || null,
        scheduling_buffer_minutes: appointmentType.scheduling_buffer_minutes || 0,
        service_type_group_id: appointmentType.service_type_group_id || null,
        display_order: appointmentType.display_order || 0,
      });
    }
  }, [isOpen, appointmentType, reset]);

  // Load billing scenarios when modal opens and practitioners are assigned
  useEffect(() => {
    if (isOpen && currentPractitionerAssignments.length > 0) {
      currentPractitionerAssignments.forEach(practitionerId => {
        loadBillingScenarios(appointmentType.id, practitionerId);
      });
    }
  }, [isOpen, currentPractitionerAssignments, appointmentType.id, loadBillingScenarios]);

  const handleGroupChange = (groupId: number | null) => {
    setValue('service_type_group_id', groupId, { shouldDirty: true });
  };

  // Info modals
  const [showDurationModal, setShowDurationModal] = useState(false);
  const [showBufferModal, setShowBufferModal] = useState(false);
  const [showAllowBookingModal, setShowAllowBookingModal] = useState(false);
  const [showAllowPractitionerSelectionModal, setShowAllowPractitionerSelectionModal] = useState(false);
  const [showReceiptNameModal, setShowReceiptNameModal] = useState(false);
  const [showBillingScenarioModal, setShowBillingScenarioModal] = useState(false);

  // Billing scenario editing
  const [editingScenario, setEditingScenario] = useState<{ practitionerId: number; scenarioId?: number } | null>(null);
  const [scenarioForm, setScenarioForm] = useState({ name: '', amount: '', revenue_share: '', is_default: false });

  const handleAddScenario = (practitionerId: number) => {
    setEditingScenario({ practitionerId });
    setScenarioForm({ name: '', amount: '', revenue_share: '', is_default: false });
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
  };

  const handleSaveScenario = async () => {
    if (!editingScenario) return;
    const { practitionerId, scenarioId } = editingScenario;
    const amount = parseFloat(scenarioForm.amount);
    const revenue_share = parseFloat(scenarioForm.revenue_share);

    if (!scenarioForm.name || !scenarioForm.amount || !scenarioForm.revenue_share) {
      await alert('請填寫所有欄位', '錯誤');
      return;
    }
    if (amount <= 0 || revenue_share < 0 || revenue_share > amount) {
      await alert('無效的金額或分潤設定', '錯誤');
      return;
    }

    const key = `${appointmentType.id}-${practitionerId}`;
    const currentScenarios = allBillingScenarios[key] || [];
    
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
        practitioner_appointment_type_id: 0,
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
        allow_patient_practitioner_selection,
        description,
        scheduling_buffer_minutes,
        service_type_group_id,
        display_order,
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
          allow_patient_practitioner_selection,
          description,
          scheduling_buffer_minutes,
          service_type_group_id,
          display_order,
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
      service_type_group_id, display_order, isDirty, appointmentType, onUpdate]);

  const handleClose = () => {
    // Ensure any pending changes are saved before closing
    // Get current form values and update staging store
    const currentValues = watch();
    const updatedItem: AppointmentType = {
      ...appointmentType,
      name: currentValues.name || '',
      duration_minutes: currentValues.duration_minutes,
      receipt_name: currentValues.receipt_name || null,
      allow_patient_booking: currentValues.allow_patient_booking ?? true,
      allow_patient_practitioner_selection: currentValues.allow_patient_practitioner_selection ?? true,
      description: currentValues.description || null,
      scheduling_buffer_minutes: currentValues.scheduling_buffer_minutes || 0,
      service_type_group_id: currentValues.service_type_group_id || null,
      display_order: currentValues.display_order || 0,
    };
    
    // Update staging store with final values
    onUpdate(updatedItem);
    
    // No confirmation needed - changes are staged, not saved
    onClose();
  };

  if (!isOpen) return null;

  return (
    <FormProvider {...methods}>
      <BaseModal
        onClose={handleClose}
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
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="text-gray-500 hover:text-gray-700 transition-colors -ml-2 p-2"
                    aria-label="返回"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                  </button>
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                    {name || '編輯服務項目'}
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="hidden sm:inline-flex btn-secondary text-sm px-4 py-2"
                  >
                    取消
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

                      <FormField name="description" label="說明">
                        <FormTextarea name="description" placeholder="服務說明（顯示在 LINE 預約系統）" rows={4} disabled={!isClinicAdmin} className="resize-none" />
                      </FormField>
                    </div>
                  </div>

                  <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
                    <div className="px-4 py-4 md:px-0 md:py-0 space-y-4 md:space-y-6">
                      <div className="flex flex-col gap-3">
                        <label className="flex items-center group cursor-pointer">
                          <input type="checkbox" {...register('allow_patient_booking')} className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 mr-3" disabled={!isClinicAdmin} />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-gray-900">開放病患自行預約</span>
                            <span className="text-xs text-gray-500">病患可透過 LINE 預約系統看到並選擇此服務</span>
                          </div>
                          <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                            <InfoButton onClick={() => setShowAllowBookingModal(true)} />
                          </div>
                        </label>
                        <label className="flex items-center group cursor-pointer">
                          <input type="checkbox" {...register('allow_patient_practitioner_selection')} className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 mr-3" disabled={!isClinicAdmin} />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-gray-900">開放病患指定治療師</span>
                            <span className="text-xs text-gray-500">病患預約時可自由選擇想看診的治療師</span>
                          </div>
                          <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                            <InfoButton onClick={() => setShowAllowPractitionerSelectionModal(true)} />
                          </div>
                        </label>
                      </div>

                      {isClinicAdmin && (
                        <ResourceRequirementsSection appointmentTypeId={appointmentType.id} isClinicAdmin={isClinicAdmin} />
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: Practitioners & Billing */}
                <div className="space-y-4 md:space-y-6">
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
                                      loadBillingScenarios(appointmentType.id, practitioner.id);
                                    } else {
                                      onUpdatePractitionerAssignments(assignedPractitionerIds.filter((id: number) => id !== practitioner.id));
                                      onUpdateBillingScenarios(key, []);
                                    }
                                  }}
                                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                />
                                <span className="text-sm font-medium text-gray-900">{practitioner.full_name}</span>
                              </div>
                              
                              {isAssigned && (
                                <div className="mt-3 pl-7 space-y-3">
                                  <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                      <label className="text-xs font-medium text-gray-700">計費方案</label>
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
                              )}
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
                onClick={handleClose}
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
        <BaseModal onClose={() => setEditingScenario(null)} aria-label="編輯計費方案">
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">{editingScenario.scenarioId ? '編輯' : '新增'}計費方案</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">方案名稱</label>
                <input type="text" value={scenarioForm.name} onChange={(e) => setScenarioForm(prev => ({ ...prev, name: e.target.value }))} className="input" placeholder="例如：原價、九折、會員價" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">金額</label>
                  <input type="number" value={scenarioForm.amount} onChange={(e) => setScenarioForm(prev => ({ ...prev, amount: e.target.value }))} className="input" min="0" placeholder="0" onWheel={preventScrollWheelChange} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">診所分潤</label>
                  <input type="number" value={scenarioForm.revenue_share} onChange={(e) => setScenarioForm(prev => ({ ...prev, revenue_share: e.target.value }))} className="input" min="0" placeholder="0" onWheel={preventScrollWheelChange} />
                </div>
              </div>
              <label className="flex items-center">
                <input type="checkbox" checked={scenarioForm.is_default} onChange={(e) => setScenarioForm(prev => ({ ...prev, is_default: e.target.checked }))} className="mr-2" />
                <span className="text-sm font-medium text-gray-700">設為預設方案</span>
              </label>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button type="button" onClick={() => setEditingScenario(null)} className="btn-secondary">取消</button>
              <button type="button" onClick={handleSaveScenario} className="btn-primary">儲存</button>
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
      <InfoModal isOpen={showAllowBookingModal} onClose={() => setShowAllowBookingModal(false)} title="開放病患自行預約">
        <p>啟用後，病患可透過 LINE 預約系統選擇此服務項目...</p>
      </InfoModal>
      <InfoModal isOpen={showAllowPractitionerSelectionModal} onClose={() => setShowAllowPractitionerSelectionModal(false)} title="開放病患指定治療師">
        <p>啟用後，病患在預約時可以選擇指定的治療師...</p>
      </InfoModal>
      <InfoModal isOpen={showReceiptNameModal} onClose={() => setShowReceiptNameModal(false)} title="收據項目名稱">
        <p>此名稱會顯示在收據上，取代服務項目名稱...</p>
      </InfoModal>
      <InfoModal isOpen={showBillingScenarioModal} onClose={() => setShowBillingScenarioModal(false)} title="計費方案說明">
        <p>計費方案讓您為每位治療師的每項服務設定多種定價選項...</p>
      </InfoModal>
    </FormProvider>
  );
};

