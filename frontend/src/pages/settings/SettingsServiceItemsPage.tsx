import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../types/api';
import { AppointmentType, Practitioner, ServiceTypeGroup } from '../../types';
import { ClinicSettings } from '../../schemas/api';
import { LoadingSpinner } from '../../components/shared';
import { SearchInput } from '../../components/shared/SearchInput';
import { ServiceItemsTable } from '../../components/ServiceItemsTable';
import { ServiceItemEditModal } from '../../components/ServiceItemEditModal';
import { ServiceTypeGroupManagement } from '../../components/ServiceTypeGroupManagement';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useDebouncedSearch } from '../../utils/searchUtils';
import { useClinicSettings } from '../../hooks/queries/useClinicSettings';
import { useServiceTypeGroups } from '../../hooks/queries/useServiceTypeGroups';
import { usePractitioners } from '../../hooks/queries/usePractitioners';
import { useQueryClient } from '@tanstack/react-query';

// Constants
const DEBOUNCE_DELAY_MS = 400;
const DEFAULT_DISPLAY_ORDER = 0;
const UNGROUPED_ID = -1;
const STROKE_WIDTH = 2;
const TAB_PADDING_X = 6;
const TAB_PADDING_Y = 3;
const GRID_GAP = 4;

type TabType = 'service-items' | 'group-management';

type ServiceTypeGroupsData = {
  groups: ServiceTypeGroup[];
};

type AppointmentTypeOrderPayload = {
  id: number;
  display_order: number;
};

type GroupOrderPayload = {
  id: number;
  display_order: number;
};

const SettingsServiceItemsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('service-items');
  const [editingItemId, setEditingItem] = useState<number | null | undefined>(undefined);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [triggerAddGroup, setTriggerAddGroup] = useState(false);

  // Snapshot refs for reliable rollback on drag error
  const itemDragSnapshotRef = useRef<ClinicSettings | null>(null);
  const groupDragSnapshotRef = useRef<ServiceTypeGroupsData | null>(null);

  const { isClinicAdmin, user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { alert, confirm } = useModal();
  const debouncedSearchQuery = useDebouncedSearch(searchQuery, DEBOUNCE_DELAY_MS, isComposing);

  const { data: settings, isLoading: loadingSettings } = useClinicSettings();
  const { data: groupsData, isLoading: loadingGroups } = useServiceTypeGroups();
  const { data: practitionersData, isLoading: loadingPractitioners } = usePractitioners();
  const queryClient = useQueryClient();

  const serviceItems = useMemo(() => settings?.appointment_types || [], [settings]);
  const groups = useMemo(() => groupsData?.groups || [], [groupsData]);
  const availableGroups = groups;
  const practitioners = useMemo(() => practitionersData || [], [practitionersData]);

  const practitionerAssignments = useMemo(() => {
    const assignments: Record<number, number[]> = {};
    practitioners.forEach((p: Practitioner) => {
      p.offered_types.forEach((typeId: number) => {
        if (!assignments[typeId]) assignments[typeId] = [];
        assignments[typeId].push(p.id);
      });
    });
    return assignments;
  }, [practitioners]);

  const practitionerLookup = useMemo(() => {
    const lookup: Record<number, Practitioner> = {};
    practitioners.forEach((p: Practitioner) => {
      lookup[p.id] = p;
    });
    return lookup;
  }, [practitioners]);

  const getGroupCount = (groupId: number | null) => {
    return serviceItems.filter(at =>
      groupId === null
        ? at.service_type_group_id === null || at.service_type_group_id === undefined
        : at.service_type_group_id === groupId
    ).length;
  };

  const filteredItems = useMemo(() => {
    const sortedItems = [...serviceItems].sort((a, b) => (a.display_order || DEFAULT_DISPLAY_ORDER) - (b.display_order || DEFAULT_DISPLAY_ORDER));
    let filtered = sortedItems;

    if (selectedGroupId !== null) {
      if (selectedGroupId === UNGROUPED_ID) {
        filtered = filtered.filter(item => !item.service_type_group_id);
      } else {
        filtered = filtered.filter(item => item.service_type_group_id === selectedGroupId);
      }
    }

    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase().trim();
      filtered = filtered.filter(item => {
        const itemNameMatch = item.name?.toLowerCase().includes(query);
        const group = availableGroups.find(g => g.id === item.service_type_group_id);
        const groupNameMatch = group?.name?.toLowerCase().includes(query);

        // Search by practitioner names
        const assignedPractitionerIds = practitionerAssignments[item.id] || [];
        const practitionerNameMatch = assignedPractitionerIds.some(pid =>
          practitionerLookup[pid]?.full_name.toLowerCase().includes(query)
        );

        return itemNameMatch || groupNameMatch || practitionerNameMatch;
      });
    }

    return filtered;
  }, [serviceItems, selectedGroupId, debouncedSearchQuery, availableGroups]);

  const handleAddServiceItem = () => setEditingItem(null);
  const handleEditServiceItem = (item: AppointmentType) => setEditingItem(item.id);

  const handleAddGroupFromHeader = () => {
    // Switch to group management tab and trigger add group
    setActiveTab('group-management');
    setTriggerAddGroup(true);
  };

  const handleDeleteServiceItem = async (item: AppointmentType) => {
    if (!item) return;
    const confirmed = await confirm(`確定要刪除「${item.name || '此服務項目'}」嗎？此動作不可復原。`, '刪除預約類型');
    if (!confirmed) return;

    try {
      setIsProcessing(true);
      const validation = await apiService.validateAppointmentTypeDeletion([item.id]);
      if (!validation.can_delete && validation.error) {
        // ... (existing logic)
        const errorDetail = validation.error;
        const blockedType = errorDetail.appointment_types[0];
        const practitionerNames = blockedType.practitioners.join('、');
        await alert(`「${blockedType.name}」正在被以下治療師使用：${practitionerNames}\n\n請先移除治療師的此服務設定後再刪除。`, '無法刪除預約類型');
        return;
      }
      await apiService.deleteAppointmentType(item.id);
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    } catch (error) {
      logger.error('Error deleting appointment type:', error);
      await alert(getErrorMessage(error) || '刪除失敗，請稍後再試', '刪除失敗');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloseEditModal = async (refetch?: boolean) => {
    if (refetch) await queryClient.invalidateQueries({ queryKey: ['settings'] });
    setEditingItem(undefined);
  };

  const handleDragStart = useCallback((e: React.DragEvent, itemId: number) => {
    const queryKey = ['settings', 'clinic', activeClinicId];
    // Take a snapshot of current data for rollback if the final save fails
    itemDragSnapshotRef.current = queryClient.getQueryData<ClinicSettings>(queryKey) || null;

    setDraggedItemId(itemId);
    e.dataTransfer.effectAllowed = 'move';
    // Set dummy data to prevent browser from showing default icons (like the globe icon on Mac)
    e.dataTransfer.setData('application/x-clinic-dnd', itemId.toString());
  }, [activeClinicId, queryClient]);

  const handleMoveServiceItem = useCallback(async (draggedId: number, targetId: number) => {
    const queryKey = ['settings', 'clinic', activeClinicId];

    // 1. Cancel any outgoing refetches to avoid overwriting our optimistic state
    await queryClient.cancelQueries({ queryKey });

    // 2. Optimistically update local cache
    queryClient.setQueryData<ClinicSettings | undefined>(queryKey, (old) => {
      if (!old || !old.appointment_types) return old;

      const items = [...old.appointment_types];

      const fromIndex = items.findIndex(item => item.id === draggedId);
      const toIndex = items.findIndex(item => item.id === targetId);

      if (fromIndex === -1 || toIndex === -1) return old;

      // Move item
      const [item] = items.splice(fromIndex, 1);
      if (!item) return old;

      items.splice(toIndex, 0, item);

      // Reassign display_order for consistency
      const updatedItems = items.map((t, i) => ({ ...t, display_order: i }));

      return {
        ...old,
        appointment_types: updatedItems
      };
    });
  }, [queryClient, activeClinicId]);

  const handleSaveItemOrder = async () => {
    setDraggedItemId(null); // Clear drag state locally immediately

    const queryKey = ['settings', 'clinic', activeClinicId];
    const freshData = queryClient.getQueryData<ClinicSettings>(queryKey);
    if (!freshData || !freshData.appointment_types) {
      itemDragSnapshotRef.current = null;
      return;
    }

    const items = freshData.appointment_types;
    // Check if anything actually changed compared to our snapshot
    const originalItems = itemDragSnapshotRef.current?.appointment_types || [];
    const hasChanged = items.some((item, index) => item.id !== originalItems[index]?.id);

    if (!hasChanged) {
      itemDragSnapshotRef.current = null;
      return;
    }

    const orderedPayload: AppointmentTypeOrderPayload[] = items.map((item, index) => ({
      id: item.id,
      display_order: index
    }));

    try {
      await apiService.bulkUpdateAppointmentTypeOrder(orderedPayload);
    } catch (error) {
      logger.error('Error saving order:', error);
      await alert('儲存排序失敗', '錯誤');

      // Rollback to the snapshot taken at the start of the drag
      if (itemDragSnapshotRef.current) {
        queryClient.setQueryData(queryKey, itemDragSnapshotRef.current);
      } else {
        queryClient.invalidateQueries({ queryKey });
      }
    } finally {
      itemDragSnapshotRef.current = null;
    }
  };

  const handleAddGroup = async (group: { name: string; display_order: number }) => {
    try {
      await apiService.createServiceTypeGroup(group);
      await queryClient.invalidateQueries({ queryKey: ['settings', 'service-type-groups'] });
    } catch (err) {
      const message = getErrorMessage(err) || '建立群組失敗';
      alert(message, '錯誤');
    }
  };

  const handleUpdateGroup = async (id: number, updates: Partial<ServiceTypeGroup>) => {
    try {
      await apiService.updateServiceTypeGroup(id, updates);
      await queryClient.invalidateQueries({ queryKey: ['settings', 'service-type-groups'] });
    } catch (err) {
      const message = getErrorMessage(err) || '更新群組失敗';
      alert(message, '錯誤');
    }
  };

  const handleDeleteGroup = async (id: number) => {
    try {
      await apiService.deleteServiceTypeGroup(id);
      await queryClient.invalidateQueries({ queryKey: ['settings', 'service-type-groups'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    } catch (err) {
      const message = getErrorMessage(err) || '刪除群組失敗';
      alert(message, '錯誤');
    }
  };

  const handleGroupDragStart = useCallback(() => {
    const queryKey = ['settings', 'service-type-groups', activeClinicId];
    // Take a snapshot of current data for rollback if the final save fails
    groupDragSnapshotRef.current = queryClient.getQueryData<ServiceTypeGroupsData>(queryKey) || null;
  }, [activeClinicId, queryClient]);

  const handleMoveGroup = useCallback(async (draggedId: number, targetId: number) => {
    const queryKey = ['settings', 'service-type-groups', activeClinicId];

    // 1. Cancel any outgoing refetches
    await queryClient.cancelQueries({ queryKey });

    // 3. Optimistically update local cache
    queryClient.setQueryData<ServiceTypeGroupsData | undefined>(queryKey, (old) => {
      if (!old || !old.groups) return old;

      const items = [...old.groups];

      const fromIndex = items.findIndex(g => g.id === draggedId);
      const toIndex = items.findIndex(g => g.id === targetId);

      if (fromIndex === -1 || toIndex === -1) return old;

      const [item] = items.splice(fromIndex, 1);
      if (!item) return old;

      items.splice(toIndex, 0, item);

      const updatedItems = items.map((g, i: number) => ({ ...g, display_order: i }));

      return { ...old, groups: updatedItems };
    });
  }, [queryClient, activeClinicId]);

  const handleSaveGroupOrder = async () => {
    const queryKey = ['settings', 'service-type-groups', activeClinicId];
    const freshData = queryClient.getQueryData<ServiceTypeGroupsData>(queryKey);
    if (!freshData || !freshData.groups) {
      groupDragSnapshotRef.current = null;
      return;
    }

    const items = freshData.groups;
    // Check if anything actually changed
    const originalGroups = groupDragSnapshotRef.current?.groups || [];
    const hasChanged = items.some((group, index) => group.id !== originalGroups[index]?.id);

    if (!hasChanged) {
      groupDragSnapshotRef.current = null;
      return;
    }

    const orderedPayload: GroupOrderPayload[] = items.map((g, index) => ({
      id: g.id,
      display_order: index
    }));

    try {
      await apiService.bulkUpdateGroupOrder(orderedPayload);
    } catch (err) {
      logger.error('Error saving group order:', err);
      await alert('儲存群組排序失敗', '錯誤');

      // Rollback to snapshot
      if (groupDragSnapshotRef.current) {
        queryClient.setQueryData(queryKey, groupDragSnapshotRef.current);
      } else {
        queryClient.invalidateQueries({ queryKey });
      }
    } finally {
      groupDragSnapshotRef.current = null;
    }
  };

  if (loadingSettings || loadingGroups || loadingPractitioners) {
    return <div className="flex items-center justify-center min-h-screen"><LoadingSpinner /></div>;
  }

  if (!settings) return <div className="text-center py-12"><p className="text-gray-600">無法載入設定</p></div>;

  return (
    <div className="pb-20">
      <SettingsBackButton />
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-${GRID_GAP} mb-6`}>
        <PageHeader title="服務項目設定" />
        <div className="flex items-center gap-3">
          {activeTab === 'service-items' ? (
            <button onClick={handleAddServiceItem} className="btn-primary flex items-center gap-2 whitespace-nowrap">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={STROKE_WIDTH} d="M12 4v16m8-8H4" />
              </svg>
              <span>新增服務項目</span>
            </button>
          ) : (
            <button onClick={handleAddGroupFromHeader} className="btn-primary flex items-center gap-2 whitespace-nowrap">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={STROKE_WIDTH} d="M12 4v16m8-8H4" />
              </svg>
              <span>新增群組</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        <button
          className={`px-${TAB_PADDING_X} py-${TAB_PADDING_Y} text-sm font-medium border-b-2 transition-colors ${activeTab === 'service-items' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('service-items')}
        >
          服務項目列表
        </button>
        <button
          className={`px-${TAB_PADDING_X} py-${TAB_PADDING_Y} text-sm font-medium border-b-2 transition-colors ${activeTab === 'group-management' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('group-management')}
        >
          群組管理
        </button>
      </div>

      {activeTab === 'service-items' ? (
        <div className="space-y-6">
          <div className={`flex flex-col md:flex-row gap-${GRID_GAP}`}>
            <div className="flex-1">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                placeholder="搜尋服務項目、群組名稱..."
              />
            </div>
            <div className="w-full md:w-64">
              <select
                value={selectedGroupId || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedGroupId(val === '' ? null : val === '-1' ? UNGROUPED_ID : parseInt(val, 10));
                }}
                className="w-full h-10 px-3 py-2 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">全部群組</option>
                <option value="-1">未分類</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>
          <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm overflow-hidden">
            <ServiceItemsTable
              appointmentTypes={filteredItems}
              onEdit={handleEditServiceItem}
              onDelete={handleDeleteServiceItem}
              isClinicAdmin={isClinicAdmin}
              groups={groups}
              draggedItemId={draggedItemId}
              onDragStart={handleDragStart}
              onMove={handleMoveServiceItem}
              onDragEnd={handleSaveItemOrder}
              practitionerAssignments={practitionerAssignments}
              disabled={isProcessing}
            />
          </div>
        </div>
      ) : (
        <div className="bg-white md:rounded-xl md:border md:border-gray-100 md:shadow-sm p-4 md:p-6 overflow-hidden">
          <ServiceTypeGroupManagement
            isClinicAdmin={isClinicAdmin}
            appointmentTypes={serviceItems.map(at => ({ id: at.id, service_type_group_id: at.service_type_group_id ?? null }))}
            getGroupCount={getGroupCount}
            onAddGroup={handleAddGroup}
            onUpdateGroup={handleUpdateGroup}
            onDeleteGroup={handleDeleteGroup}
            onDragStart={handleGroupDragStart}
            onMoveGroup={handleMoveGroup}
            onSaveGroupOrder={handleSaveGroupOrder}
            availableGroups={groups}
            triggerAddGroup={triggerAddGroup}
            onTriggerAddGroupHandled={() => setTriggerAddGroup(false)}
          />
        </div>
      )}

      {editingItemId !== undefined && (
        <ServiceItemEditModal
          serviceItemId={editingItemId}
          isOpen={editingItemId !== undefined}
          onClose={handleCloseEditModal}
          practitioners={practitioners}
          isClinicAdmin={isClinicAdmin}
          availableGroups={availableGroups}
          existingNames={serviceItems.map(item => item.name)}
          {...(settings?.clinic_info_settings ? {
            clinicInfoAvailability: {
              has_address: !!settings.clinic_info_settings?.address,
              has_phone: !!settings.clinic_info_settings?.phone_number
            }
          } : {})}
        />
      )}

      {isProcessing && <LoadingSpinner fullScreen />}
    </div>
  );
};

export default SettingsServiceItemsPage;
