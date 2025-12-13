/**
 * CheckoutModal Component
 * 
 * Modal for processing checkout for an appointment (admin-only).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { BaseModal } from './BaseModal';
import { apiService } from '../../services/api';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/currencyUtils';
import { preventScrollWheelChange } from '../../utils/inputUtils';
import { CalendarEvent } from '../../utils/calendarDataAdapter';

interface CheckoutItem {
  service_item_id?: number | undefined;
  practitioner_id?: number | null | undefined;
  billing_scenario_id?: number | null | undefined;
  custom_name?: string | undefined;
  amount: number;
  revenue_share: number;
  quantity?: number;
}

interface CheckoutModalProps {
  event: CalendarEvent;
  appointmentTypes: Array<{ id: number; name: string; receipt_name?: string | null }>;
  practitioners: Array<{ id: number; full_name: string }>;
  onClose: () => void;
  onSuccess: () => void;
}

// Helper function to normalize scenario values (handles string/number types from API)
const normalizeScenarioValue = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? 0 : Math.round(num);
};

// Helper function to determine if custom amount fields should be shown
const shouldShowCustomFields = (item: CheckoutItem, scenarios: any[]): boolean => {
  const hasServiceAndPractitioner = item.service_item_id && item.practitioner_id;
  const noScenarios = scenarios.length === 0;
  const isOtherSelected = item.billing_scenario_id === null;
  const noScenarioSelected = item.billing_scenario_id === undefined;
  
  return (hasServiceAndPractitioner && noScenarios) || isOtherSelected || noScenarioSelected;
};

// Helper function to determine if read-only fields should be shown
const shouldShowReadOnlyFields = (item: CheckoutItem, scenarios: any[]): boolean => {
  return !!(item.service_item_id && item.practitioner_id && scenarios.length > 0 && item.billing_scenario_id != null);
};

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  event,
  appointmentTypes,
  practitioners: _practitioners,
  onClose,
  onSuccess,
}) => {
  const [items, setItems] = useState<CheckoutItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableServiceItems, setAvailableServiceItems] = useState<Array<{ id: number; name: string; receipt_name?: string | null }>>([]);
  const [billingScenarios, setBillingScenarios] = useState<Record<string, any[]>>({});
  const [practitionersByServiceItem, setPractitionersByServiceItem] = useState<Record<number, Array<{ id: number; full_name: string }>>>({});
  const [expandedQuantityItems, setExpandedQuantityItems] = useState<Set<number>>(new Set());

  const loadPractitionersForServiceItem = useCallback(async (serviceItemId: number): Promise<Array<{ id: number; full_name: string }>> => {
    if (practitionersByServiceItem[serviceItemId]) {
      return practitionersByServiceItem[serviceItemId];
    }
    
    try {
      const data = await apiService.getPractitioners(serviceItemId);
      setPractitionersByServiceItem(prev => ({
        ...prev,
        [serviceItemId]: data,
      }));
      return data;
    } catch (err) {
      logger.error('Error loading practitioners for service item:', err);
      return [];
    }
  }, [practitionersByServiceItem]);

  const loadBillingScenarios = useCallback(async (serviceItemId: number, practitionerId: number): Promise<void> => {
    const key = `${serviceItemId}-${practitionerId}`;
    if (billingScenarios[key]) return Promise.resolve();
    
    try {
      const data = await apiService.getBillingScenarios(serviceItemId, practitionerId);
      setBillingScenarios(prev => ({
        ...prev,
        [key]: data.billing_scenarios,
      }));
      return Promise.resolve();
    } catch (err) {
      logger.error('Error loading billing scenarios:', err);
      return Promise.resolve();
    }
  }, [billingScenarios]);

  // Initialize with default item from appointment
  useEffect(() => {
    // Only initialize if appointmentTypes are loaded
    if (appointmentTypes.length === 0) {
      // If no appointment types yet, set empty items and wait for them to load
      setAvailableServiceItems([]);
      return;
    }
    
    const appointmentType = appointmentTypes.find(at => at.id === event.resource.appointment_type_id);
    const practitionerId = event.resource.practitioner_id;
    
    // Load all service items first
    setAvailableServiceItems(appointmentTypes);
    
    if (appointmentType && practitionerId) {
      // Load practitioners and billing scenarios for default item
      Promise.all([
        loadPractitionersForServiceItem(appointmentType.id),
        loadBillingScenarios(appointmentType.id, practitionerId)
      ]).then(() => {
        // Use a callback to access updated state
        setBillingScenarios(prev => {
          const key = `${appointmentType.id}-${practitionerId}`;
          const scenarios = prev[key] || [];
          const defaultScenario = scenarios.find((s: any) => s.is_default);
          // If no default, use first scenario; if no scenarios, use null (custom)
          const selectedScenario = defaultScenario || scenarios[0] || null;
          
          setItems([{
            service_item_id: appointmentType.id,
            practitioner_id: practitionerId,
            billing_scenario_id: selectedScenario?.id || null,
            amount: normalizeScenarioValue(selectedScenario?.amount),
            revenue_share: normalizeScenarioValue(selectedScenario?.revenue_share),
            quantity: 1,
          }]);
          
          return prev; // Return unchanged state
        });
      });
    } else if (appointmentType) {
      // If we have appointment type but no practitioner, load practitioners and set the service item
      loadPractitionersForServiceItem(appointmentType.id).then(() => {
        setItems([{
          service_item_id: appointmentType.id,
          practitioner_id: null,
          billing_scenario_id: null,
          amount: 0,
          revenue_share: 0,
          quantity: 1,
        }]);
      });
    } else {
      // No appointment type, start with empty item
      setItems([{
        amount: 0,
        revenue_share: 0,
        quantity: 1,
      }]);
    }
  }, [event, appointmentTypes, loadBillingScenarios, loadPractitionersForServiceItem, practitionersByServiceItem]);

  const handleAddItem = () => {
    setItems([...items, {
      amount: 0,
      revenue_share: 0,
      quantity: 1,
    }]);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
    // Remove from expanded set and adjust indices
    setExpandedQuantityItems(prev => {
      const newSet = new Set<number>();
      prev.forEach(i => {
        if (i < index) {
          newSet.add(i);
        } else if (i > index) {
          newSet.add(i - 1);
        }
      });
      return newSet;
    });
  };

  const handleItemChange = (index: number, field: keyof CheckoutItem, value: any) => {
    const newItems = [...items];
    const currentItem = newItems[index];
    if (!currentItem) return;
    
    newItems[index] = { ...currentItem, [field]: value };
    
    // Auto-load practitioners when service item changes
    if (field === 'service_item_id') {
      const item = newItems[index];
      if (item && item.service_item_id) {
        // Load practitioners for the selected service item
        loadPractitionersForServiceItem(item.service_item_id).then((loadedPractitioners) => {
          // Clear practitioner and billing scenario if current practitioner is not available for new service
          const currentPractitionerId = item.practitioner_id;
          const isPractitionerValid = !currentPractitionerId || loadedPractitioners.some(p => p.id === currentPractitionerId);
          
          if (!isPractitionerValid && currentPractitionerId) {
            // Current practitioner is not available for this service, clear it
            setItems(prevItems => {
              const updatedItems = [...prevItems];
              const currentItem = updatedItems[index];
              if (currentItem) {
                updatedItems[index] = {
                  ...currentItem,
                  practitioner_id: null,
                  billing_scenario_id: null,
                };
              }
              return updatedItems;
            });
          }
        });
      } else {
        // Service item cleared, clear practitioner and billing scenario
        newItems[index] = {
          ...currentItem,
          practitioner_id: null,
          billing_scenario_id: null,
        };
      }
    }
    
    // Auto-load billing scenarios when service item or practitioner changes
    if (field === 'service_item_id' || field === 'practitioner_id') {
      const item = newItems[index];
      if (item && item.service_item_id && item.practitioner_id) {
        loadBillingScenarios(item.service_item_id, item.practitioner_id).then(() => {
          // Auto-select default scenario after loading using state setter callback
          setBillingScenarios(prev => {
            const key = `${item.service_item_id}-${item.practitioner_id}`;
            const scenarios = prev[key] || [];
            const defaultScenario = scenarios.find((s: any) => s.is_default);
            // If no default, use first scenario; if no scenarios, use null (custom)
            const selectedScenario = defaultScenario || scenarios[0] || null;
            if (selectedScenario && !newItems[index]?.billing_scenario_id) {
              const updatedItems = [...newItems];
              const currentItem = updatedItems[index];
              if (currentItem) {
                updatedItems[index] = {
                  ...currentItem,
                  billing_scenario_id: selectedScenario.id,
                  amount: normalizeScenarioValue(selectedScenario.amount),
                  revenue_share: normalizeScenarioValue(selectedScenario.revenue_share),
                };
                setItems(updatedItems);
              }
            }
            return prev;
          });
        });
      }
    }
    
    // Auto-fill amount and revenue_share when billing scenario is selected
    if (field === 'billing_scenario_id') {
      const item = newItems[index];
      if (item && item.service_item_id && item.practitioner_id) {
        if (value) {
          // A scenario was selected
          const key = `${item.service_item_id}-${item.practitioner_id}`;
          const scenarios = billingScenarios[key] || [];
          const scenario = scenarios.find((s: any) => s.id === value);
          if (scenario) {
            newItems[index] = {
              ...item,
              billing_scenario_id: value,
              amount: normalizeScenarioValue(scenario.amount),
              revenue_share: normalizeScenarioValue(scenario.revenue_share),
            };
          }
        } else {
          // "其他" (Other) was selected - keep current amount/revenue_share values
          // They will be editable
          newItems[index] = {
            ...item,
            billing_scenario_id: null,
          };
        }
      }
    }
    
    setItems(newItems);
  };

  const validateItems = (): string | null => {
    if (items.length === 0) {
      return '請至少新增一個項目';
    }
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      
      if (!item.custom_name && !item.service_item_id) {
        return `項目 ${i + 1}: 請選擇服務項目或輸入自訂項目名稱`;
      }
      
      if (item.amount < 0) {
        return `項目 ${i + 1}: 金額不能為負數`;
      }
      
      if (item.revenue_share < 0) {
        return `項目 ${i + 1}: 診所分潤必須 >= 0`;
      }
      
      if (item.revenue_share > item.amount) {
        return `項目 ${i + 1}: 診所分潤必須 <= 金額`;
      }
      
      const quantity = item.quantity || 1;
      if (quantity < 1 || !Number.isInteger(quantity)) {
        return `項目 ${i + 1}: 數量必須為大於 0 的整數`;
      }
    }
    
    return null;
  };

  const handleCheckout = async () => {
    const validationError = validateItems();
    if (validationError) {
      setError(validationError);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Transform items to API format (only include defined fields)
      const apiItems = items.map((item, index) => {
        const apiItem: any = {
          item_type: item.service_item_id ? 'service_item' : 'other',
          amount: item.amount,
          revenue_share: item.revenue_share,
          display_order: index,
        };
        if (item.service_item_id !== undefined) {
          apiItem.service_item_id = item.service_item_id;
        }
        if (item.practitioner_id !== undefined && item.practitioner_id !== null) {
          apiItem.practitioner_id = item.practitioner_id;
        }
        if (item.billing_scenario_id !== undefined && item.billing_scenario_id !== null) {
          apiItem.billing_scenario_id = item.billing_scenario_id;
        }
        if (item.custom_name !== undefined && !item.service_item_id) {
          // For "other" type items, use item_name instead of custom_name
          apiItem.item_name = item.custom_name;
        }
        // Include quantity (default to 1 if not specified)
        apiItem.quantity = item.quantity || 1;
        return apiItem;
      });
      
      await apiService.checkoutAppointment(
        event.resource.appointment_id!,
        apiItems,
        paymentMethod
      );
      
      onSuccess();
      onClose();
    } catch (err: any) {
      logger.error('Error during checkout:', err);
      setError(getErrorMessage(err) || '結帳失敗，請重試');
    } finally {
      setIsLoading(false);
    }
  };

  const totalAmount = items.reduce((sum, item) => sum + (item.amount * (item.quantity || 1)), 0);
  const totalRevenueShare = items.reduce((sum, item) => sum + (item.revenue_share * (item.quantity || 1)), 0);

  return (
    <BaseModal
      onClose={onClose}
      aria-label="結帳"
    >
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">結帳</h3>
        
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Items List */}
        <div className="space-y-3">
          {items.map((item, index) => {
            if (!item) return null;
            
            const key = item.service_item_id && item.practitioner_id 
              ? `${item.service_item_id}-${item.practitioner_id}` 
              : '';
            const scenarios = billingScenarios[key] || [];
            
            const quantity = item.quantity || 1;
            const isExpanded = expandedQuantityItems.has(index) || quantity > 1;
            
            return (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <span className="font-medium">項目 {index + 1}</span>
                  <div className="flex items-center gap-2">
                    {isExpanded ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const newQty = Math.max(1, quantity - 1);
                            handleItemChange(index, 'quantity', newQty);
                            if (!expandedQuantityItems.has(index)) {
                              setExpandedQuantityItems(prev => new Set(prev).add(index));
                            }
                          }}
                          className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-700 transition-colors"
                          aria-label="減少數量"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          value={quantity}
                          onChange={(e) => {
                            const qty = parseInt(e.target.value) || 1;
                            handleItemChange(index, 'quantity', qty < 1 ? 1 : qty);
                            if (!expandedQuantityItems.has(index)) {
                              setExpandedQuantityItems(prev => new Set(prev).add(index));
                            }
                          }}
                          className="w-12 px-2 py-1 text-sm border border-gray-300 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                          min="1"
                          step="1"
                          onWheel={preventScrollWheelChange}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            handleItemChange(index, 'quantity', quantity + 1);
                            if (!expandedQuantityItems.has(index)) {
                              setExpandedQuantityItems(prev => new Set(prev).add(index));
                            }
                          }}
                          className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-700 transition-colors"
                          aria-label="增加數量"
                        >
                          +
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          handleItemChange(index, 'quantity', 2);
                          setExpandedQuantityItems(prev => new Set(prev).add(index));
                        }}
                        className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-700 transition-colors"
                        aria-label="增加數量"
                      >
                        +
                      </button>
                    )}
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(index)}
                        className="text-red-600 hover:text-red-800 text-sm ml-2"
                      >
                        移除
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="space-y-3">
                  {/* Service Item or Custom Name */}
                  {index === 0 ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        服務項目
                      </label>
                      <select
                        value={item.service_item_id || ''}
                        onChange={(e) => handleItemChange(index, 'service_item_id', e.target.value ? parseInt(e.target.value) : undefined)}
                        className="input"
                      >
                        <option value="">選擇服務項目...</option>
                        {availableServiceItems.map(si => (
                          <option key={si.id} value={si.id}>
                            {si.receipt_name || si.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        自訂項目名稱
                      </label>
                      <input
                        type="text"
                        value={item.custom_name || ''}
                        onChange={(e) => handleItemChange(index, 'custom_name', e.target.value || undefined)}
                        className="input"
                        placeholder="例如：其他服務"
                      />
                    </div>
                  )}
                  
                  {/* Practitioner */}
                  {item.service_item_id && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        治療師
                      </label>
                      <select
                        value={item.practitioner_id || ''}
                        onChange={async (e) => {
                          const practitionerId = e.target.value ? parseInt(e.target.value) : null;
                          handleItemChange(index, 'practitioner_id', practitionerId);
                          
                          // Load billing scenarios when practitioner is selected
                          if (item.service_item_id && practitionerId) {
                            await loadBillingScenarios(item.service_item_id, practitionerId);
                            // Auto-select default scenario, or first scenario if no default, or null if no scenarios
                            const key = `${item.service_item_id}-${practitionerId}`;
                            setBillingScenarios(prev => {
                              const scenarios = prev[key] || [];
                              const defaultScenario = scenarios.find((s: any) => s.is_default);
                              const selectedScenario = defaultScenario || scenarios[0] || null;
                              if (selectedScenario) {
                                handleItemChange(index, 'billing_scenario_id', selectedScenario.id);
                                handleItemChange(index, 'amount', normalizeScenarioValue(selectedScenario.amount));
                                handleItemChange(index, 'revenue_share', normalizeScenarioValue(selectedScenario.revenue_share));
                              } else {
                                // No scenarios, set to null (custom)
                                handleItemChange(index, 'billing_scenario_id', null);
                              }
                              return prev;
                            });
                          }
                        }}
                        className="input"
                      >
                        <option value="">無</option>
                        {(() => {
                          // Show practitioners filtered by service item
                          if (item.service_item_id) {
                            const availablePractitioners = practitionersByServiceItem[item.service_item_id] || [];
                            return availablePractitioners.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.full_name}
                              </option>
                            ));
                          }
                          return null;
                        })()}
                      </select>
                    </div>
                  )}
                  
                  {/* Billing Scenario */}
                  {item.service_item_id && item.practitioner_id && scenarios.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        計費方案
                      </label>
                      <select
                        value={item.billing_scenario_id != null ? item.billing_scenario_id : ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          handleItemChange(index, 'billing_scenario_id', value ? parseInt(value) : null);
                        }}
                        className="input"
                      >
                        {scenarios.map((s: any) => {
                          const amount = typeof s.amount === 'string' ? parseFloat(s.amount) : s.amount;
                          const revenueShare = typeof s.revenue_share === 'string' ? parseFloat(s.revenue_share) : s.revenue_share;
                          return (
                            <option key={s.id} value={s.id}>
                              {s.name} ({formatCurrency(isNaN(amount) ? 0 : amount)} / {formatCurrency(isNaN(revenueShare) ? 0 : revenueShare)})
                            </option>
                          );
                        })}
                        <option value="">其他</option>
                      </select>
                    </div>
                  )}
                  
                  {/* Custom Amount/Revenue Share */}
                  {shouldShowCustomFields(item, scenarios) && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          金額
                        </label>
                        <input
                          type="number"
                          value={Math.round(item.amount || 0)}
                          onChange={(e) => {
                            const value = parseFloat(e.target.value) || 0;
                            handleItemChange(index, 'amount', Math.round(value));
                          }}
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
                          value={Math.round(item.revenue_share || 0)}
                          onChange={(e) => {
                            const value = parseFloat(e.target.value) || 0;
                            handleItemChange(index, 'revenue_share', Math.round(value));
                          }}
                          className="input"
                          min="0"
                          step="1"
                          placeholder="0"
                          onWheel={preventScrollWheelChange}
                        />
                      </div>
                    </div>
                  )}
                  
                  {/* Read-only amount/revenue_share when a scenario is selected */}
                  {shouldShowReadOnlyFields(item, scenarios) && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          金額
                        </label>
                        <div className="input bg-gray-50 cursor-not-allowed flex items-center">
                          {formatCurrency(Math.round(item.amount || 0))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          診所分潤
                        </label>
                        <div className="input bg-gray-50 cursor-not-allowed flex items-center">
                          {formatCurrency(Math.round(item.revenue_share || 0))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleAddItem}
          className="btn-secondary text-sm"
        >
          + 新增項目
        </button>

        {/* Totals */}
        <div className="border-t border-gray-200 pt-4 space-y-2">
          <div className="flex justify-between">
            <span className="font-medium">收據金額:</span>
            <span className="font-semibold">{formatCurrency(totalAmount)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>診所分潤 (內部):</span>
            <span>{formatCurrency(totalRevenueShare)}</span>
          </div>
        </div>

        {/* Payment Method */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            付款方式
          </label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="input"
          >
            <option value="cash">現金</option>
            <option value="card">刷卡</option>
            <option value="transfer">轉帳</option>
            <option value="other">其他</option>
          </select>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            disabled={isLoading}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleCheckout}
            className="btn-primary"
            disabled={isLoading}
          >
            {isLoading ? '處理中...' : '結帳'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};


