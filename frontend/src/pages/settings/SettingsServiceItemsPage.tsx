import React, { useState, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useModal } from '../../contexts/ModalContext';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../types/api';
import { AppointmentType, Practitioner } from '../../types';
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
import { useMembers } from '../../hooks/queries/useMembers';
import { usePractitioners } from '../../hooks/queries/usePractitioners';
import { useQueryClient } from '@tanstack/react-query';

type TabType = 'service-items' | 'group-management';

const SettingsServiceItemsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('service-items');
  const [editingItemId, setEditingItemId] = useState<number | null | undefined>(undefined);
  const queryClient = useQueryClient();
  const { data: settings, isLoading: loadingSettings } = useClinicSettings();
  const { data: groupsData, isLoading: loadingGroups } = useServiceTypeGroups();
  const { data: members, isLoading: loadingMembers } = useMembers();
  const { data: practitionersData, isLoading: loadingPractitioners } = usePractitioners();



  const [selectedGroupId, setSelectedGroupId] = useState<number | string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isComposing, setIsComposing] = useState(false);
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const { isClinicAdmin } = useAuth();
  const { alert, confirm } = useModal();
  const debouncedSearchQuery = useDebouncedSearch(searchQuery, 400, isComposing);

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
    const sortedItems = [...serviceItems].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    let filtered = sortedItems;

    if (selectedGroupId !== null) {
      if (selectedGroupId === -1) {
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

  const handleAddServiceItem = () => setEditingItemId(null);
  const handleEditServiceItem = (item: AppointmentType) => setEditingItemId(item.id);

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
    } catch (error: any) {
      logger.error('Error deleting appointment type:', error);
      await alert(getErrorMessage(error) || '刪除失敗，請稍後再試', '刪除失敗');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloseEditModal = async (refetch?: boolean) => {
    if (refetch) await queryClient.invalidateQueries({ queryKey: ['settings'] });
    setEditingItemId(undefined);
  };

  const handleDragStart = (e: React.DragEvent, itemId: number) => {
    setDraggedItemId(itemId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetItemId: number, position?: 'above' | 'below') => {
    e.preventDefault();
    if (!draggedItemId || draggedItemId === targetItemId) return;

    const allItems = [...serviceItems];
    const draggedIndex = allItems.findIndex(i => i.id === draggedItemId);
    let targetIndex = allItems.findIndex(i => i.id === targetItemId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    let insertIndex = position === 'below' ? targetIndex + 1 : targetIndex;
    const newItems = [...allItems];
    const [removed] = newItems.splice(draggedIndex, 1);
    if (!removed) return;
    if (draggedIndex < insertIndex) insertIndex -= 1;
    newItems.splice(insertIndex, 0, removed);
    const orderedIds = newItems.map(i => i.id);

    try {
      setIsProcessing(true);
      await apiService.bulkUpdateAppointmentTypeOrder(
        orderedIds.map((id, index) => ({ id, display_order: index }))
      );
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    } catch (error: any) {
      logger.error('Error reordering items:', error);
      await alert('重新排序失敗，請稍後再試', '錯誤');
    } finally {
      setDraggedItemId(null);
      setIsProcessing(false);
    }
  };


  const handleAddGroup = async (group: any) => {
    try {
      await apiService.createServiceTypeGroup({ name: group.name, display_order: group.display_order });
      await queryClient.invalidateQueries({ queryKey: ['settings', 'service-type-groups'] });
    } catch (err: any) {
      alert(err.message || '建立群組失敗', '錯誤');
    }
  };

  const handleUpdateGroup = async (id: number, updates: any) => {
    try {
      await apiService.updateServiceTypeGroup(id, updates);
      await queryClient.invalidateQueries({ queryKey: ['settings', 'service-type-groups'] });
    } catch (err: any) {
      alert(err.message || '更新群組失敗', '錯誤');
    }
  };

  const handleDeleteGroup = async (id: number) => {
    try {
      await apiService.deleteServiceTypeGroup(id);
      await queryClient.invalidateQueries({ queryKey: ['settings', 'service-type-groups'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    } catch (err: any) {
      alert(err.message || '刪除群組失敗', '錯誤');
    }
  };

  const handleReorderGroups = async (orderedIds: number[]) => {
    try {
      await apiService.bulkUpdateGroupOrder(orderedIds.map((id, index) => ({ id, display_order: index })));
      await queryClient.invalidateQueries({ queryKey: ['settings', 'service-type-groups'] });
    } catch (err) {
      alert('排序群組失敗', '錯誤');
    }
  };

  if (loadingSettings || loadingMembers || loadingGroups || loadingPractitioners) {
    return <div className="flex items-center justify-center min-h-screen"><LoadingSpinner /></div>;
  }

  if (!settings) return <div className="text-center py-12"><p className="text-gray-600">無法載入設定</p></div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="max-w-7xl mx-auto px-4 py-6 md:px-6">
        <SettingsBackButton />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <PageHeader title="服務項目設定" />
          <div className="flex items-center gap-3">
            <button onClick={handleAddServiceItem} className="btn-primary flex items-center gap-2 whitespace-nowrap">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>新增服務項目</span>
            </button>
          </div>
        </div>

        <div className="flex border-b border-gray-200 mb-6">
          <button
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'service-items' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('service-items')}
          >
            服務項目列表
          </button>
          <button
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'group-management' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('group-management')}
          >
            群組管理
          </button>
        </div>

        {activeTab === 'service-items' ? (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-4">
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
                    setSelectedGroupId(val === '' ? null : val === '-1' ? -1 : parseInt(val, 10));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
                >
                  <option value="">全部群組</option>
                  <option value="-1">未分類</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            </div>
            <ServiceItemsTable
              appointmentTypes={filteredItems}
              onEdit={handleEditServiceItem}
              onDelete={handleDeleteServiceItem}
              isClinicAdmin={isClinicAdmin}
              groups={groups}
              draggedItemId={draggedItemId}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={() => setDraggedItemId(null)}
              practitionerAssignments={practitionerAssignments}
              disabled={isProcessing}
            />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <ServiceTypeGroupManagement
              isClinicAdmin={isClinicAdmin}
              appointmentTypes={serviceItems.map(at => ({ id: at.id, service_type_group_id: at.service_type_group_id ?? null }))}
              getGroupCount={getGroupCount}
              onAddGroup={handleAddGroup}
              onUpdateGroup={handleUpdateGroup}
              onDeleteGroup={handleDeleteGroup}
              onReorderGroups={handleReorderGroups}
              availableGroups={groups}
            />
          </div>
        )}
      </div>

      {editingItemId !== undefined && (
        <ServiceItemEditModal
          serviceItemId={editingItemId}
          isOpen={editingItemId !== undefined}
          onClose={handleCloseEditModal}
          members={members || []}
          isClinicAdmin={isClinicAdmin}
          availableGroups={availableGroups}
          {...(settings?.clinic_info_settings ? {
            clinicInfoAvailability: {
              has_address: !!settings.clinic_info_settings.address,
              has_phone: !!settings.clinic_info_settings.phone_number
            }
          } : {})}
        />
      )}

      {isProcessing && <LoadingSpinner fullScreen />}
    </div>
  );
};

export default SettingsServiceItemsPage;
