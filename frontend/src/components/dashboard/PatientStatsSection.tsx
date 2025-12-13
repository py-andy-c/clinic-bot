import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { BaseModal } from '../shared/BaseModal';

interface MonthInfo {
  year: number;
  month: number;
  display_name: string;
  is_current: boolean;
}

interface MonthlyPatientStat {
  month: MonthInfo;
  count: number;
}

interface PatientStatsSectionProps {
  activePatients: MonthlyPatientStat[];
  newPatients: MonthlyPatientStat[];
}

export const PatientStatsSection: React.FC<PatientStatsSectionProps> = ({
  activePatients,
  newPatients,
}) => {
  const [showActivePatientsModal, setShowActivePatientsModal] = useState(false);

  // Transform data for Recharts
  const activePatientsData = useMemo(() => {
    return activePatients.map((stat) => ({
      name: stat.month.display_name,
      value: stat.count,
      isCurrent: stat.month.is_current,
    }));
  }, [activePatients]);

  const newPatientsData = useMemo(() => {
    return newPatients.map((stat) => ({
      name: stat.month.display_name,
      value: stat.count,
      isCurrent: stat.month.is_current,
    }));
  }, [newPatients]);

  // Calculate max value for scaling
  const maxActivePatients = Math.max(...activePatientsData.map((d) => d.value), 0);
  const maxNewPatients = Math.max(...newPatientsData.map((d) => d.value), 0);

  return (
    <div className="bg-white md:rounded-lg md:shadow-sm md:border md:border-gray-200 p-0 md:p-6 mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">病患統計</h2>

      {/* Active Patients Bar Chart */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <p className="text-sm font-medium text-gray-700">活躍病患</p>
          <button
            type="button"
            onClick={() => setShowActivePatientsModal(true)}
            className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
            aria-label="查看說明"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        <div className="w-full" style={{ height: '140px', minHeight: '140px' }}>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={activePatientsData} margin={{ top: 20, right: 10, left: 10, bottom: 0 }}>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: '#6B7280' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide domain={[0, maxActivePatients > 0 ? maxActivePatients : 1]} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                <LabelList
                  dataKey="value"
                  position="top"
                  style={{ fontSize: 12, fill: '#374151', fontWeight: 500 }}
                />
                {activePatientsData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.isCurrent ? '#DBEAFE' : '#2563EB'}
                    stroke={entry.isCurrent ? '#60A5FA' : undefined}
                    strokeWidth={entry.isCurrent ? 2 : 0}
                    strokeDasharray={entry.isCurrent ? '4 4' : undefined}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* New Patients Bar Chart */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-4">新增病患</p>
        <div className="w-full" style={{ height: '140px', minHeight: '140px' }}>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={newPatientsData} margin={{ top: 20, right: 10, left: 10, bottom: 0 }}>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: '#6B7280' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide domain={[0, maxNewPatients > 0 ? maxNewPatients : 1]} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                <LabelList
                  dataKey="value"
                  position="top"
                  style={{ fontSize: 12, fill: '#374151', fontWeight: 500 }}
                />
                {newPatientsData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.isCurrent ? '#D1FAE5' : '#059669'}
                    stroke={entry.isCurrent ? '#34D399' : undefined}
                    strokeWidth={entry.isCurrent ? 2 : 0}
                    strokeDasharray={entry.isCurrent ? '4 4' : undefined}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Active Patients Info Modal */}
      {showActivePatientsModal && (
        <BaseModal onClose={() => setShowActivePatientsModal(false)} aria-label="活躍病患說明">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">活躍病患</h3>
              <div className="text-sm text-gray-700 space-y-2">
                <p>該月有預約的病患（不含已取消的預約）</p>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowActivePatientsModal(false)}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                >
                  關閉
                </button>
              </div>
            </div>
          </div>
        </BaseModal>
      )}
    </div>
  );
};

