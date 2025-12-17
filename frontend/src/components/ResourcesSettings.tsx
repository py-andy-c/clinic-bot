import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResourceType, Resource } from '../types';
import { useResourcesStore } from '../stores/resourcesStore';
import { useModal } from '../contexts/ModalContext';
import { LoadingSpinner } from './shared';

interface ResourcesSettingsProps {
  isClinicAdmin: boolean;
}

const ResourcesSettings: React.FC<ResourcesSettingsProps> = ({ isClinicAdmin }) => {
  const { confirm } = useModal();
  const navigate = useNavigate();
  const {
    resourceTypes,
    resourcesByType,
    associatedServiceItems,
    loadingResources,
    loadResources,
    loadAssociatedServiceItems,
    addResourceType,
    updateResourceTypeLocal,
    removeResourceTypeLocal,
    addResourceLocal,
    updateResourceLocal,
    removeResourceLocal,
    hasUnsavedChanges,
  } = useResourcesStore();

  const [expandedTypes, setExpandedTypes] = useState<Set<number>>(new Set());

  const handleServiceItemsNavigation = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (hasUnsavedChanges()) {
      const confirmed = await confirm('您有未儲存的變更，確定要離開嗎？', '確認離開');
      if (!confirmed) return;
    }
    navigate('/admin/clinic/settings/service-items');
  };

  const toggleType = async (typeId: number) => {
    const isExpanding = !expandedTypes.has(typeId);
    
    setExpandedTypes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(typeId)) {
        newSet.delete(typeId);
      } else {
        newSet.add(typeId);
      }
      return newSet;
    });

    // Load data when expanding (only if it's not a new temporary type)
    if (isExpanding && typeId < 1000000000000) {
      loadResources(typeId);
      loadAssociatedServiceItems(typeId);
    }
  };

  const handleAddResourceType = () => {
    addResourceType();
    // After adding, find the last added (it has a temp ID based on Date.now())
    // and expand it. Since state update is async, we can't easily get the ID here,
    // but we know it's a temp ID > THRESHOLD.
    // In practice, we just want the new card to be expanded.
    // We'll handle this by checking if it's a new type in the render.
  };

  // Expand new resource types automatically
  React.useEffect(() => {
    const tempTypes = resourceTypes.filter(t => t.id >= 1000000000000);
    if (tempTypes.length > 0) {
      setExpandedTypes(prev => {
        const newSet = new Set(prev);
        tempTypes.forEach(t => newSet.add(t.id));
        return newSet;
      });
    }
  }, [resourceTypes.length]);

  const handleDeleteResourceType = async (type: ResourceType) => {
    const confirmed = await confirm(
      `確定要刪除資源類型「${type.name || '未命名'}」嗎？\n\n此操作無法復原。`,
      '確認刪除'
    );
    if (confirmed) {
      removeResourceTypeLocal(type.id);
    }
  };

  const handleCreateResource = (typeId: number) => {
    addResourceLocal(typeId);
  };

  const handleDeleteResource = async (typeId: number, resource: Resource) => {
    const confirmed = await confirm(
      `確定要刪除資源「${resource.name || '未命名'}」嗎？\n\n如果此資源正在使用中，將無法刪除。`,
      '確認刪除'
    );
    if (confirmed) {
      removeResourceLocal(typeId, resource.id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Resource Types List */}
      <div>
        <div className="mb-2">
          <label className="block text-sm font-medium text-gray-700">資源類型</label>
        </div>

        <div className="space-y-4">
          {resourceTypes.map((type) => {
            const isExpanded = expandedTypes.has(type.id);
            const resources = resourcesByType[type.id] || [];
            const serviceItems = associatedServiceItems[type.id] || [];

            return (
              <div key={type.id} className={`border border-gray-200 rounded-lg ${!isExpanded ? 'hover:bg-gray-50 transition-colors' : ''}`}>
                {/* Header (Collapsed) */}
                {!isExpanded && (
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => toggleType(type.id)}
                            className="text-left flex-1 flex items-center gap-2 p-2 rounded"
                          >
                            <svg
                              className="w-5 h-5 text-gray-400 transition-transform"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900">
                                  {type.name || <span className="text-gray-400 italic">未命名資源類型</span>}
                                </span>
                              </div>
                              <div className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                                <span>{resources.length} 個資源</span>
                                <span className="text-gray-300">·</span>
                                <span>{serviceItems.length} 個相關服務</span>
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                      {isClinicAdmin && (
                        <div className="flex items-center gap-2 ml-4">
                          <button
                            type="button"
                            onClick={() => handleDeleteResourceType(type)}
                            className="text-red-600 hover:text-red-800 p-2"
                            title="刪除"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1 space-y-3">
                        {/* Collapse and Actions */}
                        <div className="flex items-center justify-between mb-2">
                          <button
                            type="button"
                            onClick={() => toggleType(type.id)}
                            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                          >
                            <svg
                              className="w-4 h-4 text-gray-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            <span>收起</span>
                          </button>
                          {isClinicAdmin && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleDeleteResourceType(type)}
                                className="text-red-600 hover:text-red-800 p-1.5 hover:bg-red-50 rounded transition-colors"
                                title="刪除"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Resource Type Name */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            資源類型名稱
                          </label>
                          <input
                            type="text"
                            value={type.name}
                            onChange={(e) => updateResourceTypeLocal(type.id, e.target.value)}
                            placeholder="例如：治療室、運動設備"
                            disabled={!isClinicAdmin}
                            className="input"
                          />
                        </div>

                        {/* Associated Service Items */}
                        {serviceItems.length > 0 && (
                          <div className="border border-gray-100 rounded-md p-3 bg-blue-50/50">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">相關服務項目</h4>
                              <button 
                                onClick={handleServiceItemsNavigation}
                                className="text-xs text-primary-600 hover:underline font-medium flex items-center gap-1"
                              >
                                修改需求 <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-x-2 gap-y-1 items-center">
                              {serviceItems.map((item, idx) => (
                                <React.Fragment key={item.id}>
                                  {idx > 0 && <span className="text-gray-300 text-xs mx-1">|</span>}
                                  <div className="text-sm text-gray-600">
                                    {item.name} (需 {item.required_quantity} 個)
                                  </div>
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Resources List */}
                        <div className="space-y-3 pt-2">
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-sm font-medium text-gray-700">資源清單</label>
                          </div>
                          
                          {loadingResources.has(type.id) ? (
                            <div className="flex justify-center py-4">
                              <LoadingSpinner size="sm" />
                            </div>
                          ) : resources.length === 0 ? (
                            <div className="text-sm text-gray-500 italic py-2">尚無資源</div>
                          ) : (
                            <div className="space-y-2">
                              {resources.map((resource) => (
                                <div key={resource.id} className="flex gap-3 items-start group">
                                  <div className="flex-1">
                                    <input
                                      type="text"
                                      value={resource.name}
                                      onChange={(e) => updateResourceLocal(resource.id, e.target.value, resource.description || '')}
                                      placeholder="資源名稱"
                                      className="input text-sm py-1.5"
                                    />
                                  </div>
                                  <div className="flex-[2]">
                                    <input
                                      type="text"
                                      value={resource.description || ''}
                                      onChange={(e) => updateResourceLocal(resource.id, resource.name, e.target.value)}
                                      placeholder="備注 (選填)"
                                      className="input text-sm py-1.5"
                                    />
                                  </div>
                                  {isClinicAdmin && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteResource(type.id, resource)}
                                      className="text-gray-400 hover:text-red-600 p-1.5 mt-0.5"
                                      title="刪除"
                                    >
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add Resource Button */}
                          {isClinicAdmin && (
                            <div className="mt-4">
                              <button
                                type="button"
                                onClick={() => handleCreateResource(type.id)}
                                className="btn-secondary text-xs w-full py-2 flex items-center justify-center gap-1"
                              >
                                <span>+ 新增資源</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add Resource Type Button */}
        {isClinicAdmin && (
          <div className="mt-6">
            <button
              type="button"
              onClick={handleAddResourceType}
              className="btn-secondary text-sm w-full py-3"
            >
              + 新增資源類型
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResourcesSettings;

