import React, { useState, useMemo, useCallback } from 'react';
import moment from 'moment-timezone';
import { useApiData } from '../../hooks/useApiData';
import { apiService } from '../../services/api';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { InfoButton, InfoModal } from '../../components/shared';
import { RevenueTrendChart, ChartView } from '../../components/dashboard/RevenueTrendChart';
import { TimeRangePresets, TimeRangePreset, getDateRangeForPreset } from '../../components/dashboard/TimeRangePresets';
import { FilterDropdown, PractitionerOption, ServiceItemOption } from '../../components/dashboard/FilterDropdown';
import { formatCurrency } from '../../utils/currencyUtils';

const BusinessInsightsPage: React.FC = () => {
  // Active filter state (used for API calls)
  const [startDate, setStartDate] = useState<string>(moment().startOf('month').format('YYYY-MM-DD'));
  const [endDate, setEndDate] = useState<string>(moment().endOf('month').format('YYYY-MM-DD'));
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | string | null>(null);
  const [selectedServiceItemId, setSelectedServiceItemId] = useState<number | string | null>(null);
  
  // Pending filter state (for UI inputs, not applied until button clicked)
  const [pendingStartDate, setPendingStartDate] = useState<string>(moment().startOf('month').format('YYYY-MM-DD'));
  const [pendingEndDate, setPendingEndDate] = useState<string>(moment().endOf('month').format('YYYY-MM-DD'));
  const [pendingPractitionerId, setPendingPractitionerId] = useState<number | string | null>(null);
  const [pendingServiceItemId, setPendingServiceItemId] = useState<number | string | null>(null);
  
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
  const { data: membersData } = useApiData(() => apiService.getMembers(), { cacheTTL: 5 * 60 * 1000 });
  const { data: settingsData } = useApiData(() => apiService.getClinicSettings(), { cacheTTL: 5 * 60 * 1000 });

  const practitioners = useMemo<PractitionerOption[]>(() => {
    if (!membersData) return [];
    return membersData
      .filter(m => m.roles.includes('practitioner'))
      .map(m => ({ id: m.id, full_name: m.full_name }));
  }, [membersData]);

  // Fetch business insights data (needed for custom items extraction)
  const fetchBusinessInsights = useCallback(() => {
    return apiService.getBusinessInsights({
      start_date: startDate,
      end_date: endDate,
      practitioner_id: typeof selectedPractitionerId === 'number' ? selectedPractitionerId : null,
      service_item_id: selectedServiceItemId || null,
    });
  }, [startDate, endDate, selectedPractitionerId, selectedServiceItemId]);

  const { data, loading, error } = useApiData(fetchBusinessInsights, {
    cacheTTL: 2 * 60 * 1000, // 2 minutes cache
    dependencies: [startDate, endDate, selectedPractitionerId, selectedServiceItemId], // Explicit dependencies to trigger refetch when filters change
  });

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
      predefinedItems.push(...settingsData.appointment_types.map(at => {
        const item: ServiceItemOption = {
          id: at.id,
          name: at.name,
          is_custom: false,
        };
        if (at.receipt_name !== undefined && at.receipt_name !== null) {
          item.receipt_name = at.receipt_name;
        }
        return item;
      }));
    }

    // Extract custom items from business insights data
    const customItemsMap = new Map<string, ServiceItemOption>();
    if (data?.by_service) {
      data.by_service.forEach(item => {
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
    return [...predefinedItems, ...Array.from(customItemsMap.values())];
  }, [settingsData, data?.by_service]);

  const standardServiceItemIds = useMemo(() => {
    return new Set(serviceItems.filter(si => !si.is_custom).map(si => si.id));
  }, [serviceItems]);


  const handleTimeRangePreset = (preset: TimeRangePreset) => {
    const { startDate: newStartDate, endDate: newEndDate } = getDateRangeForPreset(preset);
    // Time range presets only update pending dates; apply via "套用篩選" button
    setPendingStartDate(newStartDate);
    setPendingEndDate(newEndDate);
  };

  const handleApplyFilters = () => {
    // Apply pending filters to active filters (triggers API call via dependencies)
    setStartDate(pendingStartDate);
    setEndDate(pendingEndDate);
    setSelectedPractitionerId(pendingPractitionerId);
    setSelectedServiceItemId(pendingServiceItemId);
  };

  // Prepare service names and practitioner names for chart
  // These hooks must be called unconditionally (before any early returns)
  const serviceNames = useMemo(() => {
    if (!data?.by_service) return {};
    const names: Record<string, string> = {};
    data.by_service.forEach(item => {
      const key = item.is_custom ? `custom:${item.receipt_name}` : String(item.service_item_id);
      names[key] = item.receipt_name;
    });
    return names;
  }, [data?.by_service]);

  const practitionerNames = useMemo(() => {
    if (!data?.by_practitioner) return {};
    const names: Record<string, string> = {};
    data.by_practitioner.forEach(item => {
      const key = item.practitioner_id === null ? 'null' : String(item.practitioner_id);
      names[key] = item.practitioner_name === '?' || !item.practitioner_name ? '無' : item.practitioner_name;
    });
    return names;
  }, [data?.by_practitioner]);

  // Early returns AFTER all hooks
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!data) {
    return null;
  }

  const { summary, revenue_trend, by_service, by_practitioner } = data;

  // Prepare chart data
  const chartData = revenue_trend.map(point => ({
    date: point.date,
    total: point.total,
    byService: point.by_service || {},
    byPractitioner: point.by_practitioner || {},
  }));

  return (
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
      <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-4 md:py-4 mb-4 md:mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4">
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">開始日期</label>
            <input
              type="date"
              value={pendingStartDate}
              onChange={(e) => setPendingStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">結束日期</label>
            <input
              type="date"
              value={pendingEndDate}
              onChange={(e) => setPendingEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">治療師</label>
            <FilterDropdown
              type="practitioner"
              value={pendingPractitionerId}
              onChange={setPendingPractitionerId}
              practitioners={practitioners}
            />
          </div>
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">服務項目</label>
            <FilterDropdown
              type="service"
              value={pendingServiceItemId}
              onChange={setPendingServiceItemId}
              serviceItems={serviceItems}
              standardServiceItemIds={standardServiceItemIds}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleApplyFilters}
              className="w-full px-3 md:px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs md:text-sm font-medium"
            >
              套用篩選
            </button>
          </div>
        </div>
        <div className="mt-3 md:mt-4">
          <TimeRangePresets onSelect={handleTimeRangePreset} />
        </div>
      </div>

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
              <option value="stacked-service">依服務項目</option>
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
        />
      </div>

      {/* Breakdown Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Service Type */}
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
                        item.receipt_name
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
  );
};

export default BusinessInsightsPage;



