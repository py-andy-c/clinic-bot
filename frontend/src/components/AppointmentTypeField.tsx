import React, { useState, useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import { Member, BillingScenario } from '../types';
import { preventScrollWheelChange } from '../utils/inputUtils';
import { formatCurrency } from '../utils/currencyUtils';
import { BaseModal } from './shared/BaseModal';
import { InfoButton, InfoModal } from './shared';
import { useServiceItemsStore } from '../stores/serviceItemsStore';
import { ResourceRequirementsSection } from './ResourceRequirementsSection';
import { FormField, FormInput, FormTextarea } from './forms';

interface AppointmentTypeFieldProps {
  index: number;
  isClinicAdmin: boolean;
  onRemove: () => void;
  members: Member[];
  loadingScenarios: Set<string>;
  onLoadBillingScenarios: (serviceItemId: number, practitionerId: number) => void;
}

export const AppointmentTypeField: React.FC<AppointmentTypeFieldProps> = ({
  index,
  isClinicAdmin,
  onRemove,
  members,
  loadingScenarios,
  onLoadBillingScenarios,
}) => {
  const { watch, register } = useFormContext();
  const appointmentType = watch(`appointment_types.${index}`);
  const [isExpanded, setIsExpanded] = useState(false);

  // Listen for expansion events from onInvalid
  useEffect(() => {
    const handleExpand = (e: any) => {
      if (e.detail.type === 'appointmentType' && e.detail.index === index) {
        setIsExpanded(true);
      }
    };
    window.addEventListener('form-error-expand', handleExpand);
    return () => window.removeEventListener('form-error-expand', handleExpand);
  }, [index]);

  const {
    practitionerAssignments,
    billingScenarios,
    updatePractitionerAssignments,
    updateBillingScenarios,
  } = useServiceItemsStore();

  const [showDurationModal, setShowDurationModal] = useState(false);
  const [showBufferModal, setShowBufferModal] = useState(false);
  const [showAllowBookingModal, setShowAllowBookingModal] = useState(false);
  const [showAllowPractitionerSelectionModal, setShowAllowPractitionerSelectionModal] = useState(false);
  const [showReceiptNameModal, setShowReceiptNameModal] = useState(false);
  const [showBillingScenarioModal, setShowBillingScenarioModal] = useState(false);
  
  const [editingScenario, setEditingScenario] = useState<{ practitionerId: number; scenarioId?: number } | null>(null);
  const [scenarioForm, setScenarioForm] = useState({ name: '', amount: '', revenue_share: '', is_default: false });

  const assignedPractitionerIds = practitionerAssignments[appointmentType.id] || [];

  // Load scenarios when expanded and practitioners are assigned
  useEffect(() => {
    if (isExpanded && assignedPractitionerIds.length > 0) {
      assignedPractitionerIds.forEach(practitionerId => {
        onLoadBillingScenarios(appointmentType.id, practitionerId);
      });
    }
  }, [isExpanded, assignedPractitionerIds, appointmentType.id, onLoadBillingScenarios]);

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

  const handleSaveScenario = () => {
    if (!editingScenario) return;
    const { practitionerId, scenarioId } = editingScenario;
    const amount = parseFloat(scenarioForm.amount);
    const revenue_share = parseFloat(scenarioForm.revenue_share);

    if (!scenarioForm.name || !scenarioForm.amount || !scenarioForm.revenue_share) {
      alert('請填寫所有欄位');
      return;
    }
    if (amount <= 0 || revenue_share < 0 || revenue_share > amount) {
      alert('無效的金額或分潤設定');
      return;
    }

    const key = `${appointmentType.id}-${practitionerId}`;
    const currentScenarios = billingScenarios[key] || [];
    
    if (scenarioId) {
      const updatedScenarios = currentScenarios.map(s => 
        s.id === scenarioId 
          ? { ...s, name: scenarioForm.name, amount, revenue_share, is_default: scenarioForm.is_default }
          : scenarioForm.is_default ? { ...s, is_default: false } : s
      );
      updateBillingScenarios(key, updatedScenarios);
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
        ? [...currentScenarios.map(s => ({ ...s, is_default: false })), newScenario]
        : [...currentScenarios, newScenario];
      updateBillingScenarios(key, updatedScenarios);
    }
    setEditingScenario(null);
  };

  return (
    <div className={`border border-gray-200 rounded-lg ${!isExpanded ? 'hover:bg-gray-50 transition-colors' : ''}`}>
      {!isExpanded && (
        <div className="p-4">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setIsExpanded(true)} className="text-left flex-1 flex items-center gap-3 p-2 rounded">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{appointmentType.name || <span className="text-gray-400 italic">未命名服務項目</span>}</span>
                  {appointmentType.allow_patient_booking === false && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">不開放預約</span>}
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  時長: {appointmentType.duration_minutes} 分鐘 • {assignedPractitionerIds.length} 位治療師
                </div>
              </div>
            </button>
            {isClinicAdmin && (
              <button type="button" onClick={onRemove} className="text-red-600 hover:text-red-800 p-2"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
            )}
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <button type="button" onClick={() => setIsExpanded(false)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              <span>收起</span>
            </button>
            {isClinicAdmin && (
              <button type="button" onClick={onRemove} className="text-red-600 hover:text-red-800 p-1.5 hover:bg-red-50 rounded transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
            )}
          </div>

          <div className="space-y-4">
            <FormField name={`appointment_types.${index}.name`} label="項目名稱">
              <FormInput name={`appointment_types.${index}.name`} placeholder="例如：初診評估" disabled={!isClinicAdmin} />
            </FormField>

            <FormField name={`appointment_types.${index}.receipt_name`} label="收據項目名稱">
              <div className="flex items-center gap-2">
                <FormInput name={`appointment_types.${index}.receipt_name`} placeholder={appointmentType.name || '例如：初診評估'} disabled={!isClinicAdmin} />
                <InfoButton onClick={() => setShowReceiptNameModal(true)} />
              </div>
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField name={`appointment_types.${index}.duration_minutes`} label="服務時長 (分鐘)">
                <div className="flex items-center gap-2">
                  <FormInput name={`appointment_types.${index}.duration_minutes`} type="number" min="15" max="480" disabled={!isClinicAdmin} onWheel={preventScrollWheelChange} />
                  <InfoButton onClick={() => setShowDurationModal(true)} />
                </div>
              </FormField>
              <FormField name={`appointment_types.${index}.scheduling_buffer_minutes`} label="排程緩衝時間 (分鐘)">
                <div className="flex items-center gap-2">
                  <FormInput name={`appointment_types.${index}.scheduling_buffer_minutes`} type="number" min="0" max="60" disabled={!isClinicAdmin} onWheel={preventScrollWheelChange} />
                  <InfoButton onClick={() => setShowBufferModal(true)} />
                </div>
              </FormField>
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex items-center">
                <input type="checkbox" {...register(`appointment_types.${index}.allow_patient_booking`)} className="mr-2" disabled={!isClinicAdmin} />
                <span className="text-sm font-medium text-gray-700">開放病患自行預約</span>
                <InfoButton onClick={() => setShowAllowBookingModal(true)} />
              </label>
              <label className="flex items-center">
                <input type="checkbox" {...register(`appointment_types.${index}.allow_patient_practitioner_selection`)} className="mr-2" disabled={!isClinicAdmin} />
                <span className="text-sm font-medium text-gray-700">開放病患指定治療師</span>
                <InfoButton onClick={() => setShowAllowPractitionerSelectionModal(true)} />
              </label>
            </div>

            <FormField name={`appointment_types.${index}.description`} label="說明">
              <FormTextarea name={`appointment_types.${index}.description`} placeholder="服務說明（顯示在 LINE 預約系統）" rows={3} disabled={!isClinicAdmin} />
            </FormField>

            {isClinicAdmin && (
              <ResourceRequirementsSection appointmentTypeId={appointmentType.id} isClinicAdmin={isClinicAdmin} />
            )}

            {isClinicAdmin && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">提供此服務的治療師</label>
                <div className="space-y-4">
                  {members.map(practitioner => {
                    const isAssigned = assignedPractitionerIds.includes(practitioner.id);
                    const key = `${appointmentType.id}-${practitioner.id}`;
                    const scenarios = billingScenarios[key] || [];
                    const isLoading = loadingScenarios.has(key);

                    return (
                      <div key={practitioner.id} className="space-y-2">
                        <div className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            checked={isAssigned}
                            onChange={(e) => {
                              const shouldAssign = e.target.checked;
                              if (shouldAssign) {
                                updatePractitionerAssignments(appointmentType.id, [...assignedPractitionerIds, practitioner.id]);
                              } else {
                                updatePractitionerAssignments(appointmentType.id, assignedPractitionerIds.filter(id => id !== practitioner.id));
                                updateBillingScenarios(key, []);
                              }
                            }}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="text-sm font-medium text-gray-900">{practitioner.full_name}</span>
                        </div>
                        {isAssigned && (
                          <div className="mt-2 pl-7 pt-2 border-t border-gray-100">
                            <div className="flex justify-between items-center mb-2">
                              <div className="flex items-center gap-2">
                                <label className="text-xs font-medium text-gray-700">計費方案</label>
                                <InfoButton onClick={() => setShowBillingScenarioModal(true)} />
                              </div>
                              <button type="button" onClick={() => handleAddScenario(practitioner.id)} className="text-xs text-blue-600 hover:text-blue-800">+ 新增方案</button>
                            </div>
                            {isLoading ? <p className="text-xs text-gray-500">載入中...</p> : scenarios.length === 0 ? <p className="text-xs text-gray-500">尚無計費方案</p> : (
                              <div className="space-y-2">
                                {scenarios.map(scenario => (
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
                                      <button type="button" onClick={() => updateBillingScenarios(key, scenarios.filter(s => s.id !== scenario.id))} className="text-xs text-red-600 hover:text-red-800">刪除</button>
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
            )}
          </div>
        </div>
      )}

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
      <InfoModal isOpen={showDurationModal} onClose={() => setShowDurationModal(false)} title="服務時長 (分鐘)"><p>此為實際服務時間長度...</p></InfoModal>
      <InfoModal isOpen={showBufferModal} onClose={() => setShowBufferModal(false)} title="排程緩衝時間 (分鐘)"><p>此為排程時額外保留的時間...</p></InfoModal>
      <InfoModal isOpen={showAllowBookingModal} onClose={() => setShowAllowBookingModal(false)} title="開放病患自行預約"><p>啟用後，病患可透過 LINE 預約系統選擇此服務項目...</p></InfoModal>
      <InfoModal isOpen={showAllowPractitionerSelectionModal} onClose={() => setShowAllowPractitionerSelectionModal(false)} title="開放病患指定治療師"><p>啟用後，病患在預約時可以選擇指定的治療師...</p></InfoModal>
      <InfoModal isOpen={showReceiptNameModal} onClose={() => setShowReceiptNameModal(false)} title="收據項目名稱"><p>此名稱會顯示在收據上，取代服務項目名稱...</p></InfoModal>
      <InfoModal isOpen={showBillingScenarioModal} onClose={() => setShowBillingScenarioModal(false)} title="計費方案說明"><p>計費方案讓您為每位治療師的每項服務設定多種定價選項...</p></InfoModal>
    </div>
  );
};

