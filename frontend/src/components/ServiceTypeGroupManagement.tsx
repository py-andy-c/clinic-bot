import React, { useState } from 'react';
import { ServiceTypeGroup } from '../types';
import { useModal } from '../contexts/ModalContext';
import { ServiceTypeGroupsTable } from './ServiceTypeGroupsTable';
import { isRealId } from '../utils/idUtils';

interface ServiceTypeGroupManagementProps {
  isClinicAdmin: boolean;
  appointmentTypes?: Array<{ id: number; service_type_group_id?: number | null }>;
  getGroupCount: (groupId: number | null) => number;
  onAddGroup: (group: ServiceTypeGroup) => void;
  onUpdateGroup: (id: number, updates: Partial<ServiceTypeGroup>) => void;
  onDeleteGroup: (id: number) => void;
  onReorderGroups: (orderedIds: number[]) => void;
  availableGroups: ServiceTypeGroup[];
}

export const ServiceTypeGroupManagement: React.FC<ServiceTypeGroupManagementProps> = ({
  isClinicAdmin,
  appointmentTypes = [],
  getGroupCount,
  onAddGroup,
  onUpdateGroup,
  onDeleteGroup,
  onReorderGroups,
  availableGroups,
}) => {
  const [addingNewGroup, setAddingNewGroup] = useState(false);
  const [draggedGroupId, setDraggedGroupId] = useState<number | null>(null);
  const { confirm } = useModal();

  const handleAddGroup = () => {
    if (!isClinicAdmin) return;
    setAddingNewGroup(true);
  };

  const handleSaveGroup = (group: ServiceTypeGroup | { id: number }, name: string) => {
    if (isRealId(group.id)) {
      // Update existing group
      onUpdateGroup(group.id, { name });
    } else {
      // Create new group
      const maxOrder = availableGroups.length > 0
        ? Math.max(...availableGroups.map(g => g.display_order || 0))
        : -1;
      
      const newGroup: ServiceTypeGroup = {
        id: -Date.now(), // Temporary ID
        clinic_id: availableGroups[0]?.clinic_id || 0,
        name,
        display_order: maxOrder + 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      
      onAddGroup(newGroup);
      setAddingNewGroup(false);
    }
  };

  const handleDeleteGroup = async (group: ServiceTypeGroup) => {
    if (!isClinicAdmin) return;

    const serviceCount = getGroupCount(group.id);
    const confirmed = await confirm(
      `確定要刪除群組「${group.name}」嗎？\n\n此群組中的 ${serviceCount} 個服務項目將被移至「未分類」。`,
      '刪除群組'
    );

    if (!confirmed) return;

    onDeleteGroup(group.id);
  };

  const handleDragStart = (e: React.DragEvent, groupId: number) => {
    setDraggedGroupId(groupId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetGroupId: number, position?: 'above' | 'below') => {
    e.preventDefault();
    if (!draggedGroupId || draggedGroupId === targetGroupId) return;

    const draggedIndex = availableGroups.findIndex(g => g.id === draggedGroupId);
    let targetIndex = availableGroups.findIndex(g => g.id === targetGroupId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    // Calculate final insertion index based on position indicator
    // If dropping "below", insert after the target (targetIndex + 1)
    // If dropping "above" or no position specified, insert at targetIndex
    let insertIndex = position === 'below' ? targetIndex + 1 : targetIndex;

    const newGroups = [...availableGroups];
    const [removed] = newGroups.splice(draggedIndex, 1);
    if (!removed) return;
    
    // Adjust insertion index if dragged item was before the insertion point
    // (removing the dragged item shifts indices down by 1)
    if (draggedIndex < insertIndex) {
      insertIndex -= 1;
    }
    
    newGroups.splice(insertIndex, 0, removed);

    // Get ordered IDs
    const orderedIds = newGroups.map(g => g.id);
    onReorderGroups(orderedIds);
    
    setDraggedGroupId(null);
  };

  const handleDragEnd = () => {
    setDraggedGroupId(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">群組管理</label>
        <p className="text-sm text-gray-500 mb-4">
          建立群組以分類服務項目。群組主要用於內部管理和報表分析。
        </p>
      </div>

      {availableGroups.length === 0 && !addingNewGroup ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">尚無群組</p>
          <p className="text-xs mt-1">建立群組以分類服務項目</p>
        </div>
      ) : (
        <ServiceTypeGroupsTable
          groups={availableGroups}
          appointmentTypes={appointmentTypes}
          getGroupCount={getGroupCount}
          onSave={handleSaveGroup}
          onDelete={handleDeleteGroup}
          isClinicAdmin={isClinicAdmin}
          draggedGroupId={draggedGroupId}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          addingNewGroup={addingNewGroup}
          onCancelAdd={() => setAddingNewGroup(false)}
        />
      )}

      {isClinicAdmin && !addingNewGroup && (
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
