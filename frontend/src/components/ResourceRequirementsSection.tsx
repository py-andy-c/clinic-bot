import React, { useState } from 'react';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { ResourceRequirementBundleData } from '../types';
import { apiService } from '../services/api';
import { useModal } from '../contexts/ModalContext';
import { useNumberInput } from '../hooks/useNumberInput';
import { preventScrollWheelChange } from '../utils/inputUtils';

interface ResourceRequirementField extends Omit<ResourceRequirementBundleData, 'id'> {
  id: string; // Internal ID for useFieldArray
}

interface ResourceRequirementsSectionProps {
  isClinicAdmin: boolean;
  disabled?: boolean;
}

export const ResourceRequirementsSection: React.FC<ResourceRequirementsSectionProps> = ({
  isClinicAdmin,
  disabled = false,
}) => {
  const { control } = useFormContext();
  const { fields, append, remove, update } = useFieldArray({
    control,
    name: 'resource_requirements',
  });

  const { alert } = useModal();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedResourceTypeId, setSelectedResourceTypeId] = useState<number | ''>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingQuantity, setEditingQuantity] = useState<number>(1);

  const { data: resourceTypes = [], isLoading: loadingResourceTypes } = useQuery({
    queryKey: ['settings', 'resource-types'],
    queryFn: async () => {
      const resp = await apiService.getResourceTypes();
      return resp.resource_types;
    },
  });

  // Number input hooks for proper UX
  const quantityInput = useNumberInput(
    quantity,
    setQuantity,
    { fallback: 1, parseFn: 'parseInt', min: 1 }
  );

  const editingQuantityInput = useNumberInput(
    editingQuantity,
    setEditingQuantity,
    { fallback: 1, parseFn: 'parseInt', min: 1 }
  );

  const handleAddRequirement = () => {
    if (!selectedResourceTypeId || quantity < 1) {
      alert('請選擇資源類型並輸入有效數量（必須大於 0）', '錯誤');
      return;
    }

    if (fields.some(r => (r as ResourceRequirementField).resource_type_id === selectedResourceTypeId)) {
      alert('此資源類型的需求已存在', '錯誤');
      return;
    }

    const selectedType = resourceTypes.find(rt => rt.id === selectedResourceTypeId);

    append({
      resource_type_id: selectedResourceTypeId,
      resource_type_name: selectedType?.name || '未知資源',
      quantity: quantity,
    });

    setShowAddForm(false);
    setSelectedResourceTypeId('');
    setQuantity(1);
  };

  const handleUpdateRequirement = (index: number) => {
    if (editingQuantity < 1) {
      alert('數量必須大於 0', '錯誤');
      return;
    }

    const field = fields[index] as ResourceRequirementField;
    update(index, {
      ...field,
      quantity: editingQuantity,
    });
    setEditingIndex(null);
  };

  if (loadingResourceTypes) {
    return <div className="text-sm text-gray-500">載入中...</div>;
  }

  const availableResourceTypes = resourceTypes.filter(
    rt => !fields.some(r => (r as ResourceRequirementField).resource_type_id === rt.id)
  );

  return (
    <div>
      {fields.length === 0 ? (
        <p className="text-sm text-gray-500 mb-3">尚無資源需求</p>
      ) : (
        <div className="space-y-2 mb-3">
          {fields.map((field, index) => {
            const req = field as ResourceRequirementField;
            const isEditing = editingIndex === index;

            return (
              <div
                key={field.id}
                className="flex items-center justify-between bg-gray-50 p-3 rounded border border-gray-200"
              >
                {isEditing ? (
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-sm text-gray-700">{req.resource_type_name}</span>
                    <span className="text-sm text-gray-500">需要</span>
                    <input
                      type="number"
                      value={editingQuantityInput.displayValue}
                      onChange={editingQuantityInput.onChange}
                      onBlur={editingQuantityInput.onBlur}
                      onWheel={preventScrollWheelChange}
                      min={1}
                      step="1"
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateRequirement(index);
                        }
                      }}
                      autoFocus
                    />
                    <span className="text-sm text-gray-500">個</span>
                    <button
                      type="button"
                      onClick={() => handleUpdateRequirement(index)}
                      className="text-xs text-blue-600 hover:text-blue-800 ml-2"
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingIndex(null);
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
                    {isClinicAdmin && !disabled && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingIndex(index);
                            setEditingQuantity(req.quantity);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          編輯
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(index)}
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

      {isClinicAdmin && !disabled && (
        <>
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400"
              disabled={disabled}
            >
              + 新增資源需求
            </button>
          ) : (
            <div className="bg-gray-50 p-3 rounded border border-gray-200 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={selectedResourceTypeId || ''}
                  onChange={(e) => setSelectedResourceTypeId(parseInt(e.target.value) || '')}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">選擇資源類型</option>
                  {availableResourceTypes.map(rt => (
                    <option key={rt.id} value={rt.id}>{rt.name}</option>
                  ))}
                </select>
                <span className="text-sm text-gray-600">需要</span>
                <input
                  type="number"
                  value={quantityInput.displayValue}
                  onChange={quantityInput.onChange}
                  onBlur={quantityInput.onBlur}
                  onWheel={preventScrollWheelChange}
                  min={1}
                  step="1"
                  className="w-20 px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <span className="text-sm text-gray-600">個</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAddRequirement}
                  disabled={!selectedResourceTypeId || quantity < 1}
                  className="bg-blue-600 text-white rounded-md text-sm px-4 py-2 hover:bg-blue-700 disabled:bg-gray-400"
                >
                  新增
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setSelectedResourceTypeId('');
                    setQuantity(1);
                  }}
                  className="bg-white text-gray-700 border border-gray-300 rounded-md text-sm px-4 py-2 hover:bg-gray-50"
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
