import React, { useState, useEffect, useRef } from 'react';
import { ServiceTypeGroup } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';

interface ServiceTypeGroupsTableProps {
  groups: ServiceTypeGroup[];
  appointmentTypes?: Array<{ id: number; service_type_group_id?: number | null }>;
  getGroupCount: (groupId: number | null) => number;
  onSave: (group: ServiceTypeGroup, newName: string) => void;
  onDelete: (group: ServiceTypeGroup) => void;
  isClinicAdmin: boolean;
  draggedGroupId: number | null;
  onDragStart: (e: React.DragEvent, groupId: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetGroupId: number, position?: 'above' | 'below') => void;
  onDragEnd: () => void;
  addingNewGroup?: boolean;
  onCancelAdd?: () => void;
}

export const ServiceTypeGroupsTable: React.FC<ServiceTypeGroupsTableProps> = ({
  groups,
  appointmentTypes: _appointmentTypes = [], // eslint-disable-line @typescript-eslint/no-unused-vars
  getGroupCount,
  onSave,
  onDelete,
  isClinicAdmin,
  draggedGroupId,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  addingNewGroup = false,
  onCancelAdd,
}) => {
  const isMobile = useIsMobile();
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropIndicator, setDropIndicator] = useState<{ groupId: number; position: 'above' | 'below' } | null>(null);

  // Auto-focus input when editing starts
  useEffect(() => {
    if (editingGroupId !== null || addingNewGroup) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [editingGroupId, addingNewGroup]);

  // Handle adding new group state
  useEffect(() => {
    if (addingNewGroup) {
      setEditingGroupId(-1); // Use -1 to represent "new group" row
      setEditingName('');
      setErrorMessage('');
    } else if (editingGroupId === -1) {
      setEditingGroupId(null);
    }
  }, [addingNewGroup]);

  const handleStartEdit = (group: ServiceTypeGroup) => {
    setEditingGroupId(group.id);
    setEditingName(group.name);
    setErrorMessage('');
  };

  const handleConfirm = (group: ServiceTypeGroup | { id: number; name: string }) => {
    const trimmedName = editingName.trim();
    setErrorMessage(''); // Clear previous errors
    
    if (!trimmedName) {
      setErrorMessage('群組名稱不能為空');
      return;
    }

    // Check for duplicate names (excluding current group)
    const duplicateGroup = groups.find(
      g => g.name.trim().toLowerCase() === trimmedName.toLowerCase() && g.id !== group.id
    );
    
    if (duplicateGroup) {
      setErrorMessage('群組名稱已存在');
      return;
    }

    // Validation passed - save and exit edit mode
    onSave(group as ServiceTypeGroup, trimmedName);
    setEditingGroupId(null);
    setEditingName('');
    setErrorMessage('');
  };

  const handleCancel = () => {
    if (editingGroupId === -1 && onCancelAdd) {
      onCancelAdd();
    }
    setEditingGroupId(null);
    setEditingName('');
    setErrorMessage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent, group: ServiceTypeGroup | { id: number; name: string }) => {
    if (e.key === 'Enter') {
      handleConfirm(group);
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const handleDragOver = (e: React.DragEvent, groupId: number) => {
    // Call parent's onDragOver first
    onDragOver(e);
    
    // Update drop indicator based on current mouse position
    if (!draggedGroupId || draggedGroupId === groupId) {
      setDropIndicator(null);
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseY = e.clientY;
    const rowCenter = rect.top + rect.height / 2;
    
    // Determine if drop should be above or below based on mouse position
    const position = mouseY < rowCenter ? 'above' : 'below';
    setDropIndicator({ groupId, position });
  };

  const renderGroupRow = (group: ServiceTypeGroup) => {
    const isEditing = editingGroupId === group.id;
    const serviceCount = getGroupCount(group.id);

    if (isMobile) {
      return (
        <React.Fragment key={group.id}>
          {/* Drop indicator line above */}
          {dropIndicator?.groupId === group.id && dropIndicator.position === 'above' && (
            <div className="h-1.5 bg-blue-600 shadow-md shadow-blue-500/30 mx-2 my-1 rounded-full" />
          )}
          
          <div
            draggable={isClinicAdmin && !isEditing}
            onDragStart={(e) => onDragStart(e, group.id)}
            onDragOver={(e) => handleDragOver(e, group.id)}
            onDrop={(e) => {
              const position = dropIndicator?.groupId === group.id ? dropIndicator.position : undefined;
              setDropIndicator(null);
              onDrop(e, group.id, position);
            }}
            onDragEnd={() => {
              setDropIndicator(null);
              onDragEnd();
            }}
            className={`bg-white border border-gray-200 rounded-lg p-4 shadow-sm ${
              draggedGroupId === group.id ? 'opacity-30' : ''
            } ${isClinicAdmin && !isEditing ? 'cursor-move' : ''}`}
          >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                {isClinicAdmin && !isEditing && (
                  <div className="text-gray-400 cursor-move">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                    </svg>
                  </div>
                )}
                
                {isEditing ? (
                  <div className="flex-1">
                    <input
                      ref={inputRef}
                      type="text"
                      value={editingName}
                      onChange={(e) => {
                        setEditingName(e.target.value);
                        setErrorMessage(''); // Clear error on input change
                      }}
                      onKeyDown={(e) => handleKeyDown(e, group)}
                      className={`input py-1 text-sm flex-1 ${errorMessage ? 'border-red-500' : ''}`}
                      placeholder="群組名稱"
                    />
                    {errorMessage && (
                      <p className="text-red-600 text-xs mt-1">{errorMessage}</p>
                    )}
                  </div>
                ) : (
                  <h3 className="font-medium text-gray-900 text-sm">{group.name}</h3>
                )}
              </div>
              {!isEditing && (
                <div className="text-xs text-gray-500 ml-7">
                  {serviceCount} 個服務項目
                </div>
              )}
            </div>
            
            {isClinicAdmin && (
              <div className="flex items-center gap-2 ml-2">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleConfirm(group)}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1"
                    >
                      確認
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="text-gray-500 hover:text-gray-700 text-xs font-medium px-2 py-1"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleStartEdit(group)}
                      className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1.5 rounded border border-blue-200 hover:border-blue-300"
                    >
                      編輯
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(group)}
                      className="text-red-600 hover:text-red-800 text-sm px-3 py-1.5 rounded border border-red-200 hover:border-red-300"
                    >
                      刪除
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Drop indicator line below */}
        {dropIndicator?.groupId === group.id && dropIndicator.position === 'below' && (
          <div className="h-1.5 bg-blue-600 shadow-md shadow-blue-500/30 mx-2 my-1 rounded-full" />
        )}
      </React.Fragment>
      );
    }

    // Desktop row
    return (
      <React.Fragment key={group.id}>
        {/* Drop indicator line above */}
        {dropIndicator?.groupId === group.id && dropIndicator.position === 'above' && (
          <tr>
            <td colSpan={isClinicAdmin ? 3 : 2} className="px-0 py-0">
              <div className="h-1.5 bg-blue-600 shadow-md shadow-blue-500/30 w-full" />
            </td>
          </tr>
        )}
        
        <tr
          draggable={isClinicAdmin && !isEditing}
          onDragStart={(e) => onDragStart(e, group.id)}
          onDragOver={(e) => handleDragOver(e, group.id)}
          onDrop={(e) => {
            const position = dropIndicator?.groupId === group.id ? dropIndicator.position : undefined;
            setDropIndicator(null);
            onDrop(e, group.id, position);
          }}
          onDragEnd={() => {
            setDropIndicator(null);
            onDragEnd();
          }}
          className={`hover:bg-gray-50 transition-colors ${
            draggedGroupId === group.id ? 'opacity-30' : ''
          } ${isClinicAdmin && !isEditing ? 'cursor-move' : ''} ${isEditing ? 'bg-blue-50/30' : ''}`}
        >
        <td className="px-6 py-4 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <div className="w-6 flex-shrink-0">
              {isClinicAdmin && !isEditing && (
                <div className="text-gray-400 cursor-move">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                  </svg>
                </div>
              )}
            </div>
            
            {isEditing ? (
              <div>
                <input
                  ref={inputRef}
                  type="text"
                  value={editingName}
                  onChange={(e) => {
                    setEditingName(e.target.value);
                    setErrorMessage(''); // Clear error on input change
                  }}
                  onKeyDown={(e) => handleKeyDown(e, group)}
                  className={`block w-full px-3 py-1.5 text-sm text-gray-900 bg-white border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm ${
                    errorMessage ? 'border-red-500' : 'border-blue-300'
                  }`}
                  placeholder="群組名稱"
                />
                {errorMessage && (
                  <p className="text-red-600 text-xs mt-1">{errorMessage}</p>
                )}
              </div>
            ) : (
              <span className="text-sm font-medium text-gray-900">{group.name}</span>
            )}
          </div>
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          {isEditing ? (
            <span className="text-gray-300">-</span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
              {serviceCount} 個項目
            </span>
          )}
        </td>
        {isClinicAdmin && (
          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            <div className="flex items-center justify-end gap-3">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleConfirm(group)}
                    className="text-blue-600 hover:text-blue-800 font-semibold transition-colors"
                  >
                    確認
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleStartEdit(group)}
                    className="text-gray-400 hover:text-blue-600 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(group)}
                    className="text-gray-400 hover:text-red-600 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </td>
        )}
      </tr>
      
      {/* Drop indicator line below */}
      {dropIndicator?.groupId === group.id && dropIndicator.position === 'below' && (
        <tr>
          <td colSpan={isClinicAdmin ? 3 : 2} className="px-0 py-0">
            <div className="h-1.5 bg-blue-600 shadow-md shadow-blue-500/30 w-full" />
          </td>
        </tr>
      )}
    </React.Fragment>
    );
  };

  const renderNewGroupRow = () => {
    if (!addingNewGroup) return null;

    const dummyGroup = { id: -1, name: '' };

    if (isMobile) {
      return (
        <div className="bg-blue-50/50 border-2 border-dashed border-blue-200 rounded-lg p-4 shadow-sm animate-pulse-slow">
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="text"
              value={editingName}
              onChange={(e) => {
                setEditingName(e.target.value);
                setErrorMessage(''); // Clear error on input change
              }}
              onKeyDown={(e) => handleKeyDown(e, dummyGroup)}
              className={`block w-full px-3 py-2 text-sm text-gray-900 bg-white border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${
                errorMessage ? 'border-red-500' : 'border-blue-300'
              }`}
              placeholder="輸入新群組名稱"
            />
            {errorMessage && (
              <p className="text-red-600 text-xs mt-1">{errorMessage}</p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handleConfirm(dummyGroup)}
                className="text-blue-600 hover:text-blue-800 font-semibold text-sm"
              >
                確認
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="text-gray-400 hover:text-gray-600 font-medium text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <tr className="bg-blue-50/30 border-b border-blue-100">
        <td className="px-6 py-4 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <div className="w-6 flex-shrink-0">
              <div className="text-blue-300">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            <div>
              <input
                ref={inputRef}
                type="text"
                value={editingName}
                onChange={(e) => {
                  setEditingName(e.target.value);
                  setErrorMessage(''); // Clear error on input change
                }}
                onKeyDown={(e) => handleKeyDown(e, dummyGroup)}
                className={`block w-full px-3 py-1.5 text-sm text-gray-900 bg-white border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm max-w-xs ${
                  errorMessage ? 'border-red-500' : 'border-blue-300'
                }`}
                placeholder="輸入新群組名稱"
              />
              {errorMessage && (
                <p className="text-red-600 text-xs mt-1">{errorMessage}</p>
              )}
            </div>
          </div>
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
          -
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => handleConfirm(dummyGroup)}
              className="text-blue-600 hover:text-blue-800 font-semibold"
            >
              確認
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="text-gray-400 hover:text-gray-600"
            >
              取消
            </button>
          </div>
        </td>
      </tr>
    );
  };

  if (isMobile) {
    return (
      <div className="space-y-3">
        {groups.map(renderGroupRow)}
        {renderNewGroupRow()}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              群組名稱
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              服務項目數量
            </th>
            {isClinicAdmin && (
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                操作
              </th>
            )}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {groups.map(renderGroupRow)}
          {renderNewGroupRow()}
        </tbody>
      </table>
    </div>
  );
};

