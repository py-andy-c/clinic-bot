import React from 'react';
import { AppointmentType, ServiceTypeGroup } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';

interface ServiceItemsTableProps {
  appointmentTypes: AppointmentType[];
  groups: ServiceTypeGroup[];
  practitionerAssignments: Record<number, number[]>; // appointmentTypeId -> practitionerIds[]
  onEdit: (appointmentType: AppointmentType) => void;
  isClinicAdmin: boolean;
}

export const ServiceItemsTable: React.FC<ServiceItemsTableProps> = ({
  appointmentTypes,
  groups,
  practitionerAssignments,
  onEdit,
  isClinicAdmin,
}) => {
  const isMobile = useIsMobile();

  const getGroupName = (groupId: number | null | undefined): string => {
    if (!groupId) return '未分類';
    const group = groups.find(g => g.id === groupId);
    return group?.name || '未分類';
  };

  const formatDuration = (duration: number, buffer?: number): string => {
    if (buffer && buffer > 0) {
      return `${duration} (+${buffer}) 分`;
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
                  </div>
                </div>
                {isClinicAdmin && (
                  <button
                    type="button"
                    onClick={() => onEdit(appointmentType)}
                    className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1.5 rounded border border-blue-200 hover:border-blue-300"
                  >
                    編輯
                  </button>
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
                {isClinicAdmin && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      type="button"
                      onClick={() => onEdit(appointmentType)}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      編輯
                    </button>
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

