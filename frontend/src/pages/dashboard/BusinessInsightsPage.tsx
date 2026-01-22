import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment-timezone';
import { useMembers, useClinicSettings, useBusinessInsights, useServiceTypeGroups } from '../../hooks/queries';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { InfoButton, InfoModal } from '../../components/shared';
import { RevenueTrendChart, ChartView } from '../../components/dashboard/RevenueTrendChart';
import { TimeRangePreset, getDateRangeForPreset, detectPresetFromDates } from '../../components/dashboard/TimeRangePresets';
import { PractitionerOption, ServiceItemOption, ServiceTypeGroupOption } from '../../components/dashboard/FilterDropdown';
import { DashboardFilters } from '../../components/dashboard/DashboardFilters';
import { formatCurrency } from '../../utils/currencyUtils';
import { useAuth } from '../../hooks/useAuth';
import DashboardBackButton from '../../components/DashboardBackButton';

import { AppointmentType } from '../../types';
import {
  filterAppointmentTypesByGroup,
  shouldShowCustomItems,
  appointmentTypesToServiceItemOptions,
} from '../../utils/dashboardServiceItems';

const BusinessInsightsPage: React.FC = () => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id ?? null;
  
  // Active filter state (used for API calls)
  const [startDate, setStartDate] = useState<string>(moment().tz('Asia/Taipei').startOf('month').format('YYYY-MM-DD'));
  const [endDate, setEndDate] = useState<string>(moment().tz('Asia/Taipei').endOf('month').format('YYYY-MM-DD'));
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | string | null>(null);
  const [selectedServiceItemId, setSelectedServiceItemId] = useState<number | string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | string | null>(null);
  
  // Pending filter state (for UI inputs, not applied until button clicked)
  const [pendingStartDate, setPendingStartDate] = useState<string>(moment().tz('Asia/Taipei').startOf('month').format('YYYY-MM-DD'));
  const [pendingEndDate, setPendingEndDate] = useState<string>(moment().tz('Asia/Taipei').endOf('month').format('YYYY-MM-DD'));
  const [pendingPractitionerId, setPendingPractitionerId] = useState<number | string | null>(null);
  const [pendingServiceItemId, setPendingServiceItemId] = useState<number | string | null>(null);
  const [pendingGroupId, setPendingGroupId] = useState<number | string | null>(null);
  
  // Reset filters to default when clinic changes
  useEffect(() => {
    const defaultStartDate = moment().tz('Asia/Taipei').startOf('month').format('YYYY-MM-DD');
    const defaultEndDate = moment().tz('Asia/Taipei').endOf('month').format('YYYY-MM-DD');
    
    setStartDate(defaultStartDate);
    setEndDate(defaultEndDate);
    setSelectedPractitionerId(null);
    setSelectedServiceItemId(null);
    setSelectedGroupId(null);
    setPendingStartDate(defaultStartDate);
    setPendingEndDate(defaultEndDate);
    setPendingPractitionerId(null);
    setPendingServiceItemId(null);
    setPendingGroupId(null);
  }, [activeClinicId]);
  
  const [chartView, setChartView] = useState<ChartView>('total');
  const [showPageInfoModal, setShowPageInfoModal] = useState(false);
  const [showMetricModals, setShowMetricModals] = useState({
    revenue: false,
    receiptCount: false,
    serviceItemCount: false,
    activePatients: false,
    avgTransaction: false,
  });

  // Load practitioners and service items
  const { data: membersData } = useMembers();
  const { data: settingsData } = useClinicSettings();
  const { data: groupsData } = useServiceTypeGroups();

  const groups = useMemo<ServiceTypeGroupOption[]>(() => {
    if (!groupsData?.groups) return [];
    return groupsData.groups
      .sort((a, b) => a.display_order - b.display_order)
      .map(g => ({ id: g.id, name: g.name }));
  }, [groupsData]);

  // Check if clinic has groups configured
  const hasGroups = groups.length > 0;

  // Clear group filter when groups become empty (clinic doesn't use grouping)
  useEffect(() => {
    if (!hasGroups) {
      setSelectedGroupId(null);
      setPendingGroupId(null);
      setSelectedServiceItemId(null);
      setPendingServiceItemId(null);
    }
  }, [hasGroups]);

  const practitioners = useMemo<PractitionerOption[]>(() => {
    if (!membersData || !Array.isArray(membersData)) return [];
    return membersData
      .filter(m => m.roles.includes('practitioner'))
      .map(m => ({ id: m.id, full_name: m.full_name }));
  }, [membersData]);

  // Fetch business insights data for custom items extraction (unfiltered by service_item_id and practitioner_id)
  // This ensures all custom items and null practitioners always appear in the dropdown, even when filtering
  // Fetch unfiltered data for custom items extraction
  const customItemsParams = {
    start_date: startDate,
    end_date: endDate,
    practitioner_id: null, // Always fetch without practitioner_id filter to get all practitioners (including null)
    service_item_id: null, // Always fetch without service_item_id filter to get all custom items
  };
  const { data: customItemsData } = useBusinessInsights(customItemsParams);

  // Fetch filtered data for display
  const businessInsightsParams: {
    start_date: string;
    end_date: string;
    practitioner_id?: number | 'null' | null;
    service_item_id?: number | string | null;
    service_type_group_id?: number | string | null;
  } = {
    start_date: startDate,
    end_date: endDate,
  };

  if (typeof selectedPractitionerId === 'number') {
    businessInsightsParams.practitioner_id = selectedPractitionerId;
  } else if (selectedPractitionerId === 'null') {
    businessInsightsParams.practitioner_id = 'null';
  } else {
    businessInsightsParams.practitioner_id = null;
  }

  if (selectedServiceItemId) {
    businessInsightsParams.service_item_id = selectedServiceItemId;
  }

  if (typeof selectedGroupId === 'number') {
    businessInsightsParams.service_type_group_id = selectedGroupId;
  } else if (selectedGroupId === '-1') {
    businessInsightsParams.service_type_group_id = '-1';
  } else {
    businessInsightsParams.service_type_group_id = null;
  }
  const { data, isLoading: loading, error } = useBusinessInsights(businessInsightsParams);

  // Helper function to generate a consistent numeric ID from a string
  const stringToId = (str: string): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Use negative numbers to avoid conflicts with real IDs
    return hash < 0 ? hash : -hash;
  };

  const serviceItems = useMemo<ServiceItemOption[]>(() => {
    const predefinedItems: ServiceItemOption[] = [];
    if (settingsData?.appointment_types) {
      // Filter by group if a group is selected
      const filteredAppointmentTypes = filterAppointmentTypesByGroup(
        settingsData.appointment_types,
        pendingGroupId,
        hasGroups
      );
      
      predefinedItems.push(...appointmentTypesToServiceItemOptions(filteredAppointmentTypes));
    }

    // Extract custom items from unfiltered business insights data
    // Use customItemsData (unfiltered) instead of data (filtered) to ensure all custom items
    // always appear in the dropdown, even when a service_item_id filter is applied
    const customItemsMap = new Map<string, ServiceItemOption>();
    
    if (shouldShowCustomItems(hasGroups, pendingGroupId) && customItemsData?.by_service) {
      customItemsData.by_service.forEach(item => {
        if (item.is_custom && item.receipt_name) {
          // Use receipt_name as the key to avoid duplicates
          if (!customItemsMap.has(item.receipt_name)) {
            customItemsMap.set(item.receipt_name, {
              id: stringToId(item.receipt_name),
              name: item.receipt_name,
              receipt_name: item.receipt_name,
              is_custom: true,
            });
          }
        }
      });
    }

    // Combine predefined and custom items
    // Note: Custom items are only shown when appropriate (ungrouped or no groups)
    return [...predefinedItems, ...Array.from(customItemsMap.values())];
  }, [settingsData, customItemsData?.by_service, pendingGroupId, hasGroups]);

  const standardServiceItemIds = useMemo(() => {
    return new Set(serviceItems.filter(si => !si.is_custom).map(si => si.id));
  }, [serviceItems]);

  // Map service_item_id to name from appointment_types for display
  const serviceItemIdToName = useMemo(() => {
    const map = new Map<number, string>();
    if (settingsData?.appointment_types) {
      settingsData.appointment_types.forEach((at: AppointmentType) => {
        map.set(at.id, at.name);
      });
    }
    return map;
  }, [settingsData]);

  const handleTimeRangePreset = (preset: TimeRangePreset) => {
    const { startDate: newStartDate, endDate: newEndDate } = getDateRangeForPreset(preset);
    // Auto-apply preset: update both pending and active dates immediately
    setPendingStartDate(newStartDate);
    setPendingEndDate(newEndDate);
    setStartDate(newStartDate);
    setEndDate(newEndDate);
  };

  const handleApplyFilters = () => {
    // Apply pending filters to active filters (triggers API call via dependencies)
    setStartDate(pendingStartDate);
    setEndDate(pendingEndDate);
    setSelectedPractitionerId(pendingPractitionerId);
    setSelectedServiceItemId(pendingServiceItemId);
    setSelectedGroupId(pendingGroupId);
    // Clear service filter when group is cleared (only if grouping is enabled)
    if (hasGroups && !pendingGroupId) {
      setPendingServiceItemId(null);
      setSelectedServiceItemId(null);
    }
  };

  // Prepare service names and practitioner names for chart
  // These hooks must be called unconditionally (before any early returns)
  const serviceNames = useMemo(() => {
    if (!data?.by_service) return {};
    const names: Record<string, string> = {};
    data.by_service.forEach(item => {
      const key = item.is_custom ? `custom:${item.receipt_name}` : String(item.service_item_id);
      // Use name for standard items, receipt_name for custom items
      names[key] = item.is_custom 
        ? item.receipt_name 
        : (serviceItemIdToName.get(item.service_item_id!) || item.service_item_name);
    });
    return names;
  }, [data?.by_service, serviceItemIdToName]);

  const practitionerNames = useMemo(() => {
    if (!data?.by_practitioner) return {};
    const names: Record<string, string> = {};
    data.by_practitioner.forEach(item => {
      const key = item.practitioner_id === null ? 'null' : String(item.practitioner_id);
      names[key] = item.practitioner_name === '?' || !item.practitioner_name ? '無' : item.practitioner_name;
    });
    return names;
  }, [data?.by_practitioner]);

  const groupNames = useMemo(() => {
    if (!data?.by_group) return {};
    const names: Record<string, string> = {};
    data.by_group.forEach(item => {
      const key = item.service_type_group_id === null ? 'null' : String(item.service_type_group_id);
      names[key] = item.group_name || '未分類';
    });
    return names;
  }, [data?.by_group]);

  // Check if data contains null practitioners (for showing "無" option in dropdown)
  // Use unfiltered data (customItemsData) to check if null practitioners exist in the dataset,
  // not the filtered data, so the option remains available even when filtering by a specific practitioner
  const hasNullPractitionerInData = useMemo(() => {
    return customItemsData?.by_practitioner?.some(item => item.practitioner_id === null) ?? false;
  }, [customItemsData?.by_practitioner]);

  // Early returns AFTER all hooks
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (error) {
    return <ErrorMessage message={error.message || '載入資料失敗'} />;
  }

  if (!data) {
    return null;
  }

  const { summary, revenue_trend, by_service, by_practitioner, by_group } = data;
  
  // Determine breakdown context:
  // - If no groups exist: always show service breakdown
  // - If groups exist: show service breakdown when group is selected, show group breakdown when not
  const showServiceBreakdown = !hasGroups || selectedGroupId !== null;
  const showGroupBreakdown = hasGroups && selectedGroupId === null && by_group !== undefined && by_group !== null && by_group.length > 0;

  // Prepare chart data
  const chartData = revenue_trend.map(point => ({
    date: point.date,
    total: point.total,
    byService: point.by_service || {},
    byPractitioner: point.by_practitioner || {},
    byGroup: point.by_group || {},
  }));

  return (
    <>
      <DashboardBackButton />
      <div className="max-w-7xl mx-auto px-0 md:px-6 md:py-6">
        {/* Page Header */}
      <div className="px-3 md:px-0 mb-4 md:mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-xl md:text-2xl font-semibold text-gray-900">業務洞察</h1>
          <InfoButton onClick={() => setShowPageInfoModal(true)} ariaLabel="查看說明" />
        </div>
        <p className="text-xs md:text-sm text-gray-600 mt-1">查看診所營收趨勢、服務項目表現和治療師績效</p>
      </div>

      {/* Filters */}
      <DashboardFilters
        startDate={pendingStartDate}
        endDate={pendingEndDate}
        onStartDateChange={setPendingStartDate}
        onEndDateChange={setPendingEndDate}
        practitionerId={pendingPractitionerId}
        onPractitionerChange={setPendingPractitionerId}
        practitioners={practitioners}
        hasNullPractitionerInData={hasNullPractitionerInData}
        hasGroups={hasGroups}
        groupId={pendingGroupId}
        onGroupChange={setPendingGroupId}
        groups={groups}
        serviceItemId={pendingServiceItemId}
        onServiceItemChange={setPendingServiceItemId}
        serviceItems={serviceItems}
        standardServiceItemIds={standardServiceItemIds}
        onApplyFilters={handleApplyFilters}
        onTimeRangePreset={handleTimeRangePreset}
        activePreset={detectPresetFromDates(startDate, endDate)}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-4 mb-4 md:mb-6">
        <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-xs md:text-sm text-gray-600">總營收</p>
            <InfoButton
              onClick={() => setShowMetricModals(prev => ({ ...prev, revenue: true }))}
              ariaLabel="查看總營收說明"
              size="small"
            />
          </div>
          <p className="text-lg md:text-2xl font-semibold text-gray-900">{formatCurrency(summary.total_revenue)}</p>
        </div>
        <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-xs md:text-sm text-gray-600">有效收據數</p>
            <InfoButton
              onClick={() => setShowMetricModals(prev => ({ ...prev, receiptCount: true }))}
              ariaLabel="查看有效收據數說明"
              size="small"
            />
          </div>
          <p className="text-lg md:text-2xl font-semibold text-gray-900">{summary.valid_receipt_count}</p>
        </div>
        <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-xs md:text-sm text-gray-600">服務項目數</p>
            <InfoButton
              onClick={() => setShowMetricModals(prev => ({ ...prev, serviceItemCount: true }))}
              ariaLabel="查看服務項目數說明"
              size="small"
            />
          </div>
          <p className="text-lg md:text-2xl font-semibold text-gray-900">{summary.service_item_count}</p>
        </div>
        <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-xs md:text-sm text-gray-600">活躍病患</p>
            <InfoButton
              onClick={() => setShowMetricModals(prev => ({ ...prev, activePatients: true }))}
              ariaLabel="查看活躍病患說明"
              size="small"
            />
          </div>
          <p className="text-lg md:text-2xl font-semibold text-gray-900">{summary.active_patients}</p>
        </div>
        <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-xs md:text-sm text-gray-600">平均交易金額</p>
            <InfoButton
              onClick={() => setShowMetricModals(prev => ({ ...prev, avgTransaction: true }))}
              ariaLabel="查看平均交易金額說明"
              size="small"
            />
          </div>
          <p className="text-lg md:text-2xl font-semibold text-gray-900">{formatCurrency(summary.average_transaction_amount)}</p>
        </div>
      </div>

      {/* Revenue Trend Chart */}
      <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6 pt-6 border-t border-gray-200 md:pt-6 md:border-t-0 mb-4 md:mb-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 mb-3 md:mb-4">
          <div>
            <h2 className="text-base md:text-lg font-semibold text-gray-900">營收趨勢</h2>
            <p className="text-xs text-gray-500 mt-0.5">依預約日期統計</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs md:text-sm text-gray-600">顯示方式：</label>
            <select
              value={chartView}
              onChange={(e) => setChartView(e.target.value as ChartView)}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm"
            >
              <option value="total">總營收</option>
              {!hasGroups ? (
                <option value="stacked-service">依服務項目</option>
              ) : showServiceBreakdown ? (
                <option value="stacked-service">依服務項目</option>
              ) : showGroupBreakdown ? (
                <option value="stacked-group">依群組</option>
              ) : null}
              <option value="stacked-practitioner">依治療師</option>
            </select>
          </div>
        </div>
        <RevenueTrendChart
          data={chartData}
          view={chartView}
          startDate={startDate}
          endDate={endDate}
          serviceNames={serviceNames}
          practitionerNames={practitionerNames}
          groupNames={groupNames}
        />
      </div>

      {/* Breakdown Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Service Type - Only show when group is selected */}
        {showServiceBreakdown && (
          <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6">
            <h2 className="text-base md:text-lg font-semibold text-gray-900 mb-3 md:mb-4">依服務項目</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 md:px-4 py-2 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">服務項目</th>
                  <th className="px-2 md:px-4 py-2 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">營收</th>
                  <th className="px-2 md:px-4 py-2 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">項目數</th>
                  <th className="px-2 md:px-4 py-2 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">占比</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {by_service.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm text-gray-500">
                      目前沒有符合條件的資料
                    </td>
                  </tr>
                ) : (
                  by_service.map((item) => (
                  <tr key={item.service_item_id || `custom-${item.receipt_name}`}>
                    <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium text-gray-900">
                      {item.is_custom ? (
                        <>
                          <span className="italic text-gray-600">{item.receipt_name}</span>
                          <span className="text-xs text-gray-400 ml-1">(自訂)</span>
                        </>
                      ) : (
                        serviceItemIdToName.get(item.service_item_id!) || item.service_item_name
                      )}
                    </td>
                    <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900 text-right">
                      {formatCurrency(item.total_revenue)}
                    </td>
                    <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-500 text-right">
                      {item.item_count}
                    </td>
                    <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-500 text-right">
                      {Math.round(item.percentage)}%
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          </div>
        )}

        {/* By Group - Only show when no group filter is applied */}
        {showGroupBreakdown && (
          <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6">
            <h2 className="text-base md:text-lg font-semibold text-gray-900 mb-3 md:mb-4">依群組</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 md:px-4 py-2 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">群組</th>
                    <th className="px-2 md:px-4 py-2 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">營收</th>
                    <th className="px-2 md:px-4 py-2 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">項目數</th>
                    <th className="px-2 md:px-4 py-2 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">占比</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {by_group!.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm text-gray-500">
                        目前沒有符合條件的資料
                      </td>
                    </tr>
                  ) : (
                    by_group!.map((item: { service_type_group_id: number | null; group_name: string; total_revenue: number; item_count: number; percentage: number }) => (
                      <tr key={item.service_type_group_id || 'ungrouped'}>
                        <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium text-gray-900">
                          {item.group_name || '未分類'}
                        </td>
                        <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900 text-right">
                          {formatCurrency(item.total_revenue)}
                        </td>
                        <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-500 text-right">
                          {item.item_count}
                        </td>
                        <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-500 text-right">
                          {Math.round(item.percentage)}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* By Practitioner */}
        <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6">
          <h2 className="text-base md:text-lg font-semibold text-gray-900 mb-3 md:mb-4">依治療師</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 md:px-4 py-2 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">治療師</th>
                  <th className="px-2 md:px-4 py-2 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">營收</th>
                  <th className="px-2 md:px-4 py-2 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">項目數</th>
                  <th className="px-2 md:px-4 py-2 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">占比</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {by_practitioner.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm text-gray-500">
                      目前沒有符合條件的資料
                    </td>
                  </tr>
                ) : (
                  by_practitioner.map((item) => (
                  <tr key={item.practitioner_id || 'null'}>
                    <td className={`px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium ${
                      item.practitioner_id === null ? 'text-gray-500' : 'text-gray-900'
                    }`}>
                      {item.practitioner_name === '?' || !item.practitioner_name ? '無' : item.practitioner_name}
                    </td>
                    <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900 text-right">
                      {formatCurrency(item.total_revenue)}
                    </td>
                    <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-500 text-right">
                      {item.item_count}
                    </td>
                    <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-500 text-right">
                      {Math.round(item.percentage)}%
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Info Modals */}
      {showPageInfoModal && (
        <InfoModal
          isOpen={showPageInfoModal}
          onClose={() => setShowPageInfoModal(false)}
          title="業務洞察說明"
        >
          <p><strong>數據來源：</strong>本頁面所有財務指標均基於有效收據（不含作廢收據）計算。</p>
          <p><strong>多項目處理：</strong>當一個預約在結帳時包含多個服務項目時，每個項目會分別計算在服務項目統計中。例如：一個收據包含「初診評估」和「復健治療」兩個項目，則兩個項目都會計入各自的統計。</p>
        </InfoModal>
      )}

      {showMetricModals.revenue && (
        <InfoModal
          isOpen={showMetricModals.revenue}
          onClose={() => setShowMetricModals(prev => ({ ...prev, revenue: false }))}
          title="總營收"
        >
          <p>所選期間內所有有效收據的總金額總和。僅計算未作廢的收據。</p>
        </InfoModal>
      )}

      {showMetricModals.receiptCount && (
        <InfoModal
          isOpen={showMetricModals.receiptCount}
          onClose={() => setShowMetricModals(prev => ({ ...prev, receiptCount: false }))}
          title="有效收據數"
        >
          <p>所選期間內有效（未作廢）收據的總數量。作廢的收據不計入此統計。</p>
        </InfoModal>
      )}

      {showMetricModals.serviceItemCount && (
        <InfoModal
          isOpen={showMetricModals.serviceItemCount}
          onClose={() => setShowMetricModals(prev => ({ ...prev, serviceItemCount: false }))}
          title="服務項目數"
        >
          <p>所選期間內所有有效收據中服務項目的總數量。一個收據可以包含多個服務項目，每個項目都會分別計數。</p>
        </InfoModal>
      )}

      {showMetricModals.activePatients && (
        <InfoModal
          isOpen={showMetricModals.activePatients}
          onClose={() => setShowMetricModals(prev => ({ ...prev, activePatients: false }))}
          title="活躍病患"
        >
          <p>所選期間內有預約記錄的不重複病患數量。這是營運指標，與財務數據無直接關係。</p>
        </InfoModal>
      )}

      {showMetricModals.avgTransaction && (
        <InfoModal
          isOpen={showMetricModals.avgTransaction}
          onClose={() => setShowMetricModals(prev => ({ ...prev, avgTransaction: false }))}
          title="平均交易金額"
        >
          <p>總營收除以有效收據數。代表平均每筆收據的金額。</p>
        </InfoModal>
      )}
      </div>
    </>
  );
};

export default BusinessInsightsPage;



