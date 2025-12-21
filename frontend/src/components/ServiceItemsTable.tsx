import React from 'react';
import { AppointmentType, ServiceTypeGroup } from '../types';
import { formatCurrency } from '../utils/currencyUtils';
import { useIsMobile } from '../hooks/useIsMobile';

interface ServiceItemsTableProps {
  appointmentTypes: AppointmentType[];
  groups: ServiceTypeGroup[];
  practitionerAssignments: Record<number, number[]>; // appointmentTypeId -> practitionerIds[]
  billingScenarios: Record<string, any[]>; // key: `${appointmentTypeId}-${practitionerId}`
  onEdit: (appointmentType: AppointmentType) => void;
  onDelete: (appointmentType: AppointmentType, index: number) => void;
  isClinicAdmin: boolean;
}

export const ServiceItemsTable: React.FC<ServiceItemsTableProps> = ({
  appointmentTypes,
  groups,
  practitionerAssignments,
  billingScenarios,
  onEdit,
  onDelete,
  isClinicAdmin,
}) => {
  const isMobile = useIsMobile();

  const getGroupName = (groupId: number | null | undefined): string => {
    if (!groupId) return '未分類';
    const group = groups.find(g => g.id === groupId);
    return group?.name || '未分類';
  };

  const getPriceDisplay = (appointmentType: AppointmentType): string => {
    const practitionerIds = practitionerAssignments[appointmentType.id] || [];
    if (practitionerIds.length === 0) return '-';

    // Get all default scenarios for this service
    const defaultScenarios: number[] = [];
    practitionerIds.forEach(practitionerId => {
      const key = `${appointmentType.id}-${practitionerId}`;
      const scenarios = billingScenarios[key] || [];
      const defaultScenario = scenarios.find((s: any) => s.is_default);
      if (defaultScenario) {
        defaultScenarios.push(defaultScenario.amount);
      }
    });

    if (defaultScenarios.length === 0) return '-';

    // Show range if prices differ, otherwise show single price
    const minPrice = Math.min(...defaultScenarios);
    const maxPrice = Math.max(...defaultScenarios);
    
    if (minPrice === maxPrice) {
      return formatCurrency(minPrice);
    }
    return `${formatCurrency(minPrice)} - ${formatCurrency(maxPrice)}`;
  };

  const formatDuration = (duration: number, buffer?: number): string => {
    if (buffer && buffer > 0) {
      return `${duration} 分 (+${buffer} 分)`;
    }
    return `${duration} 分`;
  };

  if (isMobile) {
    // Mobile: Card list view
    return (
      <div className="space-y-3">
        {appointmentTypes.map((appointmentType, index) => {
          const groupName = getGroupName(appointmentType.service_type_group_id);
          const practitionerCount = practitionerAssignments[appointmentType.id]?.length || 0;
          const price = getPriceDisplay(appointmentType);

          return (
            <div
              key={appointmentType.id}
              className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-gray-900 text-sm">
                      {appointmentType.name || '未命名服務項目'}
                    </h3>
                    {appointmentType.service_type_group_id && (
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                        {groupName}
                      </span>
                    )}
                    {appointmentType.allow_patient_booking === false && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        不開放預約
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>時長: {formatDuration(appointmentType.duration_minutes, appointmentType.scheduling_buffer_minutes)}</span>
                    <span>•</span>
                    <span>{practitionerCount} 位治療師</span>
                    {price !== '-' && (
                      <>
                        <span>•</span>
                        <span className="font-medium text-gray-700">{price}</span>
                      </>
                    )}
                  </div>
                </div>
                {isClinicAdmin && (
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      type="button"
                      onClick={() => onEdit(appointmentType)}
                      className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1.5 rounded border border-blue-200 hover:border-blue-300"
                    >
                      編輯
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(appointmentType, index)}
                      className="text-red-600 hover:text-red-800 text-sm px-3 py-1.5 rounded border border-red-200 hover:border-red-300"
                    >
                      刪除
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Desktop: Table view
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              服務項目
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              群組
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              時長 (緩衝)
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              治療師
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              價格
            </th>
            {isClinicAdmin && (
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                操作
              </th>
            )}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {appointmentTypes.map((appointmentType, index) => {
            const groupName = getGroupName(appointmentType.service_type_group_id);
            const practitionerCount = practitionerAssignments[appointmentType.id]?.length || 0;
            const price = getPriceDisplay(appointmentType);

            return (
              <tr key={appointmentType.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {appointmentType.name || '未命名服務項目'}
                    </span>
                    {appointmentType.allow_patient_booking === false && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        不開放預約
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {appointmentType.service_type_group_id ? (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                      {groupName}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500">未分類</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatDuration(appointmentType.duration_minutes, appointmentType.scheduling_buffer_minutes)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {practitionerCount} 位
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {price}
                </td>
                {isClinicAdmin && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onEdit(appointmentType)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        編輯
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(appointmentType, index)}
                        className="text-red-600 hover:text-red-900"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

