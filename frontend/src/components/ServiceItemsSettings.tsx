import React, { useState, useEffect } from 'react';
import { AppointmentType } from '../types';
import { Member } from '../types';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { preventScrollWheelChange } from '../utils/inputUtils';
import { formatCurrency } from '../utils/currencyUtils';
import { BaseModal } from './shared/BaseModal';
import { InfoButton, InfoModal } from './shared';
import { NumberInput } from './shared/NumberInput';
import { useServiceItemsStore, BillingScenario } from '../stores/serviceItemsStore';
import { ResourceRequirementsSection } from './ResourceRequirementsSection';

interface ServiceItemsSettingsProps {
  appointmentTypes: AppointmentType[];
  onAddType: () => void;
  onUpdateType: (index: number, field: keyof AppointmentType, value: string | number | boolean | null) => void;
  onRemoveType: (index: number) => Promise<void> | void;
  isClinicAdmin: boolean;
}

const ServiceItemsSettings: React.FC<ServiceItemsSettingsProps> = ({
  appointmentTypes,
  onAddType,
  onUpdateType,
  onRemoveType,
  isClinicAdmin,
}) => {
  // Use service items store
  const {
    practitionerAssignments,
    billingScenarios,
    loadingScenarios,
    updatePractitionerAssignments,
    updateBillingScenarios,
    loadBillingScenarios: loadBillingScenariosFromStore,
  } = useServiceItemsStore();

  const [members, setMembers] = useState<Member[]>([]);
  const [, setLoadingMembers] = useState(false);
  const [expandedServiceItems, setExpandedServiceItems] = useState<Set<number>>(new Set());
  // Track failed requests to prevent infinite retries (especially 404s)
  const [failedScenarios, setFailedScenarios] = useState<Set<string>>(new Set());
  const [editingScenario, setEditingScenario] = useState<{ serviceItemId: number; practitionerId: number; scenarioId?: number } | null>(null);
  const [scenarioForm, setScenarioForm] = useState<{ name: string; amount: string; revenue_share: string; is_default: boolean }>({
    name: '',
    amount: '',
    revenue_share: '',
    is_default: false,
  });
  const [showDurationModal, setShowDurationModal] = useState(false);
  const [showBufferModal, setShowBufferModal] = useState(false);
  const [showAllowBookingModal, setShowAllowBookingModal] = useState(false);
  const [showAllowPractitionerSelectionModal, setShowAllowPractitionerSelectionModal] = useState(false);
  const [showReceiptNameModal, setShowReceiptNameModal] = useState(false);
  const [showBillingScenarioModal, setShowBillingScenarioModal] = useState(false);

  // Load members (practitioners)
  useEffect(() => {
    if (isClinicAdmin) {
      loadMembers();
    }
  }, [isClinicAdmin]);

  // Load billing scenarios when service items are expanded and practitioners are assigned
  useEffect(() => {
    if (!isClinicAdmin || members.length === 0) {
      return;
    }

    // For each expanded service item, load scenarios for assigned practitioners
    appointmentTypes.forEach(type => {
      if (!expandedServiceItems.has(type.id)) {
        return;
      }

      const assignedPractitionerIds = practitionerAssignments[type.id] || [];
      assignedPractitionerIds.forEach(practitionerId => {
        const key = `${type.id}-${practitionerId}`;
        // Only load if not already loaded, not currently loading, and not previously failed
        const isLoaded = !!billingScenarios[key];
        const isLoading = loadingScenarios.has(key);
        const hasFailed = failedScenarios.has(key);
        
        if (!isLoaded && !isLoading && !hasFailed) {
          loadBillingScenariosFromStore(type.id, practitionerId);
        }
      });
    });
    // Only depend on the triggers that should cause loading, not the loading state itself
    // billingScenarios and loadingScenarios are checked inside the effect, not in dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedServiceItems, practitionerAssignments, members.length, isClinicAdmin, appointmentTypes.length]);

  // Practitioner assignments are now managed by context, no need to load here

  const loadMembers = async () => {
    try {
      setLoadingMembers(true);
      const membersData = await apiService.getMembers();
      // Filter to only practitioners (users with practitioner role)
      const practitioners = membersData.filter(m => m.roles.includes('practitioner'));
      setMembers(practitioners);
      
      // Practitioner assignments are managed by context
    } catch (err) {
      logger.error('Error loading members:', err);
    } finally {
      setLoadingMembers(false);
    }
  };

  const toggleServiceItem = (serviceItemId: number) => {
    setExpandedServiceItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serviceItemId)) {
        newSet.delete(serviceItemId);
      } else {
        newSet.add(serviceItemId);
      }
      return newSet;
    });
  };

  const loadBillingScenarios = async (serviceItemId: number, practitionerId: number) => {
    const key = `${serviceItemId}-${practitionerId}`;
    // Don't load if already loading, already loaded, or previously failed
    if (loadingScenarios.has(key) || billingScenarios[key] || failedScenarios.has(key)) {
      return;
    }

    try {
      await loadBillingScenariosFromStore(serviceItemId, practitionerId);
      // Remove from failed set if it was there (in case of retry after error)
      setFailedScenarios(prev => {
        const newSet = new Set(prev);
        newSet.delete(key);
        return newSet;
      });
    } catch (err: any) {
      // For actual errors (network issues, 500s, etc.), mark as failed
      logger.error('Error loading billing scenarios:', err);
      setFailedScenarios(prev => new Set(prev).add(key));
    }
  };

  const handleAddScenario = (serviceItemId: number, practitionerId: number) => {
    setEditingScenario({ serviceItemId, practitionerId });
    setScenarioForm({ name: '', amount: '', revenue_share: '', is_default: false });
  };

  const handleEditScenario = (serviceItemId: number, practitionerId: number, scenario: BillingScenario) => {
    setEditingScenario({ serviceItemId, practitionerId, scenarioId: scenario.id });
    // Normalize amount and revenue_share to handle both string and number types from API
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

    const { serviceItemId, practitionerId, scenarioId } = editingScenario;
    const amount = parseFloat(scenarioForm.amount);
    const revenue_share = parseFloat(scenarioForm.revenue_share);

    // Validation
    if (!scenarioForm.name || !scenarioForm.amount || !scenarioForm.revenue_share) {
      alert('請填寫所有欄位');
      return;
    }

    if (amount <= 0) {
      alert('金額必須大於 0');
      return;
    }

    if (revenue_share < 0) {
      alert('診所分潤必須 >= 0');
      return;
    }

    if (revenue_share > amount) {
      alert('診所分潤必須 <= 金額');
      return;
    }

    const key = `${serviceItemId}-${practitionerId}`;
    const currentScenarios = billingScenarios[key] || [];
    
    if (scenarioId) {
      // Update existing
      const updatedScenarios = currentScenarios.map(s => 
        s.id === scenarioId 
          ? { ...s, name: scenarioForm.name, amount, revenue_share, is_default: scenarioForm.is_default }
          : scenarioForm.is_default ? { ...s, is_default: false } : s
      );
      updateBillingScenarios(key, updatedScenarios);
    } else {
      // Create new (with temporary negative ID, will be replaced by real ID from backend on save)
      const newScenario: BillingScenario = {
        id: -Date.now(), // Temporary negative ID (will never conflict with real positive IDs)
        practitioner_appointment_type_id: 0, // Will be set by backend
        name: scenarioForm.name,
        amount,
        revenue_share,
        is_default: scenarioForm.is_default,
      };
      // If this is default, unset others
      const updatedScenarios = scenarioForm.is_default
        ? [...currentScenarios.map(s => ({ ...s, is_default: false })), newScenario]
        : [...currentScenarios, newScenario];
      updateBillingScenarios(key, updatedScenarios);
    }

    setEditingScenario(null);
  };

  const handleDeleteScenario = (serviceItemId: number, practitionerId: number, scenarioId: number) => {
    if (!confirm('確定要刪除此計費方案嗎？')) {
      return;
    }

    const key = `${serviceItemId}-${practitionerId}`;
    const currentScenarios = billingScenarios[key] || [];
    const updatedScenarios = currentScenarios.filter(s => s.id !== scenarioId);
    updateBillingScenarios(key, updatedScenarios);
  };

  return (
    <div className="space-y-6">
      {/* Service Items List */}
      <div>
        <div className="mb-2">
          <label className="block text-sm font-medium text-gray-700">服務項目</label>
        </div>

        <div className="space-y-4">
          {appointmentTypes.map((type, index) => {
            const isExpanded = expandedServiceItems.has(type.id);
            const assignedPractitionerIds = practitionerAssignments[type.id] || [];
            const assignedCount = assignedPractitionerIds.length;

            return (
              <div key={type.id} className={`border border-gray-200 rounded-lg ${!isExpanded ? 'hover:bg-gray-50 transition-colors' : ''}`}>
                {/* Compact Header (when collapsed) */}
                {!isExpanded && (
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => toggleServiceItem(type.id)}
                            className="text-left flex-1 flex items-center gap-2 p-2 rounded"
                          >
                            <svg
                              className="w-5 h-5 text-gray-400 transition-transform"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900">
                                  {type.name || <span className="text-gray-400 italic">未命名服務項目</span>}
                                </span>
                                {type.allow_patient_booking === false && (
                                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">不開放預約</span>
                                )}
                              </div>
                              <div className="text-sm text-gray-500 mt-1">
                                時長: {type.duration_minutes} 分鐘
                                {(type.scheduling_buffer_minutes ?? 0) > 0 && ` • 緩衝: ${type.scheduling_buffer_minutes ?? 0} 分鐘`}
                                {isClinicAdmin && ` • ${assignedCount} 位治療師`}
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                      {isClinicAdmin && (
                        <div className="flex items-center gap-2 ml-4">
                          <button
                            type="button"
                            onClick={() => onRemoveType(index)}
                            className="text-red-600 hover:text-red-800 p-2"
                            title="刪除"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="p-4">
                    {/* Service Item Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1 space-y-3">
                        {/* Expand/Collapse Button and Delete Button */}
                        <div className="flex items-center justify-between mb-2">
                          <button
                            type="button"
                            onClick={() => toggleServiceItem(type.id)}
                            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                          >
                            <svg
                              className="w-4 h-4 text-gray-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            <span>收起</span>
                          </button>
                          {isClinicAdmin && (
                            <button
                              type="button"
                              onClick={() => onRemoveType(index)}
                              className="text-red-600 hover:text-red-800 p-1.5 hover:bg-red-50 rounded transition-colors"
                              title="刪除"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>

                        {/* Name */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            項目名稱
                          </label>
                          <input
                            type="text"
                            value={type.name}
                            onChange={(e) => onUpdateType(index, 'name', e.target.value)}
                            className="input"
                            placeholder="例如：初診評估"
                            disabled={!isClinicAdmin}
                          />
                        </div>

                        {/* Receipt Name */}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <label className="block text-sm font-medium text-gray-700">
                              收據項目名稱
                            </label>
                            <InfoButton onClick={() => setShowReceiptNameModal(true)} />
                          </div>
                          <input
                            type="text"
                            value={type.receipt_name || ''}
                            onChange={(e) => onUpdateType(index, 'receipt_name', e.target.value || null)}
                            className="input"
                            placeholder={type.name || '例如：初診評估'}
                            disabled={!isClinicAdmin}
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            如未填寫，將使用項目名稱
                          </p>
                        </div>

                        {/* Duration and Buffer */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <label className="block text-sm font-medium text-gray-700">
                                服務時長 (分鐘)
                              </label>
                              <InfoButton onClick={() => setShowDurationModal(true)} />
                            </div>
                            <input
                              type="number"
                              value={type.duration_minutes}
                              onChange={(e) => {
                                const value = e.target.value;
                                onUpdateType(index, 'duration_minutes', value);
                              }}
                              onWheel={preventScrollWheelChange}
                              className="input"
                              min="15"
                              max="480"
                              disabled={!isClinicAdmin}
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <label className="block text-sm font-medium text-gray-700">
                                排程緩衝時間 (分鐘)
                              </label>
                              <InfoButton onClick={() => setShowBufferModal(true)} />
                            </div>
                            <NumberInput
                              value={type.scheduling_buffer_minutes || 0}
                              onChange={(value) => onUpdateType(index, 'scheduling_buffer_minutes', value)}
                              fallback={0}
                              parseFn="parseInt"
                              min={0}
                              max={60}
                              disabled={!isClinicAdmin}
                            />
                          </div>
                        </div>

                        {/* Allow Patient Booking */}
                        <div>
                          <label className="flex items-center">
                            <input
                              type="checkbox"
                              checked={type.allow_patient_booking !== false}
                              onChange={(e) => onUpdateType(index, 'allow_patient_booking', e.target.checked)}
                              className="mr-2"
                              disabled={!isClinicAdmin}
                            />
                            <span className="text-sm font-medium text-gray-700">開放病患自行預約</span>
                            <InfoButton onClick={() => setShowAllowBookingModal(true)} />
                          </label>
                        </div>

                        {/* Allow Patient Practitioner Selection */}
                        <div>
                          <label className="flex items-center">
                            <input
                              type="checkbox"
                              checked={type.allow_patient_practitioner_selection !== false}
                              onChange={(e) => onUpdateType(index, 'allow_patient_practitioner_selection', e.target.checked)}
                              className="mr-2"
                              disabled={!isClinicAdmin}
                            />
                            <span className="text-sm font-medium text-gray-700">開放病患指定治療師</span>
                            <InfoButton onClick={() => setShowAllowPractitionerSelectionModal(true)} />
                          </label>
                        </div>

                        {/* Description */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            說明
                          </label>
                          <textarea
                            value={type.description || ''}
                            onChange={(e) => onUpdateType(index, 'description', e.target.value || null)}
                            className="input min-h-[80px] resize-vertical"
                            placeholder="服務說明（顯示在 LINE 預約系統）"
                            disabled={!isClinicAdmin}
                            rows={3}
                          />
                        </div>

                        {/* Resource Requirements Section */}
                        {isClinicAdmin && (
                          <ResourceRequirementsSection
                            appointmentTypeId={type.id}
                            isClinicAdmin={isClinicAdmin}
                          />
                        )}
                      </div>
                    </div>

                    {/* Practitioner Assignment (Admin Only) - Always shown when service item is expanded */}
                    {isClinicAdmin && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className="mb-2">
                          <label className="block text-sm font-medium text-gray-700">
                            提供此服務的治療師
                          </label>
                        </div>

                        {(() => {
                          return (
                            <div className="mt-2 space-y-4">
                              {/* All Practitioners with Checkboxes */}
                              <div className="space-y-3">
                                {members.map(practitioner => {
                                  const isAssigned = assignedPractitionerIds.includes(practitioner.id);
                                  const key = `${type.id}-${practitioner.id}`;
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
                                            const currentPractitionerIds = practitionerAssignments[type.id] || [];
                                            
                                            if (shouldAssign) {
                                              // Add practitioner to this service item
                                              if (!currentPractitionerIds.includes(practitioner.id)) {
                                                updatePractitionerAssignments(type.id, [...currentPractitionerIds, practitioner.id]);
                                              }
                                            } else {
                                              // Remove practitioner from this service item
                                              updatePractitionerAssignments(
                                                type.id,
                                                currentPractitionerIds.filter(id => id !== practitioner.id)
                                              );
                                              // Clear billing scenarios for this practitioner-service
                                              updateBillingScenarios(key, []);
                                              // Also clear from failed set to allow retry if needed
                                              setFailedScenarios(prev => {
                                                const newSet = new Set(prev);
                                                newSet.delete(key);
                                                return newSet;
                                              });
                                            }
                                          }}
                                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                        />
                                        <label 
                                          className="text-sm font-medium text-gray-900 cursor-pointer flex-1"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            const checkbox = e.currentTarget.previousElementSibling as HTMLInputElement;
                                            if (checkbox) {
                                              checkbox.click();
                                            }
                                          }}
                                        >
                                          {practitioner.full_name}
                                        </label>
                                      </div>
                                      
                                      {/* Billing Scenarios (shown only when assigned) */}
                                      {isAssigned && (
                                        <div className="mt-2 pt-2 border-t border-gray-200">
                                          <div className="flex justify-between items-center mb-2">
                                            <div className="flex items-center gap-2">
                                              <label className="text-xs font-medium text-gray-700">計費方案</label>
                                              <InfoButton onClick={() => setShowBillingScenarioModal(true)} />
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                // Load scenarios if not loaded and not failed
                                                if (!billingScenarios[key] && !loadingScenarios.has(key) && !failedScenarios.has(key)) {
                                                  loadBillingScenarios(type.id, practitioner.id);
                                                }
                                                handleAddScenario(type.id, practitioner.id);
                                              }}
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
                                              {scenarios.map(scenario => (
                                                <div key={scenario.id} className="flex items-center justify-between bg-white p-2 rounded border border-gray-200">
                                                  <div className="flex-1">
                                                    <div className="flex items-center space-x-2">
                                                      <span className="text-sm font-medium text-gray-900">{scenario.name}</span>
                                                      {scenario.is_default && (
                                                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">預設</span>
                                                      )}
                                                    </div>
                                                    <div className="text-xs text-gray-600 mt-1">
                                                      金額: {formatCurrency(typeof scenario.amount === 'string' ? parseFloat(scenario.amount) : scenario.amount)} | 診所分潤: {formatCurrency(typeof scenario.revenue_share === 'string' ? parseFloat(scenario.revenue_share) : scenario.revenue_share)}
                                                    </div>
                                                  </div>
                                                  <div className="flex items-center space-x-2">
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        if (!billingScenarios[key] && !loadingScenarios.has(key) && !failedScenarios.has(key)) {
                                                          loadBillingScenarios(type.id, practitioner.id);
                                                        }
                                                        handleEditScenario(type.id, practitioner.id, scenario);
                                                      }}
                                                      className="text-xs text-blue-600 hover:text-blue-800"
                                                    >
                                                      編輯
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => handleDeleteScenario(type.id, practitioner.id, scenario.id)}
                                                      className="text-xs text-red-600 hover:text-red-800"
                                                    >
                                                      刪除
                                                    </button>
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

                                {members.length === 0 && (
                                  <p className="text-sm text-gray-500 text-center py-4">
                                    尚無治療師
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add Service Item Button */}
        {isClinicAdmin && (
          <div className="mt-4">
            <button
              type="button"
              onClick={onAddType}
              className="btn-secondary text-sm w-full"
            >
              + 新增服務項目
            </button>
          </div>
        )}
      </div>

      {/* Info Modals */}
      <InfoModal
        isOpen={showDurationModal}
        onClose={() => setShowDurationModal(false)}
        title="服務時長 (分鐘)"
        ariaLabel="服務時長說明"
      >
        <p>此為實際服務時間長度。病患預約時會看到對應的時段（例如：50分鐘顯示為 09:00-09:50）。此時間會顯示在診所行事曆和病患的預約確認中。</p>
      </InfoModal>

      <InfoModal
        isOpen={showBufferModal}
        onClose={() => setShowBufferModal(false)}
        title="排程緩衝時間 (分鐘)"
        ariaLabel="排程緩衝時間說明"
      >
        <p>此為排程時額外保留的時間，用於避免預約之間過於緊湊。系統會將「服務時長 + 緩衝時間」作為總佔用時間來計算可用時段。</p>
        <p className="font-medium mt-2">範例：</p>
        <p>服務時長 50 分鐘 + 緩衝 10 分鐘 = 總共佔用 60 分鐘。若設定 10 分鐘緩衝，則 09:00 的預約會佔用到 10:00，下一個可用時段最早為 10:00。</p>
        <p className="text-xs text-gray-600 mt-2">緩衝時間不會顯示給病患，僅用於內部排程邏輯。</p>
      </InfoModal>

      <InfoModal
        isOpen={showAllowBookingModal}
        onClose={() => setShowAllowBookingModal(false)}
        title="開放病患自行預約"
        ariaLabel="開放病患自行預約說明"
      >
        <p>啟用後，病患可透過 LINE 預約系統選擇此服務項目。停用後，此服務項目不會出現在病患的預約選單中，僅能由診所管理員手動建立預約。</p>
      </InfoModal>

      <InfoModal
        isOpen={showAllowPractitionerSelectionModal}
        onClose={() => setShowAllowPractitionerSelectionModal(false)}
        title="開放病患指定治療師"
        ariaLabel="開放病患指定治療師說明"
      >
        <p>啟用後，病患在預約時可以選擇指定的治療師。停用後，病患無法選擇治療師，系統將自動指派治療師，並由診所管理員審核與重新指派。</p>
      </InfoModal>

      <InfoModal
        isOpen={showReceiptNameModal}
        onClose={() => setShowReceiptNameModal(false)}
        title="收據項目名稱"
        ariaLabel="收據項目名稱說明"
      >
        <p>此名稱會顯示在收據上，取代服務項目名稱。若未填寫，收據將使用「項目名稱」。此設定不影響病患預約時看到的服務名稱。</p>
      </InfoModal>

      <InfoModal
        isOpen={showBillingScenarioModal}
        onClose={() => setShowBillingScenarioModal(false)}
        title="計費方案說明"
        ariaLabel="計費方案說明"
      >
        <p>計費方案讓您為每位治療師的每項服務設定多種定價選項（例如：原價、折扣價、會員價等）。</p>
        <p className="font-medium mt-3">每個計費方案包含：</p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li><strong>金額</strong>：向病患收取的費用（會顯示在收據上）</li>
          <li><strong>診所分潤</strong>：診所的收入分成（僅供內部使用，不會顯示在收據上）</li>
        </ul>
        <p className="mt-3">您可以為每個治療師-服務組合建立多個計費方案，結帳時可選擇適用的方案。</p>
        <p className="text-gray-600 mt-2">預設方案會在結帳時自動選取，但可以手動更改。</p>
      </InfoModal>

      {/* Billing Scenario Edit Modal */}
      {editingScenario && (
        <BaseModal
          onClose={() => setEditingScenario(null)}
          aria-label="編輯計費方案"
        >
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">
              {editingScenario.scenarioId ? '編輯' : '新增'}計費方案
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  方案名稱
                </label>
                <input
                  type="text"
                  value={scenarioForm.name}
                  onChange={(e) => setScenarioForm(prev => ({ ...prev, name: e.target.value }))}
                  className="input"
                  placeholder="例如：原價、九折、會員價"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  金額
                </label>
                <input
                  type="number"
                  value={scenarioForm.amount}
                  onChange={(e) => setScenarioForm(prev => ({ ...prev, amount: e.target.value }))}
                  className="input"
                  min="0"
                  step="1"
                  placeholder="0"
                  onWheel={preventScrollWheelChange}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  診所分潤
                </label>
                <input
                  type="number"
                  value={scenarioForm.revenue_share}
                  onChange={(e) => setScenarioForm(prev => ({ ...prev, revenue_share: e.target.value }))}
                  className="input"
                  min="0"
                  step="1"
                  placeholder="0"
                  onWheel={preventScrollWheelChange}
                />
                <p className="text-xs text-gray-500 mt-1">
                  診所分潤必須 &lt;= 金額
                </p>
              </div>

              <div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={scenarioForm.is_default}
                    onChange={(e) => setScenarioForm(prev => ({ ...prev, is_default: e.target.checked }))}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700">設為預設方案</span>
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setEditingScenario(null)}
                className="btn-secondary"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveScenario}
                className="btn-primary"
              >
                儲存
              </button>
            </div>
          </div>
        </BaseModal>
      )}
    </div>
  );
};

export default ServiceItemsSettings;


