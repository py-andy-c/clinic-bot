import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, LabelList } from 'recharts';

interface MonthInfo {
  year: number;
  month: number;
  display_name: string;
  is_current: boolean;
}

interface MonthlyAppointmentStat {
  month: MonthInfo;
  count: number;
}

interface MonthlyCancellationStat {
  month: MonthInfo;
  canceled_by_clinic_count: number;
  canceled_by_clinic_percentage: number;
  canceled_by_patient_count: number;
  canceled_by_patient_percentage: number;
  total_canceled_count: number;
  total_cancellation_rate: number;
}

interface MonthlyAppointmentTypeStat {
  month: MonthInfo;
  appointment_type_id: number;
  appointment_type_name: string;
  count: number;
  percentage: number;
  is_deleted?: boolean;
}

interface MonthlyPractitionerStat {
  month: MonthInfo;
  user_id: number;
  practitioner_name: string;
  count: number;
  percentage: number;
  is_active?: boolean;
}

interface AppointmentStatsSectionProps {
  appointments: MonthlyAppointmentStat[];
  cancellations: MonthlyCancellationStat[];
  appointmentTypes: MonthlyAppointmentTypeStat[];
  practitioners: MonthlyPractitionerStat[];
}

export const AppointmentStatsSection: React.FC<AppointmentStatsSectionProps> = ({
  appointments,
  cancellations,
  appointmentTypes,
  practitioners,
}) => {
  // Transform data for Recharts
  const appointmentsData = useMemo(() => {
    return appointments.map((stat) => ({
      name: stat.month.display_name,
      value: stat.count,
      isCurrent: stat.month.is_current,
    }));
  }, [appointments]);

  const maxAppointments = Math.max(...appointmentsData.map((d) => d.value), 0);

  // Transform cancellation data for table
  const cancellationTableData = useMemo(() => {
    return [
      {
        label: '診所取消',
        data: cancellations.map((c) => ({
          count: c.canceled_by_clinic_count,
          percentage: c.canceled_by_clinic_percentage,
        })),
      },
      {
        label: '病患取消',
        data: cancellations.map((c) => ({
          count: c.canceled_by_patient_count,
          percentage: c.canceled_by_patient_percentage,
        })),
      },
      {
        label: '總取消率',
        data: cancellations.map((c) => ({
          count: c.total_canceled_count,
          percentage: c.total_cancellation_rate,
        })),
      },
    ];
  }, [cancellations]);

  // Transform appointment type data for table
  // Use months from cancellations to ensure all months are included, even if no appointments
  const appointmentTypeTableData = useMemo(() => {
    const typeMap = new Map<number, { 
      name: string; 
      is_deleted: boolean;
      data: Array<{ count: number; percentage: number }> 
    }>();
    // Use months from cancellations which always includes all months
    const months = cancellations.map((c) => c.month);

    // Initialize all appointment types with zero data for all months
    appointmentTypes.forEach((stat) => {
      if (!typeMap.has(stat.appointment_type_id)) {
        typeMap.set(stat.appointment_type_id, {
          name: stat.appointment_type_name,
          is_deleted: stat.is_deleted ?? false,
          data: months.map(() => ({ count: 0, percentage: 0 })),
        });
      }
    });

    // Fill in actual data
    appointmentTypes.forEach((stat) => {
      const monthIndex = months.findIndex(
        (m) => m.year === stat.month.year && m.month === stat.month.month
      );
      if (monthIndex >= 0) {
        const typeData = typeMap.get(stat.appointment_type_id);
        if (typeData) {
          typeData.data[monthIndex] = {
            count: stat.count,
            percentage: stat.percentage,
          };
        }
      }
    });

    return Array.from(typeMap.values());
  }, [appointmentTypes, cancellations]);

  // Transform practitioner data for table
  // Use months from cancellations to ensure all months are included, even if no appointments
  const practitionerTableData = useMemo(() => {
    const practitionerMap = new Map<
      number,
      { name: string; is_active: boolean; data: Array<{ count: number; percentage: number }> }
    >();
    // Use months from cancellations which always includes all months
    const months = cancellations.map((c) => c.month);

    // Initialize all practitioners with zero data for all months
    practitioners.forEach((stat) => {
      if (!practitionerMap.has(stat.user_id)) {
        practitionerMap.set(stat.user_id, {
          name: stat.practitioner_name,
          is_active: stat.is_active ?? true,
          data: months.map(() => ({ count: 0, percentage: 0 })),
        });
      }
    });

    // Fill in actual data
    practitioners.forEach((stat) => {
      const monthIndex = months.findIndex(
        (m) => m.year === stat.month.year && m.month === stat.month.month
      );
      if (monthIndex >= 0) {
        const practitionerData = practitionerMap.get(stat.user_id);
        if (practitionerData) {
          practitionerData.data[monthIndex] = {
            count: stat.count,
            percentage: stat.percentage,
          };
        }
      }
    });

    return Array.from(practitionerMap.values());
  }, [practitioners, cancellations]);

  const months = cancellations.map((c) => c.month);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">預約統計</h2>

      {/* Appointments Bar Chart */}
      <div className="mb-6">
        <p className="text-sm font-medium text-gray-700 mb-4">本月預約數（不含已取消）</p>
        <div style={{ height: '140px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={appointmentsData} margin={{ top: 20, right: 10, left: 10, bottom: 0 }}>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: '#6B7280' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide domain={[0, maxAppointments > 0 ? maxAppointments : 1]} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                <LabelList
                  dataKey="value"
                  position="top"
                  style={{ fontSize: 12, fill: '#374151', fontWeight: 500 }}
                />
                {appointmentsData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.isCurrent ? '#E9D5FF' : '#9333EA'}
                    stroke={entry.isCurrent ? '#C084FC' : undefined}
                    strokeWidth={entry.isCurrent ? 2 : 0}
                    strokeDasharray={entry.isCurrent ? '4 4' : undefined}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cancellation Rate Table */}
      <div className="mb-6 overflow-x-auto">
        <p className="text-sm font-medium text-gray-700 mb-4">取消率</p>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap z-10">
                  取消類型
                </th>
                {months.map((month) => (
                  <th
                    key={`${month.year}-${month.month}`}
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {month.display_name}
                    {month.is_current && (
                      <span className="block text-blue-600 text-xs">(當月)</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {cancellationTableData.map((row, idx) => (
                <tr key={idx}>
                  <td className="sticky left-0 bg-white px-4 py-3 text-sm text-gray-900 whitespace-nowrap z-10">
                    {row.label}
                  </td>
                  {row.data.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className="px-4 py-3 text-sm text-gray-900 text-center whitespace-nowrap"
                    >
                      {cell.count}({Math.round(cell.percentage)}%)
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Appointment Type Stats Table */}
      <div className="mb-6 overflow-x-auto">
        <p className="text-sm font-medium text-gray-700 mb-4">預約類型統計</p>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap z-10">
                  預約類型
                </th>
                {months.map((month) => (
                  <th
                    key={`${month.year}-${month.month}`}
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {month.display_name}
                    {month.is_current && (
                      <span className="block text-blue-600 text-xs">(當月)</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {appointmentTypeTableData.map((row, idx) => (
                <tr 
                  key={idx}
                  className={row.is_deleted ? 'opacity-60' : ''}
                >
                  <td className={`sticky left-0 px-4 py-3 text-sm whitespace-nowrap z-10 ${
                    row.is_deleted ? 'bg-gray-50 text-gray-500' : 'bg-white text-gray-900'
                  }`}>
                    {row.name}{row.is_deleted && <span className="ml-2 text-xs text-gray-400">(已刪除)</span>}
                  </td>
                  {row.data.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className={`px-4 py-3 text-sm text-center whitespace-nowrap ${
                        row.is_deleted ? 'text-gray-500' : 'text-gray-900'
                      }`}
                    >
                      {cell.count}({Math.round(cell.percentage)}%)
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Practitioner Stats Table */}
      <div className="overflow-x-auto">
        <p className="text-sm font-medium text-gray-700 mb-4">治療師預約統計</p>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap z-10">
                  治療師
                </th>
                {months.map((month) => (
                  <th
                    key={`${month.year}-${month.month}`}
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {month.display_name}
                    {month.is_current && (
                      <span className="block text-blue-600 text-xs">(當月)</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {practitionerTableData.map((row, idx) => (
                <tr 
                  key={idx}
                  className={!row.is_active ? 'opacity-60' : ''}
                >
                  <td className={`sticky left-0 px-4 py-3 text-sm whitespace-nowrap z-10 ${
                    !row.is_active ? 'bg-gray-50 text-gray-500' : 'bg-white text-gray-900'
                  }`}>
                    {row.name}{!row.is_active && <span className="ml-2 text-xs text-gray-400">(已停用)</span>}
                  </td>
                  {row.data.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className={`px-4 py-3 text-sm text-center whitespace-nowrap ${
                        !row.is_active ? 'text-gray-500' : 'text-gray-900'
                      }`}
                    >
                      {cell.count}({Math.round(cell.percentage)}%)
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

