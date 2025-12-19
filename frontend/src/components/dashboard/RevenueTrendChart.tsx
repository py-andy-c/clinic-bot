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

  // Match backend logic: daily <= 31, weekly <= 130, monthly > 130
  if (days <= 31) return 'daily';
  if (days <= 130) return 'weekly';
  return 'monthly';
}

// Format label for x-axis (simple, compact)
function formatAxisLabel(date: string, granularity: Granularity): string {
  const m = moment(date);
  switch (granularity) {
    case 'daily':
      return `${m.date()}日`;
    case 'weekly':
      // Just show start date on x-axis: "10/7"
      return m.format('M/D');
    case 'monthly':
      return `${m.month() + 1}月`;
  }
}

// Format label for tooltip (detailed, full date range)
function formatTooltipLabel(date: string, granularity: Granularity): string {
  const m = moment(date);
  switch (granularity) {
    case 'daily':
      return m.format('M/D');
    case 'weekly':
      // Show full date range in tooltip using m/d format
      const weekStart = m.clone(); // Already Monday from backend
      const weekEnd = weekStart.clone().endOf('isoWeek'); // Sunday
      
      // If week spans two months: "10/28-11/3"
      if (weekStart.month() !== weekEnd.month()) {
        return `${weekStart.format('M/D')}-${weekEnd.format('M/D')}`;
      }
      // Same month: "10/7-13"
      return `${weekStart.format('M/D')}-${weekEnd.format('D')}`;
    case 'monthly':
      return m.format('M月');
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
        label: formatAxisLabel(point.date, granularity), // For x-axis (simple)
        tooltipLabel: formatTooltipLabel(point.date, granularity), // For tooltip (detailed)
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
      const result: any = { 
        date: point.date, 
        label: point.label, // For x-axis
        tooltipLabel: point.tooltipLabel // For tooltip
      };
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
                  labelFormatter={(label, payload) => {
                    // Use tooltipLabel if available, otherwise fall back to label
                    const dataPoint = payload?.[0]?.payload;
                    return dataPoint?.tooltipLabel || label;
                  }}
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
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  
                  // Use tooltipLabel if available, otherwise fall back to label
                  const dataPoint = payload[0]?.payload;
                  const displayLabel = dataPoint?.tooltipLabel || label;
                  
                  return (
                    <div className="bg-white border border-gray-200 rounded-md p-3 shadow-lg">
                      <p className="text-sm font-medium text-gray-900 mb-2">{displayLabel}</p>
                      <div className="space-y-1">
                        {payload.map((entry: any, index: number) => {
                          const dataKey = entry.dataKey || entry.name;
                          const displayName = view === 'stacked-service'
                            ? serviceNames[dataKey] || dataKey
                            : practitionerNames[dataKey] || dataKey;
                          // Get original (unstacked) value from the data point
                          const originalValue = entry.payload?.[`${dataKey}_original`] ?? entry.value ?? 0;
                          
                          return (
                            <div key={index} className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded"
                                style={{ backgroundColor: entry.color }}
                              />
                              <span className="text-sm text-gray-700">{displayName}:</span>
                              <span className="text-sm font-medium text-gray-900">
                                {formatCurrency(originalValue)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }}
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
