import React, { useState, useEffect } from 'react';
import { ServiceTypeGroup } from '../types';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { useModal } from '../contexts/ModalContext';

interface ServiceTypeGroupManagementProps {
  isClinicAdmin: boolean;
  onGroupChange?: () => void;
  appointmentTypes?: Array<{ id: number; service_type_group_id?: number | null }>;
}

export const ServiceTypeGroupManagement: React.FC<ServiceTypeGroupManagementProps> = ({
  isClinicAdmin,
  onGroupChange,
  appointmentTypes = [],
}) => {
  const [groups, setGroups] = useState<ServiceTypeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [draggedGroupId, setDraggedGroupId] = useState<number | null>(null);
  const { confirm, alert } = useModal();

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      setLoading(true);
      const response = await apiService.getServiceTypeGroups();
      const sortedGroups = response.groups.sort((a, b) => a.display_order - b.display_order);
      setGroups(sortedGroups);
    } catch (err) {
      logger.error('Error loading service type groups:', err);
      await alert('載入群組失敗', '錯誤');
    } finally {
      setLoading(false);
    }
  };

  const handleAddGroup = async () => {
    if (!isClinicAdmin) return;
    
    const name = prompt('請輸入群組名稱：');
    if (!name || name.trim() === '') return;

    try {
      const maxOrder = groups.length > 0 ? Math.max(...groups.map(g => g.display_order)) : -1;
      await apiService.createServiceTypeGroup({
        name: name.trim(),
        display_order: maxOrder + 1,
      });
      await loadGroups();
      onGroupChange?.();
    } catch (err: any) {
      logger.error('Error creating group:', err);
      const errorMessage = err?.response?.data?.detail || err?.message || '建立群組失敗';
      await alert(errorMessage, '錯誤');
    }
  };

  const handleStartEdit = (group: ServiceTypeGroup) => {
    setEditingGroupId(group.id);
    setEditingName(group.name);
  };

  const handleCancelEdit = () => {
    setEditingGroupId(null);
    setEditingName('');
  };

  const handleSaveEdit = async (groupId: number) => {
    if (!editingName.trim()) {
      await alert('群組名稱不能為空', '錯誤');
      return;
    }

    try {
      await apiService.updateServiceTypeGroup(groupId, { name: editingName.trim() });
      await loadGroups();
      setEditingGroupId(null);
      setEditingName('');
      onGroupChange?.();
    } catch (err: any) {
      logger.error('Error updating group:', err);
      const errorMessage = err?.response?.data?.detail || err?.message || '更新群組失敗';
      await alert(errorMessage, '錯誤');
    }
  };

  const handleDelete = async (group: ServiceTypeGroup) => {
    if (!isClinicAdmin) return;

    const confirmed = await confirm(
      `確定要刪除群組「${group.name}」嗎？\n\n此群組中的服務項目將被移至「未分類」。`,
      '刪除群組'
    );

    if (!confirmed) return;

    try {
      await apiService.deleteServiceTypeGroup(group.id);
      await loadGroups();
      onGroupChange?.();
    } catch (err: any) {
      logger.error('Error deleting group:', err);
      const errorMessage = err?.response?.data?.detail || err?.message || '刪除群組失敗';
      await alert(errorMessage, '錯誤');
    }
  };

  const handleDragStart = (e: React.DragEvent, groupId: number) => {
    setDraggedGroupId(groupId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetGroupId: number) => {
    e.preventDefault();
    if (!draggedGroupId || draggedGroupId === targetGroupId) return;

    const draggedIndex = groups.findIndex(g => g.id === draggedGroupId);
    const targetIndex = groups.findIndex(g => g.id === targetGroupId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const newGroups = [...groups];
    const [removed] = newGroups.splice(draggedIndex, 1);
    if (!removed) return;
    newGroups.splice(targetIndex, 0, removed);

    // Update display_order for all affected groups
    const groupOrders = newGroups.map((g, index) => ({
      id: g.id,
      display_order: index,
    }));

    try {
      await apiService.bulkUpdateGroupOrder(groupOrders);
      setGroups(newGroups);
      setDraggedGroupId(null);
    } catch (err) {
      logger.error('Error updating group order:', err);
      await loadGroups(); // Reload on error
      setDraggedGroupId(null);
    }
  };

  const handleDragEnd = () => {
    setDraggedGroupId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">群組管理</label>
        <p className="text-sm text-gray-500 mb-4">
          建立群組以分類服務項目。群組主要用於內部管理和報表分析。
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">尚無群組</p>
          <p className="text-xs mt-1">建立群組以分類服務項目</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
          <div
            key={group.id}
            draggable={isClinicAdmin}
            onDragStart={(e) => handleDragStart(e, group.id)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, group.id)}
            onDragEnd={handleDragEnd}
            className={`flex items-center justify-between p-4 border border-gray-200 rounded-lg bg-white ${
              draggedGroupId === group.id ? 'opacity-50' : ''
            } ${isClinicAdmin ? 'cursor-move' : ''}`}
          >
            <div className="flex items-center gap-3 flex-1">
              {isClinicAdmin && (
                <div className="text-gray-400 cursor-move">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                  </svg>
                </div>
              )}
              {editingGroupId === group.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="flex-1 px-3 py-1 border border-gray-300 rounded text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveEdit(group.id);
                      } else if (e.key === 'Escape') {
                        handleCancelEdit();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveEdit(group.id)}
                    className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    儲存
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">
                      {group.name}
                      {appointmentTypes && (
                        <span className="text-sm text-gray-500 ml-2">
                          ({appointmentTypes.filter((at: any) => at.service_type_group_id === group.id).length})
                        </span>
                      )}
                    </div>
                  </div>
                  {isClinicAdmin && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(group)}
                        className="px-3 py-1 text-sm text-blue-600 hover:text-blue-700"
                      >
                        編輯
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(group)}
                        className="px-3 py-1 text-sm text-red-600 hover:text-red-700"
                      >
                        刪除
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        </div>
      )}

      {isClinicAdmin && (
        <button
          type="button"
          onClick={handleAddGroup}
          className="btn-secondary text-sm w-full"
        >
          + 新增群組
        </button>
      )}
    </div>
  );
};

