/**
 * CheckoutModal Component
 * 
 * Modal for processing checkout for an appointment (admin-only).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { BaseModal } from './BaseModal';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/currencyUtils';
import { preventScrollWheelChange } from '../../utils/inputUtils';
import { CalendarEvent } from '../../utils/calendarDataAdapter';

interface CheckoutItem {
  service_item_id?: number | 'other' | undefined; // 'other' represents "其他"
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

// Helper function to check if "其他" (Other) is selected as service item
const isOtherServiceItem = (serviceItemId: number | 'other' | undefined): boolean => {
  return serviceItemId === 'other';
};

// Helper function to determine if custom amount fields should be shown
const shouldShowCustomFields = (item: CheckoutItem, scenarios: any[]): boolean => {
  // Show custom fields when:
  // 1. "其他" is selected as service item
  // 2. No scenarios exist but service item and practitioner are set
  // 3. "其他" billing scenario is selected (billing_scenario_id is null)
  // 4. No billing scenario is selected yet
  if (isOtherServiceItem(item.service_item_id)) return true;
  
  const hasServiceAndPractitioner = item.service_item_id && item.practitioner_id;
  const noScenarios = scenarios.length === 0;
  const isOtherScenarioSelected = item.billing_scenario_id === null;
  const noScenarioSelected = item.billing_scenario_id === undefined;
  
  return (hasServiceAndPractitioner && noScenarios) || isOtherScenarioSelected || noScenarioSelected;
};

// Helper function to determine if read-only fields should be shown
const shouldShowReadOnlyFields = (item: CheckoutItem, scenarios: any[]): boolean => {
  // Don't show read-only fields if "其他" is selected as service item
  if (isOtherServiceItem(item.service_item_id)) return false;
  
  return !!(item.service_item_id && item.practitioner_id && scenarios.length > 0 && item.billing_scenario_id != null);
};

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
  const [practitionersByServiceItem, setPractitionersByServiceItem] = useState<Record<number, Array<{ id: number; full_name: string }>>>({});
  const [expandedQuantityItems, setExpandedQuantityItems] = useState<Set<number>>(new Set());
  
  // Use ref to track which appointment we've initialized for to prevent re-initialization
  const initializedForAppointmentId = React.useRef<number | null>(null);

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

  const loadBillingScenarios = useCallback(async (serviceItemId: number, practitionerId: number): Promise<any[]> => {
    const key = `${serviceItemId}-${practitionerId}`;
    if (billingScenarios[key]) {
      return billingScenarios[key];
    }
    
    try {
      const data = await apiService.getBillingScenarios(serviceItemId, practitionerId);
      setBillingScenarios(prev => ({
        ...prev,
        [key]: data.billing_scenarios,
      }));
      return data.billing_scenarios;
    } catch (err) {
      logger.error('Error loading billing scenarios:', err);
      return [];
    }
  }, [billingScenarios]);

  // Initialize with default item from appointment
  useEffect(() => {
    const appointmentId = event.resource.appointment_id;
    
    // Only initialize if appointmentTypes are loaded
    if (appointmentTypes.length === 0) {
      // If no appointment types yet, set empty items and wait for them to load
      setAvailableServiceItems([]);
      return;
    }
    
    // Don't re-initialize if we've already initialized for this appointment
    if (initializedForAppointmentId.current === appointmentId) {
      return;
    }
    
    const appointmentType = appointmentTypes.find(at => at.id === event.resource.appointment_type_id);
    const practitionerId = event.resource.practitioner_id;
    
    // Mark as initialized for this appointment to prevent re-running
    initializedForAppointmentId.current = appointmentId;
    
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
      // If we have appointment type but no practitioner, still set the service item
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
  }, [event, appointmentTypes]); // Removed loadBillingScenarios and loadPractitionersForServiceItem from deps

  const handleAddItem = () => {
    // Auto-select from appointment context
    const appointmentType = appointmentTypes.find(at => at.id === event.resource.appointment_type_id);
    const practitionerId = event.resource.practitioner_id;
    
    if (appointmentType && practitionerId) {
      // Load practitioners and billing scenarios, then add item
      Promise.all([
        loadPractitionersForServiceItem(appointmentType.id),
        loadBillingScenarios(appointmentType.id, practitionerId)
      ]).then(() => {
        setBillingScenarios(prev => {
          const key = `${appointmentType.id}-${practitionerId}`;
          const scenarios = prev[key] || [];
          const defaultScenario = scenarios.find((s: any) => s.is_default);
          const selectedScenario = defaultScenario || scenarios[0] || null;
          
          setItems(prev => [...prev, {
            service_item_id: appointmentType.id,
            practitioner_id: practitionerId,
            billing_scenario_id: selectedScenario?.id || null,
            amount: normalizeScenarioValue(selectedScenario?.amount),
            revenue_share: normalizeScenarioValue(selectedScenario?.revenue_share),
            quantity: 1,
          }]);
          
          return prev;
        });
      });
    } else if (appointmentType) {
      loadPractitionersForServiceItem(appointmentType.id).then(() => {
        setItems(prev => [...prev, {
          service_item_id: appointmentType.id,
          practitioner_id: null,
          billing_scenario_id: null,
          amount: 0,
          revenue_share: 0,
          quantity: 1,
        }]);
      });
    } else {
      setItems(prev => [...prev, {
        amount: 0,
        revenue_share: 0,
        quantity: 1,
      }]);
    }
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

  const handleItemChange = async (index: number, field: keyof CheckoutItem, value: any) => {
    // Special handling for practitioner_id - update immediately, then handle async
    if (field === 'practitioner_id') {
      const practitionerId = value ? parseInt(value) : null;
      
      // Update practitioner immediately using functional update
      setItems(currentItems => {
        const item = currentItems[index];
        if (!item) return currentItems;
        
        const serviceItemId = item.service_item_id;
        const newItems = [...currentItems];
        newItems[index] = {
          ...item,
          practitioner_id: practitionerId,
        };
        
        // Handle async loading separately
        // Use setTimeout to ensure the state update completes before async callback runs
        // This prevents race conditions where the async callback reads stale state
        if (serviceItemId && typeof serviceItemId === 'number' && practitionerId) {
          setTimeout(() => {
            loadBillingScenarios(serviceItemId, practitionerId).then(scenarios => {
              setItems(prevItems => {
                const updatedItems = [...prevItems];
                const updatedItem = updatedItems[index];
                
                // Verify this item still has the same practitioner
                if (!updatedItem || updatedItem.practitioner_id !== practitionerId) {
                  return prevItems;
                }
                
                const currentScenarioId = updatedItem.billing_scenario_id;
                const isScenarioValid = currentScenarioId && 
                  scenarios.some(s => s.id === currentScenarioId);
                
                if (!isScenarioValid) {
                  const defaultScenario = scenarios.find((s: any) => s.is_default);
                  const selectedScenario = defaultScenario || scenarios[0] || null;
                  updatedItems[index] = {
                    ...updatedItem,
                    billing_scenario_id: selectedScenario?.id || null,
                    amount: normalizeScenarioValue(selectedScenario?.amount),
                    revenue_share: normalizeScenarioValue(selectedScenario?.revenue_share),
                  };
                }
                
                return updatedItems;
              });
            });
          }, 0);
        } else {
          // No practitioner or "其他" service item, clear billing scenario
          newItems[index].billing_scenario_id = null;
          newItems[index].amount = item.amount || 0;
          newItems[index].revenue_share = item.revenue_share || 0;
        }
        
        return newItems;
      });
      return;
    }
    
    // Handle other fields
    setItems(currentItems => {
      const newItems = [...currentItems];
      const currentItem = newItems[index];
      if (!currentItem) return currentItems;
    
      // Handle service_item_id changes
      if (field === 'service_item_id') {
      const isOther = value === 'other' || value === '';
      const serviceItemId = isOther ? 'other' : (value ? parseInt(value) : undefined);
      
      newItems[index] = {
        ...currentItem,
        service_item_id: serviceItemId,
        // Reset custom_name if switching away from "其他"
        custom_name: isOther ? currentItem.custom_name : undefined,
      };
      
      // If "其他" is selected, clear practitioner and billing scenario
      if (isOther) {
        newItems[index].practitioner_id = null;
        newItems[index].billing_scenario_id = null;
        newItems[index].amount = currentItem.amount || 0;
        newItems[index].revenue_share = currentItem.revenue_share || 0;
      } else if (serviceItemId && typeof serviceItemId === 'number') {
        // Load practitioners asynchronously and update state
        loadPractitionersForServiceItem(serviceItemId).then(availablePractitioners => {
          setItems(prevItems => {
            const updatedItems = [...prevItems];
            const updatedItem = updatedItems[index];
            if (!updatedItem || updatedItem.service_item_id !== serviceItemId) return prevItems;
            
            const currentPractitionerId = updatedItem.practitioner_id;
            const isPractitionerValid = currentPractitionerId && 
              availablePractitioners.some(p => p.id === currentPractitionerId);
            
            if (!isPractitionerValid) {
              updatedItems[index] = {
                ...updatedItem,
                practitioner_id: null,
                billing_scenario_id: null,
                amount: 0,
                revenue_share: 0,
              };
            } else {
              // Practitioner is still valid, check billing scenario
              loadBillingScenarios(serviceItemId, currentPractitionerId).then(scenarios => {
                setItems(prevItems2 => {
                  const updatedItems2 = [...prevItems2];
                  const updatedItem2 = updatedItems2[index];
                  if (!updatedItem2 || updatedItem2.practitioner_id !== currentPractitionerId) return prevItems2;
                  
                  const currentScenarioId = updatedItem2.billing_scenario_id;
                  const isScenarioValid = currentScenarioId && 
                    scenarios.some(s => s.id === currentScenarioId);
                  
                  if (!isScenarioValid) {
                    const defaultScenario = scenarios.find((s: any) => s.is_default);
                    const selectedScenario = defaultScenario || scenarios[0] || null;
                    updatedItems2[index] = {
                      ...updatedItem2,
                      billing_scenario_id: selectedScenario?.id || null,
                      amount: normalizeScenarioValue(selectedScenario?.amount),
                      revenue_share: normalizeScenarioValue(selectedScenario?.revenue_share),
                    };
                  }
                  
                  return updatedItems2;
                });
              });
            }
            
            return updatedItems;
          });
        });
      }
    }
    // Handle billing_scenario_id changes
    else if (field === 'billing_scenario_id') {
      const item = newItems[index];
      if (item && item.service_item_id && typeof item.service_item_id === 'number' && item.practitioner_id) {
        if (value) {
          // A scenario was selected
          const key = `${item.service_item_id}-${item.practitioner_id}`;
          const scenarios = billingScenarios[key] || [];
          const scenario = scenarios.find((s: any) => s.id === value);
          if (scenario) {
            newItems[index] = {
              ...item,
              amount: normalizeScenarioValue(scenario.amount),
              revenue_share: normalizeScenarioValue(scenario.revenue_share),
            };
          }
        } else {
          // "其他" (Other) was selected - keep current amount/revenue_share values
          // They will be editable
        }
      }
    }
    // Handle other fields
    else {
      newItems[index] = { ...currentItem, [field]: value };
    }
    
      return newItems;
    });
  };

  const validateItems = (): string | null => {
    if (items.length === 0) {
      return '請至少新增一個項目';
    }
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      
      if (isOtherServiceItem(item.service_item_id) && !item.custom_name) {
        return `項目 ${i + 1}: 請輸入自訂項目名稱`;
      }
      if (!isOtherServiceItem(item.service_item_id) && !item.service_item_id) {
        return `項目 ${i + 1}: 請選擇服務項目`;
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
        const itemIsOther = isOtherServiceItem(item.service_item_id);
        const apiItem: any = {
          item_type: itemIsOther ? 'other' : (item.service_item_id ? 'service_item' : 'other'),
          amount: item.amount,
          revenue_share: item.revenue_share,
          display_order: index,
        };
        if (!itemIsOther && item.service_item_id !== undefined && typeof item.service_item_id === 'number') {
          apiItem.service_item_id = item.service_item_id;
        }
        if (item.practitioner_id !== undefined && item.practitioner_id !== null) {
          apiItem.practitioner_id = item.practitioner_id;
        }
        if (!itemIsOther && item.billing_scenario_id !== undefined && item.billing_scenario_id !== null) {
          apiItem.billing_scenario_id = item.billing_scenario_id;
        }
        if (itemIsOther && item.custom_name !== undefined) {
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
      setError(err.response?.data?.detail || '結帳失敗，請重試');
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
            
            const key = item.service_item_id && typeof item.service_item_id === 'number' && item.practitioner_id 
              ? `${item.service_item_id}-${item.practitioner_id}` 
              : '';
            const scenarios = billingScenarios[key] || [];
            const defaultScenario = scenarios.find((s: any) => s.is_default);
            
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
                  {/* Service Item */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      服務項目
                    </label>
                    <select
                      value={item.service_item_id === 'other' ? 'other' : (item.service_item_id || '')}
                      onChange={(e) => {
                        const value = e.target.value;
                        handleItemChange(index, 'service_item_id', value === 'other' ? 'other' : (value ? parseInt(value) : undefined));
                      }}
                      className="input"
                    >
                      <option value="">選擇服務項目...</option>
                      {availableServiceItems.map(si => (
                        <option key={si.id} value={si.id}>
                          {si.receipt_name || si.name}
                        </option>
                      ))}
                      <option value="other">其他</option>
                    </select>
                  </div>
                  
                  {/* Custom Name (only when "其他" is selected) */}
                  {isOtherServiceItem(item.service_item_id) && (
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
                        onChange={(e) => {
                          const practitionerId = e.target.value ? parseInt(e.target.value) : null;
                          handleItemChange(index, 'practitioner_id', practitionerId);
                        }}
                        className="input"
                      >
                        <option value="">無</option>
                        {(() => {
                          // Show all practitioners if "其他" is selected, otherwise filter by service item
                          if (isOtherServiceItem(item.service_item_id)) {
                            return practitioners.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.full_name}
                              </option>
                            ));
                          } else if (item.service_item_id && typeof item.service_item_id === 'number') {
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
                  
                  {/* Billing Scenario (only when not "其他" service item) */}
                  {!isOtherServiceItem(item.service_item_id) && item.service_item_id && typeof item.service_item_id === 'number' && item.practitioner_id && scenarios.length > 0 && (
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


