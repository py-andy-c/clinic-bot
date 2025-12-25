import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../types/api';
import { AppointmentType, Member, ResourceRequirement, FollowUpMessage } from '../../types';
import { ClinicSettings } from '../../schemas/api';
import { LoadingSpinner } from '../../components/shared';
import { SearchInput } from '../../components/shared/SearchInput';
import { ServiceItemsTable } from '../../components/ServiceItemsTable';
import { ServiceItemEditModal } from '../../components/ServiceItemEditModal';
import { ServiceTypeGroupManagement } from '../../components/ServiceTypeGroupManagement';
import { ValidationSummaryModal, ValidationError } from '../../components/ValidationSummaryModal';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useServiceItemsStagingStore } from '../../stores/serviceItemsStagingStore';
import { useServiceItemsStore, BillingScenario } from '../../stores/serviceItemsStore';
import { useUnsavedChangesDetection } from '../../hooks/useUnsavedChangesDetection';
import { sharedFetchFunctions } from '../../services/api';
import { isTemporaryServiceItemId, isTemporaryGroupId, isRealId } from '../../utils/idUtils';
import { mapTemporaryIds } from '../../utils/idMappingUtils';
import { useDebouncedSearch } from '../../utils/searchUtils';
import {
  DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
  DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
  DEFAULT_REMINDER_MESSAGE,
} from '../../constants/messageTemplates';

type TabType = 'service-items' | 'group-management';

const SettingsServiceItemsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('service-items');
  const [editingItem, setEditingItem] = useState<AppointmentType | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  
  // Filter states
  const [selectedGroupId, setSelectedGroupId] = useState<number | string | null>(null); // null = "全部", -1 = "未分類", number = specific group
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isComposing, setIsComposing] = useState(false);
  
  // Drag and drop state
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
  
  const { isClinicAdmin } = useAuth();
  const { alert, confirm } = useModal();
  
  // Debounced search
  const debouncedSearchQuery = useDebouncedSearch(searchQuery, 400, isComposing);
  
  const {
    serviceItems,
    groups,
    originalGroups,
    practitionerAssignments,
    billingScenarios,
    resourceRequirements,
    initialize,
    initializePractitionerAssignments,
    addServiceItem,
    updateServiceItem,
    deleteServiceItem,
    reorderServiceItems,
    addGroup,
    updateGroup,
    deleteGroup,
    reorderGroups,
    updatePractitionerAssignments,
    updateBillingScenarios,
    updateResourceRequirements,
    getAvailableGroups,
    getGroupCount,
    hasUnsavedChanges,
    discardChanges,
  } = useServiceItemsStagingStore();

  const {
    loadPractitionerAssignments: loadOriginalAssignments,
    savePractitionerAssignments,
    saveBillingScenarios,
    saveResourceRequirements,
  } = useServiceItemsStore();

  // Get available groups
  const availableGroups = getAvailableGroups();

  // Filter service items based on group and search
  const filteredItems = useMemo(() => {
    // Start with sorted service items (by display_order)
    const sortedItems = [...serviceItems].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    let filtered = sortedItems;

    // Apply group filter
    if (selectedGroupId !== null) {
      if (selectedGroupId === -1) {
        // "未分類" - items with no group
        filtered = filtered.filter(item => !item.service_type_group_id);
      } else {
        // Specific group
        filtered = filtered.filter(item => item.service_type_group_id === selectedGroupId);
      }
    }

    // Apply search filter
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase().trim();
      const practitioners = members.filter(m => m.roles.includes('practitioner'));
      
      filtered = filtered.filter(item => {
        // Search in service item name
        const itemNameMatch = item.name?.toLowerCase().includes(query);
        
        // Search in group name
        const group = availableGroups.find(g => g.id === item.service_type_group_id);
        const groupNameMatch = group?.name?.toLowerCase().includes(query);
        
        // Search in practitioner names
        const assignedPractitionerIds = practitionerAssignments[item.id] || [];
        const assignedPractitioners = practitioners.filter(p => assignedPractitionerIds.includes(p.id));
        const practitionerNameMatch = assignedPractitioners.some(p => 
          p.full_name?.toLowerCase().includes(query)
        );
        
        return itemNameMatch || groupNameMatch || practitionerNameMatch;
      });
    }

    return filtered;
  }, [serviceItems, selectedGroupId, debouncedSearchQuery, availableGroups, members, practitionerAssignments]);

  const hasActiveFilters = selectedGroupId !== null || debouncedSearchQuery.trim() !== '';
  const totalCount = serviceItems.length;
  const filteredCount = filteredItems.length;

  // Setup navigation warnings for unsaved changes
  useUnsavedChangesDetection({ 
    hasUnsavedChanges: () => hasUnsavedChanges()
  });

  // Load settings and initialize staging store
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoadingSettings(true);
        const settingsData = await sharedFetchFunctions.getClinicSettings();
        setSettings(settingsData);
        
        // Load groups
        const groupsResponse = await apiService.getServiceTypeGroups();
        const sortedGroups = groupsResponse.groups.sort((a, b) => a.display_order - b.display_order);
        
        // Initialize staging store
        initialize(
          settingsData?.appointment_types || [],
          sortedGroups
        );
        
        // Load original practitioner assignments
        if (settingsData?.appointment_types && settingsData.appointment_types.length > 0) {
          await loadOriginalAssignments(settingsData.appointment_types);
          
          // Copy practitioner assignments from serviceItemsStore to staging store
          const { practitionerAssignments: loadedAssignments } = useServiceItemsStore.getState();
          initializePractitionerAssignments(loadedAssignments);
        }
      } catch (err) {
        logger.error('Error loading settings:', err);
      } finally {
        setLoadingSettings(false);
      }
    };
    
    loadData();
  }, [initialize, loadOriginalAssignments]);

  // Load members (practitioners)
  useEffect(() => {
    if (isClinicAdmin) {
      loadMembers();
    }
  }, [isClinicAdmin]);

  const loadMembers = async () => {
    try {
      setLoadingMembers(true);
      const membersData = await apiService.getMembers();
      const practitioners = membersData.filter(m => m.roles.includes('practitioner'));
      setMembers(practitioners);
    } catch (err) {
      logger.error('Error loading members:', err);
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleAddServiceItem = () => {
    const maxOrder = serviceItems.length > 0
      ? Math.max(...serviceItems.map(at => at.display_order || 0))
      : -1;
    
    // Generate temporary ID with microsecond precision to avoid collisions
    // Use Math.floor to ensure integer ID (Math.random() adds fractional part)
    const newType: AppointmentType = {
      id: Math.floor(Date.now() + Math.random() * 1000), // Temporary ID with random suffix to prevent collisions
      clinic_id: settings?.clinic_id || 0,
      name: '',
      duration_minutes: 30,
      receipt_name: undefined,
      allow_patient_booking: true,
      allow_patient_practitioner_selection: true,
      description: undefined,
      scheduling_buffer_minutes: 0,
      service_type_group_id: undefined,
      display_order: maxOrder + 1,
      // Set default message customization values (matches backend defaults)
      send_patient_confirmation: true,
      send_clinic_confirmation: true,
      send_reminder: true,
      patient_confirmation_message: DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
      clinic_confirmation_message: DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
      reminder_message: DEFAULT_REMINDER_MESSAGE,
    };
    
    addServiceItem(newType);
    setEditingItem(newType);
  };

  const handleEditServiceItem = (appointmentType: AppointmentType) => {
    setEditingItem(appointmentType);
  };

  const handleDeleteServiceItem = async (appointmentType: AppointmentType) => {
    if (!appointmentType || isTemporaryServiceItemId(appointmentType.id)) {
      // New appointment type, can remove immediately
      deleteServiceItem(appointmentType.id);
      return;
    }

    // Validate deletion before removing from UI
    try {
      const validation = await apiService.validateAppointmentTypeDeletion([appointmentType.id]);

      if (!validation.can_delete && validation.error) {
        const errorDetail = validation.error;
        const blockedType = errorDetail.appointment_types[0];
        const practitionerNames = blockedType.practitioners.join('、');
        const errorMessage = `「${blockedType.name}」正在被以下治療師使用：${practitionerNames}\n\n請先移除治療師的此服務設定後再刪除。`;
        await alert(errorMessage, '無法刪除預約類型');
        return;
      }

      // Confirmation is handled in the modal, just delete
      deleteServiceItem(appointmentType.id);
    } catch (error: any) {
      logger.error('Error validating appointment type deletion:', error);
      const errorMessage = getErrorMessage(error) || '驗證刪除失敗，請稍後再試';
      await alert(errorMessage, '驗證失敗');
    }
  };

  const handleCloseEditModal = (wasConfirmed?: boolean) => {
    // If closing a temporary (new) item and it was NOT confirmed (user canceled), delete it
    if (editingItem && isTemporaryServiceItemId(editingItem.id) && !wasConfirmed) {
      deleteServiceItem(editingItem.id);
    }
    setEditingItem(null);
  };

  const handleUpdateServiceItem = React.useCallback((updatedItem: AppointmentType) => {
    updateServiceItem(updatedItem.id, updatedItem);
    // Sync editingItem with the updated value immediately
    if (editingItem && editingItem.id === updatedItem.id) {
      setEditingItem(updatedItem);
    }
  }, [updateServiceItem, editingItem]);

  // Drag and drop handlers for service items
  const handleDragStart = (e: React.DragEvent, itemId: number) => {
    setDraggedItemId(itemId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetItemId: number, position?: 'above' | 'below') => {
    e.preventDefault();
    if (!draggedItemId || draggedItemId === targetItemId) return;

    // Find indices in the full service items list (not filtered)
    const allItems = [...serviceItems];
    const draggedIndex = allItems.findIndex(item => item.id === draggedItemId);
    let targetIndex = allItems.findIndex(item => item.id === targetItemId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;

    // Calculate final insertion index based on position indicator
    // If dropping "below", insert after the target (targetIndex + 1)
    // If dropping "above" or no position specified, insert at targetIndex
    let insertIndex = position === 'below' ? targetIndex + 1 : targetIndex;

    // Reorder in the full list
    const newItems = [...allItems];
    const [removed] = newItems.splice(draggedIndex, 1);
    if (!removed) return;
    
    // Adjust insertion index if dragged item was before the insertion point
    // (removing the dragged item shifts indices down by 1)
    if (draggedIndex < insertIndex) {
      insertIndex -= 1;
    }
    
    newItems.splice(insertIndex, 0, removed);

    // Get ordered IDs
    const orderedIds = newItems.map(item => item.id);
    reorderServiceItems(orderedIds);
    
    setDraggedItemId(null);
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
  };

  // Validate all staged changes
  const validateAllChanges = (): ValidationError[] => {
    const errors: ValidationError[] = [];
    
    // Validate service items
    serviceItems.forEach(item => {
      if (!item.name || item.name.trim() === '') {
        errors.push({
          type: 'service-item',
          itemName: item.name || `項目 ${item.id}`,
          field: 'name',
          message: '項目名稱不能為空',
          itemId: item.id,
          onNavigate: () => {
            setEditingItem(item);
            setActiveTab('service-items');
          },
        });
      }
      
      if (item.duration_minutes < 15 || item.duration_minutes > 480) {
        errors.push({
          type: 'service-item',
          itemName: item.name || `項目 ${item.id}`,
          field: 'duration_minutes',
          message: '時長必須在 15 到 480 分鐘之間',
          itemId: item.id,
          onNavigate: () => {
            setEditingItem(item);
            setActiveTab('service-items');
          },
        });
      }
    });
    
    // Validate groups
    groups.forEach(group => {
      if (!group.name || group.name.trim() === '') {
        errors.push({
          type: 'group',
          itemName: group.name || `群組 ${group.id}`,
          field: 'name',
          message: '群組名稱不能為空',
          itemId: group.id,
          onNavigate: () => {
            setActiveTab('group-management');
          },
        });
      }
    });
    
    // Check for duplicate group names
    const groupNames = groups.map(g => g.name.trim().toLowerCase());
    const duplicateGroups = groups.filter((group, index) => 
      groupNames.indexOf(group.name.trim().toLowerCase()) !== index
    );
    
    duplicateGroups.forEach(group => {
      errors.push({
        type: 'group',
        itemName: group.name,
        field: 'name',
        message: '群組名稱已存在',
        itemId: group.id,
        onNavigate: () => {
          setActiveTab('group-management');
        },
      });
    });
    
    return errors;
  };

  // Helper function to save groups with error collection
  const saveGroups = async (): Promise<{ groupMapping: Record<number, number>; errors: string[] }> => {
    const errors: string[] = [];
    const groupMapping: Record<number, number> = {};
    
    const groupsToCreate = groups.filter(g => isTemporaryGroupId(g.id));
    const groupsToUpdate = groups.filter(g => isRealId(g.id));
    
    // Determine groups to delete by comparing current groups with original groups
    const originalGroupIds = new Set(originalGroups.map(g => g.id));
    const currentGroupIds = new Set(groups.filter(g => isRealId(g.id)).map(g => g.id));
    const groupsToDelete = Array.from(originalGroupIds).filter((id): id is number => typeof id === 'number' && !currentGroupIds.has(id));
    
    // Create new groups
    for (const group of groupsToCreate) {
      try {
        const response = await apiService.createServiceTypeGroup({
          name: group.name,
          display_order: group.display_order,
        });
        groupMapping[group.id] = response.id;
      } catch (err: any) {
        logger.error('Error creating group:', err);
        errors.push(`建立群組「${group.name}」失敗：${err?.response?.data?.detail || err?.message || '未知錯誤'}`);
      }
    }
    
    // Update existing groups
    for (const group of groupsToUpdate) {
      try {
        await apiService.updateServiceTypeGroup(group.id, {
          name: group.name,
          display_order: group.display_order,
        });
      } catch (err: any) {
        logger.error('Error updating group:', err);
        errors.push(`更新群組「${group.name}」失敗：${err?.response?.data?.detail || err?.message || '未知錯誤'}`);
      }
    }
    
    // Delete groups
    for (const groupId of groupsToDelete) {
      try {
        await apiService.deleteServiceTypeGroup(groupId);
      } catch (err: any) {
        logger.error('Error deleting group:', err);
        errors.push(`刪除群組失敗：${err?.response?.data?.detail || err?.message || '未知錯誤'}`);
      }
    }
    
    // Reorder groups if needed
    if (groups.length > 1) {
      const orderedIds = groups.map(g => {
        const realId = isTemporaryGroupId(g.id) ? groupMapping[g.id] : g.id;
        return realId;
      }).filter((id): id is number => id !== undefined && isRealId(id));
      
      if (orderedIds.length > 1) {
        try {
          await apiService.bulkUpdateGroupOrder(
            orderedIds.map((id, index) => ({ id, display_order: index }))
          );
        } catch (err: any) {
          logger.error('Error reordering groups:', err);
          // Don't add to errors - reordering is not critical
        }
      }
    }
    
    // Reload groups to get real IDs
    try {
      const freshGroupsResponse = await apiService.getServiceTypeGroups();
      const freshGroups = freshGroupsResponse.groups.sort((a, b) => a.display_order - b.display_order);
      
      // Update group mapping with all real IDs
      freshGroups.forEach(group => {
        const stagedGroup = groups.find(g => 
          (isTemporaryGroupId(g.id) && groupMapping[g.id] === group.id) ||
          (isRealId(g.id) && g.id === group.id)
        );
        if (stagedGroup && isTemporaryGroupId(stagedGroup.id)) {
          groupMapping[stagedGroup.id] = group.id;
        }
      });
      
      return { groupMapping, errors };
    } catch (err: any) {
      logger.error('Error reloading groups:', err);
      errors.push(`重新載入群組失敗：${err?.message || '未知錯誤'}`);
      return { groupMapping, errors };
    }
  };

  // Helper function to save service items with error collection
  const saveServiceItems = async (groupMapping: Record<number, number>): Promise<{ savedServiceItems: AppointmentType[]; errors: string[] }> => {
    const errors: string[] = [];
    
    // Map temporary group IDs in service items
    const serviceItemsWithMappedGroups = serviceItems.map(item => {
      if (item.service_type_group_id && isTemporaryGroupId(item.service_type_group_id)) {
        const realGroupId = groupMapping[item.service_type_group_id];
        return { ...item, service_type_group_id: realGroupId || null };
      }
      return item;
    });
    
    // For new items (temporary IDs), omit id so backend assigns it
    // For existing items, include id
    const serviceItemsToSave = serviceItemsWithMappedGroups.map(item => {
      // Ensure messages are set to defaults if toggle is ON and message is empty
      const sendPatientConfirmation = item.send_patient_confirmation ?? true;
      const sendClinicConfirmation = item.send_clinic_confirmation ?? true;
      const sendReminder = item.send_reminder ?? true;
      
      let patientConfirmationMessage = item.patient_confirmation_message || '';
      if (sendPatientConfirmation && (!patientConfirmationMessage || !patientConfirmationMessage.trim())) {
        patientConfirmationMessage = DEFAULT_PATIENT_CONFIRMATION_MESSAGE;
      }
      
      let clinicConfirmationMessage = item.clinic_confirmation_message || '';
      if (sendClinicConfirmation && (!clinicConfirmationMessage || !clinicConfirmationMessage.trim())) {
        clinicConfirmationMessage = DEFAULT_CLINIC_CONFIRMATION_MESSAGE;
      }
      
      let reminderMessage = item.reminder_message || '';
      if (sendReminder && (!reminderMessage || !reminderMessage.trim())) {
        reminderMessage = DEFAULT_REMINDER_MESSAGE;
      }
      
      const baseItem = {
        clinic_id: item.clinic_id,
        name: item.name,
        duration_minutes: item.duration_minutes,
        receipt_name: item.receipt_name || null,
        allow_patient_booking: item.allow_patient_booking ?? true,
        allow_patient_practitioner_selection: item.allow_patient_practitioner_selection ?? true,
        description: item.description || null,
        scheduling_buffer_minutes: item.scheduling_buffer_minutes || 0,
        service_type_group_id: item.service_type_group_id || null,
        display_order: item.display_order || 0,
        // Message customization fields
        send_patient_confirmation: sendPatientConfirmation,
        send_clinic_confirmation: sendClinicConfirmation,
        send_reminder: sendReminder,
        patient_confirmation_message: patientConfirmationMessage,
        clinic_confirmation_message: clinicConfirmationMessage,
        reminder_message: reminderMessage,
      };
      
      // Only include id for existing items
      if (isRealId(item.id)) {
        return { ...baseItem, id: item.id };
      }
      return baseItem;
    });
    
    // Update settings with service items
    if (!settings) {
      errors.push('設定資料未載入');
      return { savedServiceItems: [], errors };
    }
    
    try {
      // Type assertion needed because new items don't have id yet
      // The API will handle creating items without id and updating items with id
      const updatedSettings = {
        ...settings,
        appointment_types: serviceItemsToSave,
      } as ClinicSettings;
      
      await apiService.updateClinicSettings(updatedSettings);
      
      // Reload settings to get real IDs
      const freshSettings = await sharedFetchFunctions.getClinicSettings();
      const savedServiceItems = freshSettings?.appointment_types || [];
      
      // Update order using bulk update API if we have multiple items
      if (savedServiceItems.length > 1) {
        try {
          const orderedIds = savedServiceItems
            .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
            .map(item => item.id)
            .filter((id): id is number => isRealId(id));
          
          if (orderedIds.length > 1) {
            await apiService.bulkUpdateAppointmentTypeOrder(
              orderedIds.map((id, index) => ({ id, display_order: index }))
            );
          }
        } catch (err: any) {
          logger.error('Error updating service item order:', err);
          // Don't add to errors - order update is not critical, order is already saved in main update
        }
      }
      
      return { savedServiceItems, errors };
    } catch (err: any) {
      logger.error('Error saving service items:', err);
      errors.push(`儲存服務項目失敗：${err?.response?.data?.detail || err?.message || '未知錯誤'}`);
      return { savedServiceItems: [], errors };
    }
  };

  // Helper function to save associations with error collection
  const saveAssociations = async (
    serviceItemMapping: Record<number, number>
  ): Promise<{ errors: string[] }> => {
    const errors: string[] = [];
    const allMappings = { ...serviceItemMapping };
    
    // Map temporary IDs in practitioner assignments
    const mappedPractitionerAssignments: Record<number, number[]> = {};
    Object.entries(practitionerAssignments).forEach(([tempId, practitionerIds]) => {
      const tempIdNum = parseInt(tempId, 10);
      const realId = allMappings[tempIdNum] ?? tempIdNum;
      if (isRealId(realId)) {
        mappedPractitionerAssignments[realId] = practitionerIds;
      }
    });
    
    // Map temporary IDs in billing scenarios (key format: "serviceItemId-practitionerId")
    const mappedBillingScenarios: Record<string, BillingScenario[]> = {};
    Object.entries(billingScenarios).forEach(([key, scenarios]) => {
      const parts = key.split('-');
      if (parts.length === 2 && parts[0] && parts[1]) {
        const tempServiceItemId = parseInt(parts[0], 10);
        const tempPractitionerId = parseInt(parts[1], 10);
        const realServiceItemId = allMappings[tempServiceItemId] ?? tempServiceItemId;
        const realPractitionerId = tempPractitionerId; // Practitioner IDs are always real
        if (isRealId(realServiceItemId)) {
          const newKey = `${realServiceItemId}-${realPractitionerId}`;
          mappedBillingScenarios[newKey] = scenarios;
        }
      }
    });
    
    // Map temporary IDs in resource requirements
    const mappedResourceRequirements: Record<number, ResourceRequirement[]> = {};
    Object.entries(resourceRequirements).forEach(([tempId, requirements]) => {
      const tempIdNum = parseInt(tempId, 10);
      const realId = allMappings[tempIdNum] ?? tempIdNum;
      if (isRealId(realId)) {
        mappedResourceRequirements[realId] = requirements;
      }
    });
    
    // Transfer staged associations to original store before saving
    // This is intentional: The save functions (savePractitionerAssignments, etc.) read from
    // serviceItemsStore, not from the staging store. This separation allows:
    // 1. Staging store to manage temporary IDs and reactive UI updates
    // 2. Original store to handle the actual API calls with real IDs
    // 3. Clean separation of concerns between UI state and persistence layer
    const {
      updatePractitionerAssignments: updateOriginalPractitionerAssignments,
      updateBillingScenarios: updateOriginalBillingScenarios,
      updateResourceRequirements: updateOriginalResourceRequirements,
    } = useServiceItemsStore.getState();
    
    Object.entries(mappedPractitionerAssignments).forEach(([serviceItemId, practitionerIds]) => {
      updateOriginalPractitionerAssignments(parseInt(serviceItemId, 10), practitionerIds);
    });
    
    Object.entries(mappedBillingScenarios).forEach(([key, scenarios]) => {
      updateOriginalBillingScenarios(key, scenarios);
    });
    
    Object.entries(mappedResourceRequirements).forEach(([serviceItemId, requirements]) => {
      updateOriginalResourceRequirements(parseInt(serviceItemId, 10), requirements);
    });
    
    // Save practitioner assignments
    try {
      const assignmentResult = await savePractitionerAssignments();
      if (!assignmentResult.success) {
        assignmentResult.errors.forEach(err => errors.push(`治療師指派：${err}`));
      }
    } catch (err: any) {
      errors.push(`儲存治療師指派失敗：${err?.message || '未知錯誤'}`);
    }
    
    // Save billing scenarios
    try {
      const scenarioResult = await saveBillingScenarios();
      if (!scenarioResult.success) {
        scenarioResult.errors.forEach(err => errors.push(`計費方案：${err}`));
      }
    } catch (err: any) {
      errors.push(`儲存計費方案失敗：${err?.message || '未知錯誤'}`);
    }
    
    // Save resource requirements
    try {
      const requirementResult = await saveResourceRequirements();
      if (!requirementResult.success) {
        requirementResult.errors.forEach(err => errors.push(`資源需求：${err}`));
      }
    } catch (err: any) {
      errors.push(`儲存資源需求失敗：${err?.message || '未知錯誤'}`);
    }
    
    // Save follow-up messages
    try {
      // Get follow-up messages from staged service items
      const followUpMessagesByServiceItem: Record<number, FollowUpMessage[]> = {};
      serviceItems.forEach(item => {
        if (item.follow_up_messages && item.follow_up_messages.length > 0) {
          const tempId = item.id;
          followUpMessagesByServiceItem[tempId] = item.follow_up_messages;
        }
      });

      // Process follow-up messages for each service item
      for (const [tempServiceItemId, messages] of Object.entries(followUpMessagesByServiceItem)) {
        const tempIdNum = parseInt(tempServiceItemId, 10);
        const realServiceItemId = allMappings[tempIdNum] ?? tempIdNum;
        
        if (!isRealId(realServiceItemId)) {
          continue; // Skip if service item doesn't have a real ID yet
        }

        // Get original messages from API to determine what to create/update/delete
        let originalMessages: FollowUpMessage[] = [];
        try {
          const response = await apiService.getFollowUpMessages(realServiceItemId);
          originalMessages = response.follow_up_messages;
        } catch (err: any) {
          // If service item is new, there are no original messages
          if (err?.response?.status !== 404) {
            logger.error(`Error loading original follow-up messages for ${realServiceItemId}:`, err);
          }
        }

        const originalMessageIds = new Set(originalMessages.map(m => m.id));
        const stagedMessageIds = new Set(messages.map(m => isRealId(m.id) ? m.id : null).filter((id): id is number => id !== null));

        // Delete messages that were removed
        const messagesToDelete = originalMessages.filter(m => !stagedMessageIds.has(m.id));
        for (const message of messagesToDelete) {
          try {
            await apiService.deleteFollowUpMessage(realServiceItemId, message.id);
          } catch (err: any) {
            const errorMsg = `刪除追蹤訊息失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
            logger.error(`Error deleting follow-up message ${message.id}:`, err);
            errors.push(errorMsg);
          }
        }

        // Create or update messages
        for (const message of messages) {
          try {
            // Build common data structure
            const baseData = {
              timing_mode: message.timing_mode,
              message_template: message.message_template,
              is_enabled: message.is_enabled,
              display_order: message.display_order,
            };

            // Add timing-specific fields
            if (message.timing_mode === 'hours_after' && message.hours_after !== null) {
              (baseData as any).hours_after = message.hours_after;
            } else if (message.timing_mode === 'specific_time') {
              if (message.days_after !== null) {
                (baseData as any).days_after = message.days_after;
              }
              if (message.time_of_day !== null) {
                (baseData as any).time_of_day = message.time_of_day;
              }
            }

            if (isRealId(message.id)) {
              // Update existing message
              await apiService.updateFollowUpMessage(realServiceItemId, message.id, baseData);
            } else {
              // Create new message
              await apiService.createFollowUpMessage(realServiceItemId, baseData as any);
            }
          } catch (err: any) {
            const action = isRealId(message.id) ? '更新' : '建立';
            const errorMsg = `${action}追蹤訊息失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
            logger.error(`Error ${action === '更新' ? 'updating' : 'creating'} follow-up message:`, err);
            errors.push(errorMsg);
          }
        }
      }
    } catch (err: any) {
      errors.push(`儲存追蹤訊息失敗：${err?.message || '未知錯誤'}`);
    }
    
    return { errors };
  };

  // Save all changes
  const handleSaveAll = async () => {
    if (saving) return;
    
    try {
      setSaving(true);
      
      // Validate all changes
      const validationErrors = validateAllChanges();
      if (validationErrors.length > 0) {
        setValidationErrors(validationErrors);
        setShowValidationModal(true);
        setSaving(false);
        return;
      }
      
      const allErrors: string[] = [];
      
      // Step 1: Save groups first
      const { groupMapping, errors: groupErrors } = await saveGroups();
      allErrors.push(...groupErrors);
      
      // Reload groups to get fresh data
      const freshGroupsResponse = await apiService.getServiceTypeGroups();
      const freshGroups = freshGroupsResponse.groups.sort((a, b) => a.display_order - b.display_order);
      
      // Step 2: Save service items
      const { savedServiceItems, errors: serviceItemErrors } = await saveServiceItems(groupMapping);
      allErrors.push(...serviceItemErrors);
      
      if (savedServiceItems.length === 0 && serviceItemErrors.length > 0) {
        // If service items failed to save, we can't continue with associations
        await alert(allErrors.join('\n\n'), '部分設定儲存失敗');
        setSaving(false);
        return;
      }
      
      // Step 3: Map temporary service item IDs
      const { serviceItemMapping } = await mapTemporaryIds(serviceItems, savedServiceItems, groups, freshGroups);
      
      // Step 4: Save associations
      const { errors: associationErrors } = await saveAssociations(serviceItemMapping);
      allErrors.push(...associationErrors);
      
      // Update staging store with real IDs
      initialize(savedServiceItems, freshGroups);
      
      // Show results
      if (allErrors.length > 0) {
        await alert(allErrors.join('\n\n'), '部分設定儲存失敗');
      } else {
        await alert('設定已成功儲存', '成功');
      }
      
      // Reload all data to ensure consistency
      const finalSettings = await sharedFetchFunctions.getClinicSettings();
      const finalGroupsResponse = await apiService.getServiceTypeGroups();
      const finalGroups = finalGroupsResponse.groups.sort((a, b) => a.display_order - b.display_order);
      
      setSettings(finalSettings);
      initialize(finalSettings?.appointment_types || [], finalGroups);
      
      // Load original associations
      if (finalSettings?.appointment_types && finalSettings.appointment_types.length > 0) {
        await loadOriginalAssignments(finalSettings.appointment_types);
      }
      
    } catch (err: any) {
      logger.error('Error saving all changes:', err);
      const errorMessage = err instanceof Error ? err.message : '儲存失敗';
      await alert(errorMessage, '錯誤');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardChanges = async () => {
    const confirmed = await confirm(
      '確定要取消所有變更嗎？所有未儲存的變更將會遺失。',
      '取消變更'
    );
    
    if (confirmed) {
      discardChanges();
      // Reload original data
      const settingsData = await sharedFetchFunctions.getClinicSettings();
      const groupsResponse = await apiService.getServiceTypeGroups();
      const sortedGroups = groupsResponse.groups.sort((a, b) => a.display_order - b.display_order);
      setSettings(settingsData);
      initialize(settingsData?.appointment_types || [], sortedGroups);
    }
  };

  if (loadingSettings || loadingMembers) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">無法載入設定</p>
      </div>
    );
  }

  const hasChanges = hasUnsavedChanges();

  return (
    <>
      <SettingsBackButton />
      <div className="flex justify-between items-center mb-6">
        <PageHeader title="服務項目設定" />
        {hasChanges && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDiscardChanges}
              disabled={saving}
              className="btn-secondary text-sm px-4 py-2"
            >
              取消變更
            </button>
          <button
            type="button"
              onClick={handleSaveAll}
              disabled={saving}
            className="btn-primary text-sm px-4 py-2"
          >
              {saving ? '儲存中...' : '儲存變更'}
          </button>
          </div>
        )}
      </div>

      {/* Tab Switcher */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            type="button"
            onClick={() => setActiveTab('service-items')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'service-items'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            服務項目
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('group-management')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'group-management'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            群組管理
          </button>
        </nav>
      </div>

      {activeTab === 'service-items' ? (
        <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-4 md:p-6">
          {/* Filters */}
          <div className="mb-4 flex flex-col md:flex-row gap-3 md:gap-4 md:items-center">
            {/* Group Filter */}
            <div className="flex-shrink-0">
              <select
                value={selectedGroupId === null ? 'placeholder' : selectedGroupId === -1 ? '-1' : String(selectedGroupId)}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'placeholder' || value === '') {
                    setSelectedGroupId(null);
                  } else if (value === '-1') {
                    setSelectedGroupId(-1);
                  } else {
                    setSelectedGroupId(Number(value));
                  }
                }}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="placeholder" disabled>群組</option>
                <option value="">全部</option>
                {availableGroups.length > 0 && (
                  <>
                    <option disabled style={{ backgroundColor: '#f3f4f6', color: '#9ca3af' }}>
                      ─────────────
                    </option>
                    {availableGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                    <option disabled style={{ backgroundColor: '#f3f4f6', color: '#9ca3af' }}>
                      ─────────────
                    </option>
                    <option value="-1" style={{ color: '#6b7280' }}>
                      未分類
                    </option>
                  </>
                )}
              </select>
            </div>
            
            {/* Search Input */}
            <div className="flex-1 min-w-0">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                placeholder="搜尋服務、群組、人員"
              />
            </div>
            
            {/* Add Service Button */}
            {isClinicAdmin && (
              <div className="flex-shrink-0">
                <button
                  type="button"
                  onClick={handleAddServiceItem}
                  className="btn-primary text-sm px-4 py-2 w-full md:w-auto"
                >
                  + 新增服務
                </button>
              </div>
            )}
          </div>

          {/* Empty States */}
          {totalCount === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">尚未建立服務項目</p>
            </div>
          ) : filteredCount === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">沒有符合條件的服務項目</p>
            </div>
          ) : (
            <ServiceItemsTable
              appointmentTypes={filteredItems}
              groups={availableGroups}
              practitionerAssignments={practitionerAssignments}
              onEdit={handleEditServiceItem}
              isClinicAdmin={isClinicAdmin}
              resultCountText={hasActiveFilters
                ? `服務項目 (共 ${totalCount} 項，顯示 ${filteredCount} 項)`
                : `服務項目 (共 ${totalCount} 項)`}
              draggedItemId={draggedItemId}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            />
          )}
          </div>
      ) : (
        <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-0 md:p-6">
          <ServiceTypeGroupManagement
            isClinicAdmin={isClinicAdmin}
            appointmentTypes={serviceItems.map(at => ({
              id: at.id,
              service_type_group_id: at.service_type_group_id ?? null,
            }))}
            getGroupCount={getGroupCount}
            onAddGroup={addGroup}
            onUpdateGroup={updateGroup}
            onDeleteGroup={deleteGroup}
            onReorderGroups={reorderGroups}
            availableGroups={availableGroups}
          />
        </div>
      )}

      {/* Edit Modal */}
      {editingItem && (
        <ServiceItemEditModal
          appointmentType={editingItem}
          isOpen={!!editingItem}
          onClose={handleCloseEditModal}
          onUpdate={handleUpdateServiceItem}
          onDelete={handleDeleteServiceItem}
          members={members}
          isClinicAdmin={isClinicAdmin}
          availableGroups={availableGroups}
          practitionerAssignments={practitionerAssignments[editingItem.id] || []}
          billingScenarios={billingScenarios}
          resourceRequirements={resourceRequirements[editingItem.id] || []}
          onUpdatePractitionerAssignments={(practitionerIds: number[]) => 
            updatePractitionerAssignments(editingItem.id, practitionerIds)
          }
          onUpdateBillingScenarios={(key: string, scenarios: BillingScenario[]) =>
            updateBillingScenarios(key, scenarios)
          }
          onUpdateResourceRequirements={(requirements: ResourceRequirement[]) =>
            updateResourceRequirements(editingItem.id, requirements)
          }
          clinicInfoAvailability={{
            has_address: !!settings?.clinic_info_settings?.address,
            has_phone: !!settings?.clinic_info_settings?.phone_number,
          }}
        />
      )}

      {/* Validation Summary Modal */}
      <ValidationSummaryModal
        isOpen={showValidationModal}
        onClose={() => setShowValidationModal(false)}
        errors={validationErrors}
      />
    </>
  );
};

export default SettingsServiceItemsPage;
