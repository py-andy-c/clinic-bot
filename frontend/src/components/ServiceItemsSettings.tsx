import React, { useState, useEffect } from 'react';
import { AppointmentType } from '../types';
import { Member } from '../types';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { preventScrollWheelChange } from '../utils/inputUtils';
import { BaseModal } from './shared/BaseModal';

interface BillingScenario {
  id: number;
  practitioner_appointment_type_id: number;
  name: string;
  amount: number;
  revenue_share: number;
  is_default: boolean;
}

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
  const [members, setMembers] = useState<Member[]>([]);
  const [, setLoadingMembers] = useState(false);
  const [expandedServiceItems, setExpandedServiceItems] = useState<Set<number>>(new Set());
  const [practitionerAssignments, setPractitionerAssignments] = useState<Record<number, number[]>>({});
  const [billingScenarios, setBillingScenarios] = useState<Record<string, BillingScenario[]>>({});
  const [loadingScenarios, setLoadingScenarios] = useState<Set<string>>(new Set());
  const [editingScenario, setEditingScenario] = useState<{ serviceItemId: number; practitionerId: number; scenarioId?: number } | null>(null);
  const [scenarioForm, setScenarioForm] = useState<{ name: string; amount: string; revenue_share: string; is_default: boolean }>({
    name: '',
    amount: '',
    revenue_share: '',
    is_default: false,
  });

  // Load members (practitioners)
  useEffect(() => {
    if (isClinicAdmin) {
      loadMembers();
    }
  }, [isClinicAdmin]);

  const loadPractitionerAssignments = async () => {
    if (members.length === 0) return;
    
    // Load which practitioners are assigned to which service items
    const assignments: Record<number, number[]> = {};
    
    for (const member of members) {
      if (member.roles.includes('practitioner')) {
        try {
          const data = await apiService.getPractitionerAppointmentTypes(member.id);
          const appointmentTypes = data?.appointment_types;
          if (appointmentTypes && Array.isArray(appointmentTypes)) {
            for (const at of appointmentTypes) {
              if (at?.id) {
                const typeId = at.id;
                if (!assignments[typeId]) {
                  assignments[typeId] = [];
                }
                assignments[typeId].push(member.id);
              }
            }
          }
        } catch (err) {
          logger.error(`Error loading assignments for practitioner ${member.id}:`, err);
        }
      }
    }
    
    setPractitionerAssignments(assignments);
  };

  const loadMembers = async () => {
    try {
      setLoadingMembers(true);
      const membersData = await apiService.getMembers();
      // Filter to only practitioners (users with practitioner role)
      const practitioners = membersData.filter(m => m.roles.includes('practitioner'));
      setMembers(practitioners);
      
      // After loading members, load their assignments
      if (practitioners.length > 0) {
        await loadPractitionerAssignments();
      }
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
    if (loadingScenarios.has(key) || billingScenarios[key]) {
      return; // Already loading or loaded
    }

    try {
      setLoadingScenarios(prev => new Set(prev).add(key));
      const data = await apiService.getBillingScenarios(serviceItemId, practitionerId);
      setBillingScenarios(prev => ({
        ...prev,
        [key]: data.billing_scenarios,
      }));
    } catch (err) {
      logger.error('Error loading billing scenarios:', err);
    } finally {
      setLoadingScenarios(prev => {
        const newSet = new Set(prev);
        newSet.delete(key);
        return newSet;
      });
    }
  };

  const handleAddScenario = (serviceItemId: number, practitionerId: number) => {
    setEditingScenario({ serviceItemId, practitionerId });
    setScenarioForm({ name: '', amount: '', revenue_share: '', is_default: false });
  };

  const handleEditScenario = (serviceItemId: number, practitionerId: number, scenario: BillingScenario) => {
    setEditingScenario({ serviceItemId, practitionerId, scenarioId: scenario.id });
    setScenarioForm({
      name: scenario.name,
      amount: scenario.amount.toString(),
      revenue_share: scenario.revenue_share.toString(),
      is_default: scenario.is_default,
    });
  };

  const handleSaveScenario = async () => {
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
      alert('分潤必須 >= 0');
      return;
    }

    if (revenue_share > amount) {
      alert('分潤必須 <= 金額');
      return;
    }

    try {
      if (scenarioId) {
        // Update existing
        await apiService.updateBillingScenario(serviceItemId, practitionerId, scenarioId, {
          name: scenarioForm.name,
          amount,
          revenue_share,
          is_default: scenarioForm.is_default,
        });
      } else {
        // Create new
        await apiService.createBillingScenario(serviceItemId, practitionerId, {
          name: scenarioForm.name,
          amount,
          revenue_share,
          is_default: scenarioForm.is_default,
        });
      }

      // Reload scenarios
      const key = `${serviceItemId}-${practitionerId}`;
      setBillingScenarios(prev => {
        const newPrev = { ...prev };
        delete newPrev[key];
        return newPrev;
      });
      await loadBillingScenarios(serviceItemId, practitionerId);

      setEditingScenario(null);
    } catch (err) {
      logger.error('Error saving billing scenario:', err);
      alert('儲存失敗，請重試');
    }
  };

  const handleDeleteScenario = async (serviceItemId: number, practitionerId: number, scenarioId: number) => {
    if (!confirm('確定要刪除此計費方案嗎？')) {
      return;
    }

    try {
      await apiService.deleteBillingScenario(serviceItemId, practitionerId, scenarioId);
      
      // Reload scenarios
      const key = `${serviceItemId}-${practitionerId}`;
      setBillingScenarios(prev => {
        const newPrev = { ...prev };
        delete newPrev[key];
        return newPrev;
      });
      await loadBillingScenarios(serviceItemId, practitionerId);
    } catch (err) {
      logger.error('Error deleting billing scenario:', err);
      alert('刪除失敗，請重試');
    }
  };

  return (
    <div className="space-y-6">
      {/* Service Items List */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="block text-sm font-medium text-gray-700">服務項目</label>
          {isClinicAdmin && (
            <button
              type="button"
              onClick={onAddType}
              className="btn-secondary text-sm"
            >
              新增服務項目
            </button>
          )}
        </div>

        <div className="space-y-4">
          {appointmentTypes.map((type, index) => {
            const isExpanded = expandedServiceItems.has(type.id);
            const durationDisplay = type.scheduling_buffer_minutes && type.scheduling_buffer_minutes > 0
              ? `${type.duration_minutes}分 (+${type.scheduling_buffer_minutes}分)`
              : `${type.duration_minutes}分`;

            return (
              <div key={type.id} className="border border-gray-200 rounded-lg p-4">
                {/* Service Item Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 space-y-3">
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
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        收據項目名稱
                      </label>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          服務時長 (分鐘)
                        </label>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          排程緩衝時間 (分鐘)
                        </label>
                        <input
                          type="number"
                          value={type.scheduling_buffer_minutes || 0}
                          onChange={(e) => {
                            const value = e.target.value;
                            onUpdateType(index, 'scheduling_buffer_minutes', parseInt(value) || 0);
                          }}
                          onWheel={preventScrollWheelChange}
                          className="input"
                          min="0"
                          max="60"
                          disabled={!isClinicAdmin}
                        />
                        {type.scheduling_buffer_minutes && type.scheduling_buffer_minutes > 0 && (
                          <p className="text-xs text-gray-500 mt-1">
                            顯示為：{durationDisplay}
                          </p>
                        )}
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
                  </div>

                  {isClinicAdmin && (
                    <div className="flex items-start ml-4">
                      <button
                        type="button"
                        onClick={() => onRemoveType(index)}
                        className="text-red-600 hover:text-red-800 p-2"
                        title="刪除"
                      >
                        🗑️
                      </button>
                    </div>
                  )}
                </div>

                {/* Practitioner Assignment (Admin Only) */}
                {isClinicAdmin && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        提供此服務的治療師
                      </label>
                      <button
                        type="button"
                        onClick={() => toggleServiceItem(type.id)}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        {isExpanded ? '收起' : '展開'}
                      </button>
                    </div>

                    {isExpanded && (() => {
                      // Get practitioners assigned to this service item
                      const assignedPractitionerIds = practitionerAssignments[type.id] || [];
                      
                      return (
                        <div className="mt-2 space-y-4">
                          <div className="space-y-3">
                              {/* Add Practitioner Button */}
                              <div className="flex items-center space-x-2">
                                <select
                                  className="input flex-1"
                                  value=""
                                  onChange={async (e) => {
                                    const practitionerId = parseInt(e.target.value);
                                    if (practitionerId && !assignedPractitionerIds.includes(practitionerId)) {
                                      // Add practitioner to this service item
                                      try {
                                        const currentTypes = await apiService.getPractitionerAppointmentTypes(practitionerId);
                                        const currentTypeIds = currentTypes.appointment_types.map((at: any) => at.id);
                                        if (!currentTypeIds.includes(type.id)) {
                                          await apiService.updatePractitionerAppointmentTypes(practitionerId, [...currentTypeIds, type.id]);
                                          setPractitionerAssignments(prev => ({
                                            ...prev,
                                            [type.id]: [...(prev[type.id] || []), practitionerId],
                                          }));
                                        }
                                      } catch (err) {
                                        logger.error('Error assigning practitioner:', err);
                                        alert('指派失敗，請重試');
                                      }
                                    }
                                    e.target.value = '';
                                  }}
                                >
                                  <option value="">選擇治療師...</option>
                                  {members
                                    .filter(m => !assignedPractitionerIds.includes(m.id))
                                    .map(member => (
                                      <option key={member.id} value={member.id}>
                                        {member.full_name}
                                      </option>
                                    ))}
                                </select>
                              </div>

                              {/* Assigned Practitioners */}
                              {assignedPractitionerIds.length > 0 && assignedPractitionerIds.map(practitionerId => {
                                const practitioner = members.find(m => m.id === practitionerId);
                                if (!practitioner) return null;

                                const key = `${type.id}-${practitionerId}`;
                                const scenarios = billingScenarios[key] || [];
                                const isLoading = loadingScenarios.has(key);
                                
                                // Load scenarios when service item is expanded
                                if (isExpanded && !billingScenarios[key] && !loadingScenarios.has(key)) {
                                  // Use setTimeout to avoid calling during render
                                  setTimeout(() => loadBillingScenarios(type.id, practitionerId), 0);
                                }

                                return (
                                  <div key={practitionerId} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center space-x-2">
                                        <span className="font-medium text-gray-900">{practitioner.full_name}</span>
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            try {
                                              const currentTypes = await apiService.getPractitionerAppointmentTypes(practitionerId);
                                              const currentTypeIds = currentTypes.appointment_types.map((at: any) => at.id);
                                              await apiService.updatePractitionerAppointmentTypes(
                                                practitionerId,
                                                currentTypeIds.filter((id: number) => id !== type.id)
                                              );
                                              setPractitionerAssignments(prev => ({
                                                ...prev,
                                                [type.id]: (prev[type.id] || []).filter(id => id !== practitionerId),
                                              }));
                                              // Clear billing scenarios for this practitioner-service
                                              setBillingScenarios(prev => {
                                                const newPrev = { ...prev };
                                                delete newPrev[key];
                                                return newPrev;
                                              });
                                            } catch (err) {
                                              logger.error('Error removing practitioner:', err);
                                              alert('移除失敗，請重試');
                                            }
                                          }}
                                          className="text-red-600 hover:text-red-800 text-sm"
                                        >
                                          移除
                                        </button>
                                      </div>
                                    </div>

                                    {/* Billing Scenarios Section */}
                                    <div className="mt-3 pt-3 border-t border-gray-300">
                                      <div className="flex justify-between items-center mb-2">
                                        <label className="text-sm font-medium text-gray-700">計費方案</label>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            // Load scenarios if not loaded
                                            if (!billingScenarios[key] && !loadingScenarios.has(key)) {
                                              loadBillingScenarios(type.id, practitionerId);
                                            }
                                            handleAddScenario(type.id, practitionerId);
                                          }}
                                          className="text-sm text-blue-600 hover:text-blue-800"
                                        >
                                          + 新增方案
                                        </button>
                                      </div>
                                      

                                      {isLoading ? (
                                        <p className="text-sm text-gray-500">載入中...</p>
                                      ) : scenarios.length === 0 ? (
                                        <p className="text-sm text-gray-500">尚無計費方案</p>
                                      ) : (
                                        <div className="space-y-2">
                                          {scenarios.map(scenario => (
                                            <div key={scenario.id} className="flex items-center justify-between bg-white p-2 rounded border border-gray-200">
                                              <div className="flex-1">
                                                <div className="flex items-center space-x-2">
                                                  <span className="font-medium text-gray-900">{scenario.name}</span>
                                                  {scenario.is_default && (
                                                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">預設</span>
                                                  )}
                                                </div>
                                                <div className="text-sm text-gray-600 mt-1">
                                                  金額: ${scenario.amount.toFixed(2)} | 分潤: ${scenario.revenue_share.toFixed(2)}
                                                </div>
                                              </div>
                                              <div className="flex items-center space-x-2">
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    if (!billingScenarios[key]) {
                                                      loadBillingScenarios(type.id, practitionerId);
                                                    }
                                                    handleEditScenario(type.id, practitionerId, scenario);
                                                  }}
                                                  className="text-blue-600 hover:text-blue-800 text-sm"
                                                >
                                                  編輯
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => handleDeleteScenario(type.id, practitionerId, scenario.id)}
                                                  className="text-red-600 hover:text-red-800 text-sm"
                                                >
                                                  刪除
                                                </button>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}

                            {assignedPractitionerIds.length === 0 && (
                              <p className="text-sm text-gray-500 text-center py-4">
                                尚未指派治療師
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

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
                  step="0.01"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  分潤
                </label>
                <input
                  type="number"
                  value={scenarioForm.revenue_share}
                  onChange={(e) => setScenarioForm(prev => ({ ...prev, revenue_share: e.target.value }))}
                  className="input"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                />
                <p className="text-xs text-gray-500 mt-1">
                  分潤必須 &lt;= 金額
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


