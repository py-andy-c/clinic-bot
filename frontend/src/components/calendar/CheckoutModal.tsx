/**
 * CheckoutModal Component
 * 
 * Modal for processing checkout for an appointment (admin-only).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BaseModal } from './BaseModal';
import { ServiceItemSelectionModal } from './ServiceItemSelectionModal';
import { apiService } from '../../services/api';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/currencyUtils';
import { NumberInput } from '../shared/NumberInput';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { AppointmentType, ServiceTypeGroup, BillingScenario } from '../../types';

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
  appointmentTypes: AppointmentType[];
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

// Helper function to determine if custom amount fields should be shown (editable)
const shouldShowCustomFields = (item: CheckoutItem, scenarios: BillingScenario[]): boolean => {
  // Service item is "其他" (undefined)
  if (!item.service_item_id) {
    return true;
  }
  
  // Practitioner is "無" (null)
  if (item.practitioner_id === null) {
    return true;
  }
  
  // Billing scenario is "其他" (null)
  if (item.billing_scenario_id === null) {
    return true;
  }
  
  // No billing scenarios available
  if (scenarios.length === 0) {
    return true;
  }
  
  return false;
};

// Helper function to determine if read-only fields should be shown
const shouldShowReadOnlyFields = (item: CheckoutItem, scenarios: BillingScenario[]): boolean => {
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
  const [availableServiceItems, setAvailableServiceItems] = useState<AppointmentType[]>([]);
  const [billingScenarios, setBillingScenarios] = useState<Record<string, BillingScenario[]>>({});
  const [practitionersByServiceItem, setPractitionersByServiceItem] = useState<Record<number, Array<{ id: number; full_name: string }>>>({});
  const [expandedQuantityItems, setExpandedQuantityItems] = useState<Set<number>>(new Set());
  const [groups, setGroups] = useState<ServiceTypeGroup[]>([]);
  const [isServiceItemModalOpen, setIsServiceItemModalOpen] = useState(false);
  const [currentItemIndex, setCurrentItemIndex] = useState<number | null>(null);
  const isInitializedRef = useRef(false);

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

  // Helper function to apply billing scenario to an item
  const applyBillingScenarioToItem = useCallback(async (
    index: number,
    serviceItemId: number,
    practitionerId: number,
    preserveServiceItemId: boolean = false
  ): Promise<void> => {
    try {
      await loadBillingScenarios(serviceItemId, practitionerId);
      
      // Read scenarios from state using setBillingScenarios callback to get latest state
      setBillingScenarios(prev => {
        const key = `${serviceItemId}-${practitionerId}`;
        const scenarios = prev[key] || [];
        const defaultScenario = scenarios.find((s: BillingScenario) => s.is_default);
        const selectedScenario = defaultScenario || scenarios[0] || null;
        
        setItems(prevItems => {
          const updatedItems = [...prevItems];
          const item = updatedItems[index];
          if (!item) return prevItems;
          
          if (selectedScenario) {
            // Scenario exists - set values from scenario
            updatedItems[index] = {
              ...item,
              ...(preserveServiceItemId && { service_item_id: serviceItemId }),
              billing_scenario_id: selectedScenario.id,
              amount: normalizeScenarioValue(selectedScenario.amount),
              revenue_share: normalizeScenarioValue(selectedScenario.revenue_share),
            };
          } else {
            // No scenarios available - reset to 0 and clear billing scenario
            updatedItems[index] = {
              ...item,
              ...(preserveServiceItemId && { service_item_id: serviceItemId }),
              billing_scenario_id: null,
              amount: 0,
              revenue_share: 0,
            };
          }
          return updatedItems;
        });
        
        return prev;
      });
    } catch (err) {
      logger.error('Error applying billing scenario to item:', err);
      // On error, reset to 0
      setItems(prevItems => {
        const updatedItems = [...prevItems];
        const item = updatedItems[index];
        if (item) {
          updatedItems[index] = {
            ...item,
            ...(preserveServiceItemId && { service_item_id: serviceItemId }),
            billing_scenario_id: null,
            amount: 0,
            revenue_share: 0,
          };
        }
        return updatedItems;
      });
    }
  }, [loadBillingScenarios]);

  // Initialize with default item from appointment
  useEffect(() => {
    // Only initialize once, and only if appointmentTypes are loaded
    if (isInitializedRef.current || appointmentTypes.length === 0) {
      if (appointmentTypes.length > 0) {
        setAvailableServiceItems(appointmentTypes);
      }
      return;
    }
    
    const appointmentTypeId = event.resource.appointment_type_id;
    const practitionerId = event.resource.practitioner_id;
    
    // Load all service items
    setAvailableServiceItems(appointmentTypes);
    
    // Initialize first item from appointment context
    if (appointmentTypeId && practitionerId) {
      // Load practitioners and billing scenarios
      Promise.all([
        loadPractitionersForServiceItem(appointmentTypeId),
        loadBillingScenarios(appointmentTypeId, practitionerId)
      ]).then(() => {
        // Use state setter callback to access updated billing scenarios
        setBillingScenarios(prev => {
          const key = `${appointmentTypeId}-${practitionerId}`;
          const scenarios = prev[key] || [];
          const defaultScenario = scenarios.find((s: BillingScenario) => s.is_default);
          const selectedScenario = defaultScenario || scenarios[0] || null;
          
          setItems([{
            service_item_id: appointmentTypeId,
            practitioner_id: practitionerId,
            billing_scenario_id: selectedScenario?.id || null,
            amount: normalizeScenarioValue(selectedScenario?.amount),
            revenue_share: normalizeScenarioValue(selectedScenario?.revenue_share),
            quantity: 1,
          }]);
          
          isInitializedRef.current = true;
          return prev;
        });
      });
    } else if (appointmentTypeId) {
      // Only appointment type, no practitioner
      loadPractitionersForServiceItem(appointmentTypeId).then(() => {
        setItems([{
          service_item_id: appointmentTypeId,
          practitioner_id: null,
          billing_scenario_id: null,
          amount: 0,
          revenue_share: 0,
          quantity: 1,
        }]);
        isInitializedRef.current = true;
      });
    } else {
      // No appointment context
      setItems([{
        amount: 0,
        revenue_share: 0,
        quantity: 1,
      }]);
      isInitializedRef.current = true;
    }
     
    // Note: Using appointmentTypes.length instead of appointmentTypes array to prevent
    // re-initialization when the array reference changes but contents are the same.
    // We only need to re-initialize when the length changes (items added/removed).
    // isInitializedRef guards against duplicate initialization.
  }, [event.resource.appointment_type_id, event.resource.practitioner_id, appointmentTypes.length]);

  // Fetch groups on mount
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const response = await apiService.getServiceTypeGroups();
        setGroups(response.groups || []);
      } catch (err) {
        logger.error('Error loading service type groups:', err);
        setGroups([]);
      }
    };
    fetchGroups();
  }, []);

  const hasGrouping = groups.length > 0;

  const handleAddItem = async () => {
    const appointmentTypeId = event.resource.appointment_type_id;
    const practitionerId = event.resource.practitioner_id;
    
    if (appointmentTypeId && practitionerId) {
      // Load practitioners and billing scenarios
      await Promise.all([
        loadPractitionersForServiceItem(appointmentTypeId),
        loadBillingScenarios(appointmentTypeId, practitionerId)
      ]);
      
      setBillingScenarios(prev => {
        const key = `${appointmentTypeId}-${practitionerId}`;
        const scenarios = prev[key] || [];
        const defaultScenario = scenarios.find((s: BillingScenario) => s.is_default);
        const selectedScenario = defaultScenario || scenarios[0] || null;
        
        const newItem: CheckoutItem = {
          service_item_id: appointmentTypeId,
          practitioner_id: practitionerId,
          billing_scenario_id: selectedScenario?.id || null,
          amount: normalizeScenarioValue(selectedScenario?.amount),
          revenue_share: normalizeScenarioValue(selectedScenario?.revenue_share),
          quantity: 1,
        };
        
        setItems([...items, newItem]);
        return prev;
      });
    } else if (appointmentTypeId) {
      await loadPractitionersForServiceItem(appointmentTypeId);
      setItems([...items, {
        service_item_id: appointmentTypeId,
        practitioner_id: null,
        billing_scenario_id: null,
        amount: 0,
        revenue_share: 0,
        quantity: 1,
      }]);
    } else {
      setItems([...items, {
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

  const handleItemChange = (index: number, field: keyof CheckoutItem, value: string | number | null | undefined) => {
    const newItems = [...items];
    const currentItem = newItems[index];
    if (!currentItem) return;
    
    // Handle service item change
    if (field === 'service_item_id') {
      const newServiceItemId = value;
      const wasOther = !currentItem.service_item_id;
      
      if (newServiceItemId) {
        // Regular service item selected - update immediately using functional update
        setItems(prevItems => {
          const updatedItems = [...prevItems];
          const item = updatedItems[index];
          if (!item) return prevItems;
          
          updatedItems[index] = {
            ...item,
            service_item_id: newServiceItemId,
            custom_name: undefined, // Clear custom name
            billing_scenario_id: null, // Clear billing scenario (will be reloaded)
            amount: 0,
            revenue_share: 0,
          };
          
          return updatedItems;
        });
        
        // Load practitioners for the service item
        loadPractitionersForServiceItem(newServiceItemId).then((loadedPractitioners) => {
          setItems(prevItems => {
            const updatedItems = [...prevItems];
            const item = updatedItems[index];
            if (!item) return prevItems;
            
            // Ensure service_item_id is preserved (it should already be set, but double-check)
            if (item.service_item_id !== newServiceItemId) {
              // Preserve the new service item ID
              updatedItems[index] = {
                ...item,
                service_item_id: newServiceItemId,
              };
            }
            
            // Check if current practitioner offers this service
            const currentPractitionerId = item.practitioner_id;
            const isPractitionerValid = !currentPractitionerId || loadedPractitioners.some(p => p.id === currentPractitionerId);
            
            if (!isPractitionerValid && currentPractitionerId) {
              // Current practitioner doesn't offer this service, set to "無"
              updatedItems[index] = {
                ...item,
                service_item_id: newServiceItemId, // Preserve service item ID
                practitioner_id: null,
                billing_scenario_id: null,
                amount: 0,
                revenue_share: 0,
              };
            }
            
            // Load billing scenarios if practitioner is selected and valid
            if (isPractitionerValid && currentPractitionerId) {
              applyBillingScenarioToItem(index, newServiceItemId, currentPractitionerId, true);
            }
            
            return updatedItems;
          });
        });
      } else {
        // "其他" selected
        newItems[index] = {
          ...currentItem,
          service_item_id: undefined,
          practitioner_id: null,
          billing_scenario_id: null,
          amount: wasOther ? currentItem.amount : 0,
          revenue_share: wasOther ? currentItem.revenue_share : 0,
          custom_name: currentItem.custom_name, // Keep custom name if it exists
        };
        setItems(newItems);
      }
    }
    
    // Handle practitioner change
    else if (field === 'practitioner_id') {
      const newPractitionerId = value;
      const serviceItemId = currentItem.service_item_id;
      
      newItems[index] = {
        ...currentItem,
        practitioner_id: newPractitionerId,
        billing_scenario_id: null,
        amount: 0,
        revenue_share: 0,
      };
      
      if (serviceItemId && newPractitionerId) {
        // Load billing scenarios and auto-select default
        applyBillingScenarioToItem(index, serviceItemId, newPractitionerId);
      }
    }
    
    // Handle billing scenario change
    else if (field === 'billing_scenario_id') {
      const serviceItemId = currentItem.service_item_id;
      const practitionerId = currentItem.practitioner_id;
      
      if (value && serviceItemId && practitionerId) {
        // A scenario was selected - set amount and revenue_share from scenario values
        const key = `${serviceItemId}-${practitionerId}`;
        const scenarios = billingScenarios[key] || [];
        const scenario = scenarios.find((s: BillingScenario) => s.id === value);
        
        if (scenario) {
          newItems[index] = {
            ...currentItem,
            billing_scenario_id: value,
            amount: normalizeScenarioValue(scenario.amount),
            revenue_share: normalizeScenarioValue(scenario.revenue_share),
          };
        } else {
          // Scenario not found, reset to 0
          newItems[index] = {
            ...currentItem,
            billing_scenario_id: value,
            amount: 0,
            revenue_share: 0,
          };
        }
      } else {
        // "其他" (null) was selected - reset to 0 if was read-only
        const wasReadOnly = shouldShowReadOnlyFields(currentItem, billingScenarios[`${serviceItemId}-${practitionerId}`] || []);
        newItems[index] = {
          ...currentItem,
          billing_scenario_id: null,
          amount: wasReadOnly ? 0 : currentItem.amount,
          revenue_share: wasReadOnly ? 0 : currentItem.revenue_share,
        };
      }
    }
    
    // Handle other fields (custom_name, amount, revenue_share, quantity)
    else {
      newItems[index] = { ...currentItem, [field]: value };
    }
    
    setItems(newItems);
  };

  // Handle service item selection from modal
  const handleServiceItemSelect = useCallback((serviceItemId: number | undefined) => {
    if (currentItemIndex !== null) {
      handleItemChange(currentItemIndex, 'service_item_id', serviceItemId);
      setIsServiceItemModalOpen(false);
      setCurrentItemIndex(null);
    }
  }, [currentItemIndex, handleItemChange]);

  const validateItems = (): string | null => {
    if (items.length === 0) {
      return '請至少新增一個項目';
    }
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      
      // Service item or custom name required
      if (!item.service_item_id && !item.custom_name) {
        return `項目 ${i + 1}: 請選擇服務項目或輸入自訂項目名稱`;
      }
      
      // Amount validation
      if (item.amount < 0) {
        return `項目 ${i + 1}: 金額不能為負數`;
      }
      
      // Revenue share validation
      if (item.revenue_share < 0) {
        return `項目 ${i + 1}: 診所分潤必須 >= 0`;
      }
      
      if (item.revenue_share > item.amount) {
        return `項目 ${i + 1}: 診所分潤必須 <= 金額`;
      }
      
      // Quantity validation
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
      // Transform items to API format
      const apiItems = items.map((item, index) => {
        const isServiceItem = !!item.service_item_id;
        const apiItem: {
          item_type: 'service_item' | 'other';
          service_item_id?: number;
          practitioner_id?: number;
          billing_scenario_id?: number;
          item_name?: string;
          amount: number;
          revenue_share: number;
          display_order: number;
          quantity: number;
        } = {
          item_type: isServiceItem ? 'service_item' : 'other',
          amount: item.amount,
          revenue_share: item.revenue_share,
          display_order: index,
          quantity: item.quantity || 1,
        };
        
        if (isServiceItem) {
          apiItem.service_item_id = item.service_item_id;
          // Only include billing_scenario_id if it's set (not null/undefined)
          if (item.billing_scenario_id != null) {
            apiItem.billing_scenario_id = item.billing_scenario_id;
          }
        } else {
          // For "other" type, item_name is required
          apiItem.item_name = item.custom_name;
        }
        
        // Include practitioner_id only if it's set (not undefined/null)
        // Backend only includes it if not None, so we match that behavior
        if (item.practitioner_id != null) {
          apiItem.practitioner_id = item.practitioner_id;
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
    } catch (err: unknown) {
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
            // service_item_id is undefined when "其他" is selected
            // Check if item has been initialized (has amount/revenue_share/custom_name/quantity set) to distinguish from "not selected yet"
            const isServiceOther = item.service_item_id === undefined && (item.amount !== undefined || item.custom_name !== undefined || item.quantity !== undefined);
            // Show practitioner dropdown if: regular service selected (service_item_id is number) OR "其他" explicitly selected
            const hasServiceSelection = item.service_item_id !== undefined || isServiceOther;
            const showCustomFields = shouldShowCustomFields(item, scenarios);
            const showReadOnlyFields = shouldShowReadOnlyFields(item, scenarios);
            
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
                        <NumberInput
                          value={quantity}
                          onChange={(qty) => {
                            handleItemChange(index, 'quantity', qty);
                            if (!expandedQuantityItems.has(index)) {
                              setExpandedQuantityItems(prev => new Set(prev).add(index));
                            }
                          }}
                          fallback={1}
                          parseFn="parseInt"
                          min={1}
                          className="w-12 px-2 py-1 text-sm border border-gray-300 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
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
                  {/* Service Item Selection - Conditional: Modal if grouping enabled, dropdown otherwise */}
                  <div>
                    <label htmlFor={hasGrouping ? undefined : `service-item-${index}`} className="block text-sm font-medium text-gray-700 mb-1">
                      服務項目
                    </label>
                    {hasGrouping ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentItemIndex(index);
                          setIsServiceItemModalOpen(true);
                        }}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-left bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {item.service_item_id ? (() => {
                          const selectedItem = availableServiceItems.find(si => si.id === item.service_item_id);
                          if (!selectedItem) return '選擇服務項目...';
                          const duration = selectedItem.duration_minutes ? `(${selectedItem.duration_minutes}分鐘)` : '';
                          return `${selectedItem.name} ${duration}`.trim();
                        })() : item.service_item_id === undefined ? (
                          '其他'
                        ) : (
                          '選擇服務項目...'
                        )}
                      </button>
                    ) : (
                      <select
                        id={`service-item-${index}`}
                        value={item.service_item_id ? item.service_item_id.toString() : (item.service_item_id === undefined ? 'other' : '')}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === 'other') {
                            handleItemChange(index, 'service_item_id', undefined);
                          } else if (value === '') {
                            // Placeholder selected - don't change anything
                            return;
                          } else {
                            handleItemChange(index, 'service_item_id', parseInt(value));
                          }
                        }}
                        className="input"
                      >
                        <option value="">選擇服務項目...</option>
                        {availableServiceItems.map(si => (
                          <option key={si.id} value={si.id}>
                            {si.name}
                          </option>
                        ))}
                        <option value="other">其他</option>
                      </select>
                    )}
                  </div>
                  
                  {/* Custom Item Name - Only shown when service item is "其他" */}
                  {isServiceOther && (
                    <div>
                      <label htmlFor={`custom-name-${index}`} className="block text-sm font-medium text-gray-700 mb-1">
                        自訂項目名稱
                      </label>
                      <input
                        id={`custom-name-${index}`}
                        type="text"
                        value={item.custom_name || ''}
                        onChange={(e) => handleItemChange(index, 'custom_name', e.target.value || undefined)}
                        className="input"
                        placeholder="例如：其他服務"
                      />
                    </div>
                  )}
                  
                  {/* Practitioner Dropdown - Shown when service item is selected (regular or "其他") */}
                  {hasServiceSelection && (
                    <div>
                      <label htmlFor={`practitioner-${index}`} className="block text-sm font-medium text-gray-700 mb-1">
                        治療師
                      </label>
                      <select
                        id={`practitioner-${index}`}
                        value={item.practitioner_id || ''}
                        onChange={(e) => {
                          const practitionerId = e.target.value ? parseInt(e.target.value) : null;
                          // handleItemChange will update practitioner_id and load billing scenarios
                          handleItemChange(index, 'practitioner_id', practitionerId);
                        }}
                        className="input"
                      >
                        <option value="">無</option>
                        {isServiceOther ? (
                          // Show all practitioners when service item is "其他"
                          practitioners.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.full_name}
                            </option>
                          ))
                        ) : (
                          // Show filtered practitioners when service item is regular
                          (practitionersByServiceItem[item.service_item_id!] || []).map(p => (
                            <option key={p.id} value={p.id}>
                              {p.full_name}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  )}
                  
                  {/* Billing Scenario Dropdown - Only shown when service item is regular AND practitioner is selected */}
                  {item.service_item_id && item.practitioner_id && scenarios.length > 0 && (
                    <div>
                      <label htmlFor={`billing-scenario-${index}`} className="block text-sm font-medium text-gray-700 mb-1">
                        計費方案
                      </label>
                      <select
                        id={`billing-scenario-${index}`}
                        value={item.billing_scenario_id != null ? item.billing_scenario_id : ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          handleItemChange(index, 'billing_scenario_id', value ? parseInt(value) : null);
                        }}
                        className="input"
                      >
                        {scenarios.map((s: BillingScenario) => {
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
                  
                  {/* Editable Amount/Revenue Share */}
                  {showCustomFields && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={`amount-${index}`} className="block text-sm font-medium text-gray-700 mb-1">
                          金額
                        </label>
                        <NumberInput
                          id={`amount-${index}`}
                          value={Math.round(item.amount || 0)}
                          onChange={(value) => handleItemChange(index, 'amount', value)}
                          fallback={0}
                          parseFn="parseFloat"
                          min={0}
                          round={true}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label htmlFor={`revenue-share-${index}`} className="block text-sm font-medium text-gray-700 mb-1">
                          診所分潤
                        </label>
                        <NumberInput
                          id={`revenue-share-${index}`}
                          value={Math.round(item.revenue_share || 0)}
                          onChange={(value) => handleItemChange(index, 'revenue_share', value)}
                          fallback={0}
                          parseFn="parseFloat"
                          min={0}
                          round={true}
                          placeholder="0"
                        />
                      </div>
                    </div>
                  )}
                  
                  {/* Read-only Amount/Revenue Share */}
                  {showReadOnlyFields && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          金額
                        </label>
                        <div className="input bg-gray-50 cursor-not-allowed flex items-center" aria-label="金額">
                          {formatCurrency(Math.round(item.amount || 0))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          診所分潤
                        </label>
                        <div className="input bg-gray-50 cursor-not-allowed flex items-center" aria-label="診所分潤">
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

      {/* Service Item Selection Modal */}
      <ServiceItemSelectionModal
        isOpen={isServiceItemModalOpen}
        onClose={() => {
          setIsServiceItemModalOpen(false);
          setCurrentItemIndex(null);
        }}
        onSelect={handleServiceItemSelect}
        serviceItems={availableServiceItems}
        groups={groups}
        selectedServiceItemId={currentItemIndex !== null ? items[currentItemIndex]?.service_item_id : undefined}
        title="選擇服務項目"
        showCustomOtherOption={true}
      />
    </BaseModal>
  );
};
