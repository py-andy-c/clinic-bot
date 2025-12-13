/**
 * CheckoutModal Component
 * 
 * Modal for processing checkout for an appointment (admin-only).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { BaseModal } from './BaseModal';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { CalendarEvent } from '../../utils/calendarDataAdapter';

interface CheckoutItem {
  service_item_id?: number | undefined;
  practitioner_id?: number | null | undefined;
  billing_scenario_id?: number | null | undefined;
  custom_name?: string | undefined;
  amount: number;
  revenue_share: number;
}

interface CheckoutModalProps {
  event: CalendarEvent;
  appointmentTypes: Array<{ id: number; name: string; receipt_name?: string | null }>;
  practitioners: Array<{ id: number; full_name: string }>;
  onClose: () => void;
  onSuccess: () => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  event,
  appointmentTypes,
  practitioners,
  onClose,
  onSuccess,
}) => {
  const [items, setItems] = useState<CheckoutItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableServiceItems, setAvailableServiceItems] = useState<Array<{ id: number; name: string; receipt_name?: string | null }>>([]);
  const [billingScenarios, setBillingScenarios] = useState<Record<string, any[]>>({});

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
      // Load billing scenarios for default item
      loadBillingScenarios(appointmentType.id, practitionerId).then(() => {
        // Use a callback to access updated state
        setBillingScenarios(prev => {
          const key = `${appointmentType.id}-${practitionerId}`;
          const scenarios = prev[key] || [];
          const defaultScenario = scenarios.find((s: any) => s.is_default);
          
          setItems([{
            service_item_id: appointmentType.id,
            practitioner_id: practitionerId,
            billing_scenario_id: defaultScenario?.id || null,
            amount: defaultScenario?.amount || 0,
            revenue_share: defaultScenario?.revenue_share || 0,
          }]);
          
          return prev; // Return unchanged state
        });
      });
    } else if (appointmentType) {
      // If we have appointment type but no practitioner, still set the service item
      setItems([{
        service_item_id: appointmentType.id,
        practitioner_id: null,
        billing_scenario_id: null,
        amount: 0,
        revenue_share: 0,
      }]);
    } else {
      // No appointment type, start with empty item
      setItems([{
        amount: 0,
        revenue_share: 0,
      }]);
    }
  }, [event, appointmentTypes, loadBillingScenarios]);

  const handleAddItem = () => {
    setItems([...items, {
      amount: 0,
      revenue_share: 0,
    }]);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof CheckoutItem, value: any) => {
    const newItems = [...items];
    const currentItem = newItems[index];
    if (!currentItem) return;
    
    newItems[index] = { ...currentItem, [field]: value };
    
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
            if (defaultScenario && !newItems[index]?.billing_scenario_id) {
              const updatedItems = [...newItems];
              const currentItem = updatedItems[index];
              if (currentItem) {
                // Normalize amount and revenue_share to handle both string and number types from API
                const normalizedAmount = typeof defaultScenario.amount === 'string' ? parseFloat(defaultScenario.amount) : defaultScenario.amount;
                const normalizedRevenueShare = typeof defaultScenario.revenue_share === 'string' ? parseFloat(defaultScenario.revenue_share) : defaultScenario.revenue_share;
                updatedItems[index] = {
                  ...currentItem,
                  billing_scenario_id: defaultScenario.id,
                  amount: isNaN(normalizedAmount) ? 0 : normalizedAmount,
                  revenue_share: isNaN(normalizedRevenueShare) ? 0 : normalizedRevenueShare,
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
    if (field === 'billing_scenario_id' && value) {
      const item = newItems[index];
      if (item && item.service_item_id && item.practitioner_id) {
        const key = `${item.service_item_id}-${item.practitioner_id}`;
        const scenarios = billingScenarios[key] || [];
        const scenario = scenarios.find((s: any) => s.id === value);
        if (scenario) {
          // Normalize amount and revenue_share to handle both string and number types from API
          const normalizedAmount = typeof scenario.amount === 'string' ? parseFloat(scenario.amount) : scenario.amount;
          const normalizedRevenueShare = typeof scenario.revenue_share === 'string' ? parseFloat(scenario.revenue_share) : scenario.revenue_share;
          newItems[index] = {
            ...item,
            amount: isNaN(normalizedAmount) ? 0 : normalizedAmount,
            revenue_share: isNaN(normalizedRevenueShare) ? 0 : normalizedRevenueShare,
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
      
      if (item.amount <= 0) {
        return `項目 ${i + 1}: 金額必須大於 0`;
      }
      
      if (item.revenue_share < 0) {
        return `項目 ${i + 1}: 診所分潤必須 >= 0`;
      }
      
      if (item.revenue_share > item.amount) {
        return `項目 ${i + 1}: 診所分潤必須 <= 金額`;
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
      setError(err.response?.data?.detail || '結帳失敗，請重試');
    } finally {
      setIsLoading(false);
    }
  };

  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const totalRevenueShare = items.reduce((sum, item) => sum + item.revenue_share, 0);

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
            const defaultScenario = scenarios.find((s: any) => s.is_default);
            
            return (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <span className="font-medium">項目 {index + 1}</span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(index)}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      移除
                    </button>
                  )}
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
                            // Auto-select default scenario
                            const key = `${item.service_item_id}-${practitionerId}`;
                            setBillingScenarios(prev => {
                              const scenarios = prev[key] || [];
                              const defaultScenario = scenarios.find((s: any) => s.is_default);
                              if (defaultScenario) {
                                handleItemChange(index, 'billing_scenario_id', defaultScenario.id);
                                handleItemChange(index, 'amount', defaultScenario.amount);
                                handleItemChange(index, 'revenue_share', defaultScenario.revenue_share);
                              }
                              return prev;
                            });
                          }
                        }}
                        className="input"
                      >
                        <option value="">不指定</option>
                        {practitioners.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.full_name}
                          </option>
                        ))}
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
                        value={item.billing_scenario_id || defaultScenario?.id || ''}
                        onChange={(e) => handleItemChange(index, 'billing_scenario_id', e.target.value ? parseInt(e.target.value) : null)}
                        className="input"
                      >
                        <option value="">選擇方案...</option>
                        {scenarios.map((s: any) => {
                          const amount = typeof s.amount === 'string' ? parseFloat(s.amount) : s.amount;
                          return (
                            <option key={s.id} value={s.id}>
                              {s.name} (${isNaN(amount) ? '0.00' : amount.toFixed(2)})
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}
                  
                  {/* Custom Amount/Revenue Share */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        金額
                      </label>
                      <input
                        type="number"
                        value={item.amount || ''}
                        onChange={(e) => handleItemChange(index, 'amount', parseFloat(e.target.value) || 0)}
                        className="input"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        診所分潤
                      </label>
                      <input
                        type="number"
                        value={item.revenue_share || ''}
                        onChange={(e) => handleItemChange(index, 'revenue_share', parseFloat(e.target.value) || 0)}
                        className="input"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>
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
            <span className="font-semibold">${totalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>診所分潤 (內部):</span>
            <span>${totalRevenueShare.toFixed(2)}</span>
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


