import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../types/api';
import { AppointmentType, Member, ResourceRequirement } from '../../types';
import { ClinicSettings } from '../../schemas/api';
import { LoadingSpinner } from '../../components/shared';
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
  
  const { isClinicAdmin } = useAuth();
  const { alert, confirm } = useModal();
  
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

      // Confirm deletion
      const confirmed = await confirm(
        `確定要刪除「${appointmentType.name}」嗎？`,
        '刪除服務項目'
      );
      
      if (!confirmed) return;

      deleteServiceItem(appointmentType.id);
    } catch (error: any) {
      logger.error('Error validating appointment type deletion:', error);
      const errorMessage = getErrorMessage(error) || '驗證刪除失敗，請稍後再試';
      await alert(errorMessage, '驗證失敗');
    }
  };

  const handleCloseEditModal = () => {
    // If closing a temporary (new) item, delete it from staging store
    if (editingItem && isTemporaryServiceItemId(editingItem.id)) {
      deleteServiceItem(editingItem.id);
    }
    setEditingItem(null);
  };

  const handleUpdateServiceItem = React.useCallback((updatedItem: AppointmentType) => {
    updateServiceItem(updatedItem.id, updatedItem);
  }, [updateServiceItem]);

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
  const availableGroups = getAvailableGroups();

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
          <div className="mb-4 flex justify-between items-center">
            <h3 className="text-sm font-medium text-gray-700">
              服務項目 (共 {serviceItems.length} 項)
            </h3>
            {isClinicAdmin && (
              <button
                type="button"
                onClick={handleAddServiceItem}
                className="btn-primary text-sm px-4 py-2"
              >
                + 新增服務
              </button>
            )}
          </div>

          <ServiceItemsTable
            appointmentTypes={serviceItems}
            groups={availableGroups}
            practitionerAssignments={practitionerAssignments}
            onEdit={handleEditServiceItem}
            onDelete={handleDeleteServiceItem}
            isClinicAdmin={isClinicAdmin}
          />
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
