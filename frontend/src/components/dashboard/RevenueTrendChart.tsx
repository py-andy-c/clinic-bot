import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid } from 'recharts';
import moment from 'moment-timezone';
import { formatCurrency } from '../../utils/currencyUtils';

export type ChartView = 'total' | 'stacked-service' | 'stacked-practitioner';

export interface RevenueDataPoint {
  date: string; // YYYY-MM-DD
  total?: number;
  byService?: Record<string, number>;
  byPractitioner?: Record<string, number>;
}

export interface RevenueTrendChartProps {
  data: RevenueDataPoint[];
  view: ChartView;
  startDate: string;
  endDate: string;
  serviceNames?: Record<string, string>;
  practitionerNames?: Record<string, string>;
}

type Granularity = 'daily' | 'weekly' | 'monthly';

function getGranularity(startDate: string, endDate: string): Granularity {
  const start = moment(startDate);
  const end = moment(endDate);
  const days = end.diff(start, 'days') + 1;

  if (days <= 31) return 'daily';
  if (days <= 90) return 'weekly';
  return 'monthly';
}

function formatDateLabel(date: string, granularity: Granularity): string {
  const m = moment(date);
  switch (granularity) {
    case 'daily':
      return `${m.date()}日`;
    case 'weekly':
      // Calculate week start (Monday) and end (Sunday)
      const weekStart = m.clone().startOf('isoWeek'); // Monday
      const weekEnd = m.clone().endOf('isoWeek'); // Sunday
      return `${weekStart.format('MM/DD')}-${weekEnd.format('MM/DD')}`;
    case 'monthly':
      return `${m.month() + 1}月`;
  }
}

function getGranularityLabel(granularity: Granularity): string {
  switch (granularity) {
    case 'daily':
      return '每日';
    case 'weekly':
      return '每週';
    case 'monthly':
      return '每月';
  }
}

export const RevenueTrendChart: React.FC<RevenueTrendChartProps> = ({
  data,
  view,
  startDate,
  endDate,
  serviceNames = {},
  practitionerNames = {},
}) => {
  const granularity = useMemo(() => getGranularity(startDate, endDate), [startDate, endDate]);

  const chartData = useMemo(() => {
    return data.map((point) => {
      const base = {
        date: point.date,
        label: formatDateLabel(point.date, granularity),
      };
      if (view === 'total') {
        return { ...base, total: point.total || 0 };
      }
      if (view === 'stacked-service') {
        return { ...base, ...(point.byService || {}) };
      }
      return { ...base, ...(point.byPractitioner || {}) };
    });
  }, [data, view, granularity]);

  const colors = {
    service: ['#2563eb', '#10b981', '#f59e0b', '#9ca3af'], // blue, green, yellow, gray
    practitioner: ['#2563eb', '#10b981', '#f59e0b', '#9ca3af'],
  };

  // Prepare stacked data - Recharts' stackId handles stacking automatically
  // This must be called before any early returns to maintain hook order
  const keys = view === 'stacked-service'
    ? Object.keys(serviceNames)
    : Object.keys(practitionerNames);
  const colorPalette = view === 'stacked-service' ? colors.service : colors.practitioner;

  const stackedData = useMemo(() => {
    if (view === 'total') {
      // Return empty array for total view (not used, but maintains hook order)
      return [];
    }
    // Recharts' stackId automatically handles stacking, so we use raw values
    return chartData.map((point) => {
      const result: any = { date: point.date, label: point.label };
      keys.forEach((key) => {
        let value = 0;
        if (view === 'stacked-service') {
          // For stacked-service, the point already has the byService keys spread into it
          value = (point as any)[key] || 0;
        } else if (view === 'stacked-practitioner') {
          // For stacked-practitioner, the point already has the byPractitioner keys spread into it
          value = (point as any)[key] || 0;
        }
        // Use raw values - Recharts' stackId will handle stacking automatically
        result[key] = value;
        // Store original value for tooltip (same as raw value in this case)
        result[`${key}_original`] = value;
      });
      return result;
    });
  }, [chartData, keys, view]);

  if (view === 'total') {
    return (
      <div>
        <div className="mb-2 text-xs md:text-sm text-gray-500">
          顯示方式：{getGranularityLabel(granularity)}
        </div>
        <div className="overflow-x-auto -mx-3 md:mx-0 px-3 md:px-0">
          <div className="h-64" style={{ minWidth: '600px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }} barCategoryGap={0}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => {
                    if (value >= 1000) {
                      return `$${value / 1000}k`;
                    }
                    return `$${value}`;
                  }}
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  labelStyle={{ color: '#374151', fontWeight: 500 }}
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '0.375rem' }}
                />
                <Bar
                  dataKey="total"
                  fill="#2563eb"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 text-xs md:text-sm text-gray-500">
        顯示方式：{getGranularityLabel(granularity)}
      </div>
      <div className="overflow-x-auto -mx-3 md:mx-0 px-3 md:px-0">
        <div className="h-64" style={{ minWidth: '600px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stackedData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }} barCategoryGap={0}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: '#6B7280' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: '#6B7280' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => {
                  if (value >= 1000) {
                    return `$${value / 1000}k`;
                  }
                  return `$${value}`;
                }}
              />
              <Tooltip
                formatter={(value: number, name: string, props: any) => {
                  // Get original value (not stacked) from the data point
                  const dataIndex = props.payload?.dataIndex;
                  if (dataIndex !== undefined && stackedData[dataIndex]) {
                    const originalValue = stackedData[dataIndex][`${name}_original`] || 0;
                    const label = view === 'stacked-service'
                      ? serviceNames[name] || name
                      : practitionerNames[name] || name;
                    return [formatCurrency(originalValue), label];
                  }
                  return [formatCurrency(value), name];
                }}
                labelStyle={{ color: '#374151', fontWeight: 500 }}
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '0.375rem' }}
              />
              <Legend
                wrapperStyle={{ paddingTop: '10px' }}
                formatter={(value: string) => {
                  return view === 'stacked-service'
                    ? serviceNames[value] || value
                    : practitionerNames[value] || value;
                }}
              />
              {keys.map((key, index) => {
                const color = colorPalette[index % colorPalette.length] || '#2563eb';
                return (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="1"
                    fill={color}
                  />
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
