import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../types/api';
import { ResourceType, Resource } from '../../types';
import { LoadingSpinner } from '../../components/shared';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';
import { useModal } from '../../contexts/ModalContext';

const SettingsResourcesPage: React.FC = () => {
  const { alert, confirm } = useModal();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>([]);
  const [resourcesByType, setResourcesByType] = useState<Record<number, Resource[]>>({});
  const [expandedTypes, setExpandedTypes] = useState<Set<number>>(new Set());
  const [editingResourceType, setEditingResourceType] = useState<number | null>(null);
  const [editingResource, setEditingResource] = useState<number | null>(null);
  const [newResourceTypeName, setNewResourceTypeName] = useState('');
  const [newResourceName, setNewResourceName] = useState<Record<number, string>>({});
  const [newResourceDescription, setNewResourceDescription] = useState<Record<number, string>>({});
  const [associatedServiceItems, setAssociatedServiceItems] = useState<Record<number, Array<{ id: number; name: string; required_quantity: number }>>>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const response = await apiService.getResourceTypes();
      const types = response.resource_types;
      setResourceTypes(types);

      // Load resources for each type
      const resourcesMap: Record<number, Resource[]> = {};
      for (const type of types) {
        try {
          const resourcesResponse = await apiService.getResources(type.id);
          resourcesMap[type.id] = resourcesResponse.resources;
        } catch (err) {
          logger.error(`Failed to load resources for type ${type.id}:`, err);
          resourcesMap[type.id] = [];
        }
      }
      setResourcesByType(resourcesMap);
    } catch (err) {
      logger.error('Failed to load resource types:', err);
      await alert(getErrorMessage(err) || '載入資源類型失敗', '錯誤');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateResourceType = async () => {
    if (!newResourceTypeName.trim()) {
      await alert('請輸入資源類型名稱', '錯誤');
      return;
    }

    try {
      setSaving(true);
      const newType = await apiService.createResourceType({ name: newResourceTypeName.trim() });
      setResourceTypes([...resourceTypes, newType]);
      setResourcesByType({ ...resourcesByType, [newType.id]: [] });
      setNewResourceTypeName('');
      await alert('資源類型已建立', '成功');
    } catch (err) {
      logger.error('Failed to create resource type:', err);
      await alert(getErrorMessage(err) || '建立資源類型失敗', '錯誤');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateResourceType = async (typeId: number, name: string) => {
    if (!name.trim()) {
      await alert('請輸入資源類型名稱', '錯誤');
      return;
    }

    try {
      setSaving(true);
      const updated = await apiService.updateResourceType(typeId, { name: name.trim() });
      setResourceTypes(resourceTypes.map(t => t.id === typeId ? updated : t));
      setEditingResourceType(null);
      await alert('資源類型已更新', '成功');
    } catch (err) {
      logger.error('Failed to update resource type:', err);
      await alert(getErrorMessage(err) || '更新資源類型失敗', '錯誤');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteResourceType = async (typeId: number) => {
    const type = resourceTypes.find(t => t.id === typeId);
    if (!type) return;

    const confirmed = await confirm(
      `確定要刪除資源類型「${type.name}」嗎？\n\n此操作無法復原。`,
      '確認刪除'
    );
    if (!confirmed) return;

    try {
      setSaving(true);
      await apiService.deleteResourceType(typeId);
      setResourceTypes(resourceTypes.filter(t => t.id !== typeId));
      const newResourcesByType = { ...resourcesByType };
      delete newResourcesByType[typeId];
      setResourcesByType(newResourcesByType);
      await alert('資源類型已刪除', '成功');
    } catch (err) {
      logger.error('Failed to delete resource type:', err);
      await alert(getErrorMessage(err) || '刪除資源類型失敗', '錯誤');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateResource = async (typeId: number) => {
    try {
      setSaving(true);
      const resourceData: { name?: string; description?: string } = {};
      if (newResourceName[typeId]?.trim()) {
        resourceData.name = newResourceName[typeId]!.trim();
      }
      if (newResourceDescription[typeId]?.trim()) {
        resourceData.description = newResourceDescription[typeId]!.trim();
      }
      const newResource = await apiService.createResource(typeId, resourceData);
      setResourcesByType({
        ...resourcesByType,
        [typeId]: [...(resourcesByType[typeId] || []), newResource],
      });
      setNewResourceName({ ...newResourceName, [typeId]: '' });
      setNewResourceDescription({ ...newResourceDescription, [typeId]: '' });
      await alert('資源已建立', '成功');
    } catch (err) {
      logger.error('Failed to create resource:', err);
      await alert(getErrorMessage(err) || '建立資源失敗', '錯誤');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateResource = async (resourceId: number, name: string, description: string) => {
    if (!name.trim()) {
      await alert('請輸入資源名稱', '錯誤');
      return;
    }

    try {
      setSaving(true);
      const updateData: { name: string; description?: string } = {
        name: name.trim(),
      };
      if (description.trim()) {
        updateData.description = description.trim();
      }
      const updated = await apiService.updateResource(resourceId, updateData);
      
      // Update in resourcesByType
      const newResourcesByType = { ...resourcesByType };
      for (const typeId in newResourcesByType) {
        const resources = newResourcesByType[typeId];
        if (resources) {
          const index = resources.findIndex(r => r.id === resourceId);
          if (index !== -1) {
            newResourcesByType[typeId] = [
              ...resources.slice(0, index),
              updated,
              ...resources.slice(index + 1),
            ];
            break;
          }
        }
      }
      setResourcesByType(newResourcesByType);
      setEditingResource(null);
      await alert('資源已更新', '成功');
    } catch (err) {
      logger.error('Failed to update resource:', err);
      await alert(getErrorMessage(err) || '更新資源失敗', '錯誤');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteResource = async (resourceId: number, resourceName: string) => {
    const confirmed = await confirm(
      `確定要刪除資源「${resourceName}」嗎？\n\n如果此資源正在使用中，將無法刪除。`,
      '確認刪除'
    );
    if (!confirmed) return;

    try {
      setSaving(true);
      await apiService.deleteResource(resourceId);
      
      // Remove from resourcesByType
      const newResourcesByType = { ...resourcesByType };
      for (const typeId in newResourcesByType) {
        const resources = newResourcesByType[typeId];
        if (resources) {
          newResourcesByType[typeId] = resources.filter(r => r.id !== resourceId);
        }
      }
      setResourcesByType(newResourcesByType);
      await alert('資源已刪除', '成功');
    } catch (err) {
      logger.error('Failed to delete resource:', err);
      await alert(getErrorMessage(err) || '刪除資源失敗', '錯誤');
    } finally {
      setSaving(false);
    }
  };

  const toggleTypeExpansion = async (typeId: number) => {
    const newExpanded = new Set(expandedTypes);
    const isCurrentlyExpanded = newExpanded.has(typeId);
    
    if (isCurrentlyExpanded) {
      newExpanded.delete(typeId);
    } else {
      newExpanded.add(typeId);
      // Load associated service items when expanding
      if (!associatedServiceItems[typeId]) {
        try {
          const response = await apiService.getAppointmentTypesByResourceType(typeId);
          setAssociatedServiceItems({
            ...associatedServiceItems,
            [typeId]: response.appointment_types
          });
        } catch (err) {
          logger.error(`Failed to load associated service items for resource type ${typeId}:`, err);
          // Don't show error - just set empty array
          setAssociatedServiceItems({
            ...associatedServiceItems,
            [typeId]: []
          });
        }
      }
    }
    setExpandedTypes(newExpanded);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <>
      <SettingsBackButton />
      <PageHeader title="設備資源設定" />
      
      <div className="space-y-4">
        {/* Create Resource Type */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 md:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">新增資源類型</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newResourceTypeName}
              onChange={(e) => setNewResourceTypeName(e.target.value)}
              placeholder="例如：治療室、設備"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreateResourceType();
                }
              }}
            />
            <button
              type="button"
              onClick={handleCreateResourceType}
              disabled={saving || !newResourceTypeName.trim()}
              className="btn-primary px-4 py-2"
            >
              新增
            </button>
          </div>
        </div>

        {/* Resource Types List */}
        {resourceTypes.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center text-gray-600">
            尚無資源類型，請先新增資源類型
          </div>
        ) : (
          resourceTypes.map((type) => {
            const resources = resourcesByType[type.id] || [];
            const isExpanded = expandedTypes.has(type.id);
            const isEditingType = editingResourceType === type.id;

            return (
              <div key={type.id} className="bg-white rounded-lg border border-gray-200 shadow-sm">
                {/* Resource Type Header */}
                <div className="p-4 md:p-6 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <button
                        type="button"
                        onClick={() => toggleTypeExpansion(type.id)}
                        className="text-gray-600 hover:text-gray-900"
                      >
                        <svg
                          className={`w-5 h-5 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      {isEditingType ? (
                        <div className="flex gap-2 flex-1">
                          <input
                            type="text"
                            defaultValue={type.name}
                            onBlur={(e) => {
                              if (e.target.value !== type.name) {
                                handleUpdateResourceType(type.id, e.target.value);
                              } else {
                                setEditingResourceType(null);
                              }
                            }}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              }
                            }}
                            autoFocus
                            className="flex-1 px-3 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        </div>
                      ) : (
                        <>
                          <h3 className="text-lg font-semibold text-gray-900">{type.name}</h3>
                          <span className="text-sm text-gray-500">
                            ({resources.length} 個資源)
                          </span>
                        </>
                      )}
                    </div>
                    {!isEditingType && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingResourceType(type.id)}
                          className="text-sm text-primary-600 hover:text-primary-700"
                        >
                          編輯
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteResourceType(type.id)}
                          disabled={saving}
                          className="text-sm text-red-600 hover:text-red-700"
                        >
                          刪除
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Resources List */}
                {isExpanded && (
                  <div className="p-4 md:p-6 space-y-4">
                    {/* Associated Service Items Section */}
                    {(() => {
                      const serviceItems = associatedServiceItems[type.id];
                      return serviceItems && serviceItems.length > 0 && (
                        <div className="border border-gray-200 rounded-md p-4 bg-blue-50">
                          <h4 className="text-sm font-medium text-gray-900 mb-2">相關服務項目</h4>
                          <ul className="space-y-1 mb-3">
                            {serviceItems.map((item) => (
                              <li key={item.id} className="text-sm text-gray-700">
                                • {item.name}（需要數量：{item.required_quantity}）
                              </li>
                            ))}
                          </ul>
                          <p className="text-xs text-gray-600 mb-2">
                            要修改資源需求，請前往「服務項目」設定頁面
                          </p>
                          <Link
                            to="/clinic/settings/service-items"
                            className="text-xs text-primary-600 hover:text-primary-700 underline"
                          >
                            前往服務項目設定 →
                          </Link>
                        </div>
                      );
                    })()}

                    {/* Create Resource */}
                    <div className="border border-gray-200 rounded-md p-4 bg-gray-50">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">新增資源</h4>
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={newResourceName[type.id] || ''}
                          onChange={(e) => setNewResourceName({ ...newResourceName, [type.id]: e.target.value })}
                          placeholder="資源名稱（留空將自動產生）"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <input
                          type="text"
                          value={newResourceDescription[type.id] || ''}
                          onChange={(e) => setNewResourceDescription({ ...newResourceDescription, [type.id]: e.target.value })}
                          placeholder="描述（選填）"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleCreateResource(type.id)}
                          disabled={saving}
                          className="btn-primary text-sm px-4 py-2"
                        >
                          新增資源
                        </button>
                      </div>
                    </div>

                    {/* Resources */}
                    {resources.length === 0 ? (
                      <div className="text-center text-gray-500 py-4">
                        尚無資源
                      </div>
                    ) : (
                      resources.map((resource) => {
                        const isEditing = editingResource === resource.id;

                        return (
                          <div
                            key={resource.id}
                            className="border border-gray-200 rounded-md p-4 flex items-start justify-between"
                          >
                            {isEditing ? (
                              <div className="flex-1 space-y-2">
                                <input
                                  type="text"
                                  defaultValue={resource.name}
                                  onBlur={(e) => {
                                    const newName = e.target.value;
                                    const newDesc = (document.getElementById(`desc-${resource.id}`) as HTMLInputElement)?.value || '';
                                    if (newName !== resource.name || newDesc !== (resource.description || '')) {
                                      handleUpdateResource(resource.id, newName, newDesc);
                                    } else {
                                      setEditingResource(null);
                                    }
                                  }}
                                  onKeyPress={(e) => {
                                    if (e.key === 'Enter') {
                                      e.currentTarget.blur();
                                    }
                                  }}
                                  autoFocus
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                                />
                                <input
                                  id={`desc-${resource.id}`}
                                  type="text"
                                  defaultValue={resource.description || ''}
                                  placeholder="描述（選填）"
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                                  onKeyPress={(e) => {
                                    if (e.key === 'Enter') {
                                      e.currentTarget.blur();
                                    }
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="flex-1">
                                <div className="font-medium text-gray-900">{resource.name}</div>
                                {resource.description && (
                                  <div className="text-sm text-gray-600 mt-1">{resource.description}</div>
                                )}
                              </div>
                            )}
                            {!isEditing && (
                              <div className="flex gap-2 ml-4">
                                <button
                                  type="button"
                                  onClick={() => setEditingResource(resource.id)}
                                  className="text-sm text-primary-600 hover:text-primary-700"
                                >
                                  編輯
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteResource(resource.id, resource.name)}
                                  disabled={saving}
                                  className="text-sm text-red-600 hover:text-red-700"
                                >
                                  刪除
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
};

export default SettingsResourcesPage;

