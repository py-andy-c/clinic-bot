import React, { useState, useEffect } from 'react';
import { ResourceType, ResourceRequirement } from '../types';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../types/api';
import { useModal } from '../contexts/ModalContext';
import { useServiceItemsStore } from '../stores/serviceItemsStore';

interface ResourceRequirementsSectionProps {
  appointmentTypeId: number;
  isClinicAdmin: boolean;
}

export const ResourceRequirementsSection: React.FC<ResourceRequirementsSectionProps> = ({
  appointmentTypeId,
  isClinicAdmin,
}) => {
  const { alert } = useModal();
  const {
    resourceRequirements,
    loadingResourceRequirements,
    loadResourceRequirements,
    updateResourceRequirements,
  } = useServiceItemsStore();
  
  const [loading, setLoading] = useState(true);
  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedResourceTypeId, setSelectedResourceTypeId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [editingRequirementId, setEditingRequirementId] = useState<number | null>(null);
  const [editingQuantity, setEditingQuantity] = useState<number>(1);

  const requirements = (appointmentTypeId && resourceRequirements[appointmentTypeId]) || [];
  const isLoading = appointmentTypeId ? loadingResourceRequirements.has(appointmentTypeId) : false;

  useEffect(() => {
    loadData();
  }, [appointmentTypeId]);

  const loadData = async () => {
    try {
      setLoading(true);
      // Load resource types
      const resourceTypesResponse = await apiService.getResourceTypes();
      setResourceTypes(resourceTypesResponse.resource_types);
      
      // Load resource requirements from store
      await loadResourceRequirements(appointmentTypeId);
    } catch (err) {
      logger.error('Failed to load resource requirements:', err);
      await alert(getErrorMessage(err) || '載入資源需求失敗', '錯誤');
    } finally {
      setLoading(false);
    }
  };

  const handleAddRequirement = () => {
    if (!selectedResourceTypeId || quantity < 1) {
      alert('請選擇資源類型並輸入數量', '錯誤');
      return;
    }

    // Check if requirement already exists
    if (requirements.some(r => r.resource_type_id === selectedResourceTypeId)) {
      alert('此資源類型的需求已存在', '錯誤');
      return;
    }

    // Find resource type name
    const resourceType = resourceTypes.find(rt => rt.id === selectedResourceTypeId);
    const resourceTypeName = resourceType?.name || 'Unknown';

    // Create temporary requirement (will be saved when "儲存設定" is clicked)
    const newRequirement: ResourceRequirement = {
      id: -Date.now(), // Temporary negative ID
      appointment_type_id: appointmentTypeId,
      resource_type_id: selectedResourceTypeId,
      quantity,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resource_type_name: resourceTypeName,
    };

    // Update store (staged change, not saved yet)
    updateResourceRequirements(appointmentTypeId, [...requirements, newRequirement]);
    setShowAddForm(false);
    setSelectedResourceTypeId(null);
    setQuantity(1);
  };

  const handleUpdateRequirement = (requirementId: number) => {
    if (editingQuantity < 1) {
      alert('數量必須大於 0', '錯誤');
      return;
    }

    // Update in store (staged change, not saved yet)
    const updated = requirements.map(r => 
      r.id === requirementId 
        ? { ...r, quantity: editingQuantity, updated_at: new Date().toISOString() }
        : r
    );
    updateResourceRequirements(appointmentTypeId, updated);
    setEditingRequirementId(null);
  };

  const handleDeleteRequirement = (requirementId: number, resourceTypeName: string) => {
    if (!confirm(`確定要刪除「${resourceTypeName}」的資源需求嗎？`)) {
      return;
    }

    // Remove from store (staged change, not saved yet)
    const updated = requirements.filter(r => r.id !== requirementId);
    updateResourceRequirements(appointmentTypeId, updated);
  };

  if (loading || isLoading) {
    return <div className="text-sm text-gray-500">載入中...</div>;
  }

  const availableResourceTypes = resourceTypes.filter(
    rt => !requirements.some(r => r.resource_type_id === rt.id)
  );

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700">
          資源需求
        </label>
        <p className="text-xs text-gray-500 mt-1">
          設定此服務項目需要的資源類型和數量
        </p>
      </div>

      {/* Requirements List */}
      {requirements.length === 0 ? (
        <p className="text-sm text-gray-500 mb-3">尚無資源需求</p>
      ) : (
        <div className="space-y-2 mb-3">
          {requirements.map((req) => {
            const isEditing = editingRequirementId === req.id;

            return (
              <div
                key={req.id}
                className="flex items-center justify-between bg-gray-50 p-3 rounded border border-gray-200"
              >
                {isEditing ? (
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-sm text-gray-700">{req.resource_type_name}</span>
                    <span className="text-sm text-gray-500">需要</span>
                    <input
                      type="number"
                      value={editingQuantity}
                      onChange={(e) => setEditingQuantity(parseInt(e.target.value) || 1)}
                      min={1}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateRequirement(req.id);
                        }
                      }}
                      autoFocus
                    />
                    <span className="text-sm text-gray-500">個</span>
                    <button
                      type="button"
                      onClick={() => handleUpdateRequirement(req.id)}
                      className="text-xs text-blue-600 hover:text-blue-800 ml-2"
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingRequirementId(null);
                        setEditingQuantity(1);
                      }}
                      className="text-xs text-gray-600 hover:text-gray-800"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-900">{req.resource_type_name}</span>
                      <span className="text-sm text-gray-600 ml-2">需要 {req.quantity} 個</span>
                    </div>
                    {isClinicAdmin && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRequirementId(req.id);
                            setEditingQuantity(req.quantity);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          編輯
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRequirement(req.id, req.resource_type_name)}
                          className="text-xs text-red-600 hover:text-red-800"
                        >
                          刪除
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Requirement Form */}
      {isClinicAdmin && (
        <>
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              + 新增資源需求
            </button>
          ) : (
            <div className="bg-gray-50 p-3 rounded border border-gray-200 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={selectedResourceTypeId || ''}
                  onChange={(e) => setSelectedResourceTypeId(parseInt(e.target.value) || null)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">選擇資源類型</option>
                  {availableResourceTypes.map(rt => (
                    <option key={rt.id} value={rt.id}>{rt.name}</option>
                  ))}
                </select>
                <span className="text-sm text-gray-600">需要</span>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                  min={1}
                  className="w-20 px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-600">個</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAddRequirement}
                  disabled={!selectedResourceTypeId || quantity < 1}
                  className="btn-primary text-sm px-4 py-2"
                >
                  新增
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setSelectedResourceTypeId(null);
                    setQuantity(1);
                  }}
                  className="btn-secondary text-sm px-4 py-2"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

