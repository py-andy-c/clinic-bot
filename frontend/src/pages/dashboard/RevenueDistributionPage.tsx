import React, { useState, useMemo, useCallback } from 'react';
import moment from 'moment-timezone';
import { useApiData } from '../../hooks/useApiData';
import { apiService } from '../../services/api';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { InfoButton, InfoModal } from '../../components/shared';
import { SortableTableHeader, SortDirection } from '../../components/dashboard/SortableTableHeader';
import { TimeRangePresets, TimeRangePreset, getDateRangeForPreset, detectPresetFromDates } from '../../components/dashboard/TimeRangePresets';
import { FilterDropdown, PractitionerOption, ServiceItemOption } from '../../components/dashboard/FilterDropdown';
import { formatCurrency } from '../../utils/currencyUtils';
import { ReceiptViewModal } from '../../components/calendar/ReceiptViewModal';
import { EventModal } from '../../components/calendar/EventModal';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { formatEventTimeRange } from '../../utils/calendarDataAdapter';
import { useAuth } from '../../hooks/useAuth';
import { logger } from '../../utils/logger';
import DashboardBackButton from '../../components/DashboardBackButton';

const RevenueDistributionPage: React.FC = () => {
  const { isClinicAdmin } = useAuth();
  // Active filter state (used for API calls)
  const [startDate, setStartDate] = useState<string>(moment().startOf('month').format('YYYY-MM-DD'));
  const [endDate, setEndDate] = useState<string>(moment().endOf('month').format('YYYY-MM-DD'));
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | string | null>(null);
  const [selectedServiceItemId, setSelectedServiceItemId] = useState<number | string | null>(null);
  const [showOverwrittenOnly, setShowOverwrittenOnly] = useState(false);
  
  // Pending filter state (for UI inputs, not applied until button clicked)
  const [pendingStartDate, setPendingStartDate] = useState<string>(moment().startOf('month').format('YYYY-MM-DD'));
  const [pendingEndDate, setPendingEndDate] = useState<string>(moment().endOf('month').format('YYYY-MM-DD'));
  const [pendingPractitionerId, setPendingPractitionerId] = useState<number | string | null>(null);
  const [pendingServiceItemId, setPendingServiceItemId] = useState<number | string | null>(null);
  const [pendingShowOverwrittenOnly, setPendingShowOverwrittenOnly] = useState(false);
  const [currentSort, setCurrentSort] = useState<{ column: string; direction: SortDirection }>({
    column: 'date',
    direction: 'desc',
  });
  const [page, setPage] = useState(1);
  const [showPageInfoModal, setShowPageInfoModal] = useState(false);
  const [showOverwrittenFilterInfoModal, setShowOverwrittenFilterInfoModal] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedAppointmentEvent, setSelectedAppointmentEvent] = useState<CalendarEvent | null>(null);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [loadingRowKey, setLoadingRowKey] = useState<string | null>(null);

  // Load practitioners and service items
  const { data: membersData } = useApiData(() => apiService.getMembers(), { cacheTTL: 5 * 60 * 1000 });
  const { data: settingsData } = useApiData(() => apiService.getClinicSettings(), { cacheTTL: 5 * 60 * 1000 });

  const practitioners = useMemo<PractitionerOption[]>(() => {
    if (!membersData || !Array.isArray(membersData)) return [];
    const pracs = membersData
      .filter(m => m.roles.includes('practitioner'))
      .map(m => ({ id: m.id, full_name: m.full_name }));
    // Add null practitioner option if there are receipts with null practitioners
    return pracs;
  }, [membersData]);

  // Fetch revenue distribution data (needed for custom items extraction)
  const fetchRevenueDistribution = useCallback(() => {
    const params: Parameters<typeof apiService.getRevenueDistribution>[0] = {
      start_date: startDate,
      end_date: endDate,
      show_overwritten_only: showOverwrittenOnly,
      page,
      page_size: 20,
      sort_by: currentSort.column,
      sort_order: currentSort.direction || 'desc',
    };
    if (selectedPractitionerId !== null) {
      if (typeof selectedPractitionerId === 'number') {
        params.practitioner_id = selectedPractitionerId;
      } else if (selectedPractitionerId === 'null') {
        params.practitioner_id = 'null';
      }
    }
    if (selectedServiceItemId) {
      params.service_item_id = selectedServiceItemId;
    }
    return apiService.getRevenueDistribution(params);
  }, [startDate, endDate, selectedPractitionerId, selectedServiceItemId, showOverwrittenOnly, page, currentSort]);

  const { data, loading, error } = useApiData(fetchRevenueDistribution, {
    cacheTTL: 2 * 60 * 1000, // 2 minutes cache
    dependencies: [startDate, endDate, selectedPractitionerId, selectedServiceItemId, showOverwrittenOnly, page, currentSort], // Explicit dependencies to trigger refetch when filters change
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

    // Extract custom items from revenue distribution data
    const customItemsMap = new Map<string, ServiceItemOption>();
    if (data?.items) {
      data.items.forEach(item => {
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
  }, [settingsData, data?.items]);

  const standardServiceItemIds = useMemo(() => {
    return new Set(serviceItems.filter(si => !si.is_custom).map(si => si.id));
  }, [serviceItems]);

  // Check if data contains null practitioners (for showing "無" option in dropdown)
  const hasNullPractitionerInData = useMemo(() => {
    return data?.items?.some(item => item.practitioner_id === null) ?? false;
  }, [data?.items]);

  const handleSort = (column: string) => {
    setCurrentSort(prev => {
      if (prev.column === column) {
        return {
          column,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        column,
        direction: 'asc',
      };
    });
    setPage(1); // Reset to first page on sort
  };

  const handleTimeRangePreset = (preset: TimeRangePreset) => {
    const { startDate: newStartDate, endDate: newEndDate } = getDateRangeForPreset(preset);
    // Auto-apply preset: update both pending and active dates immediately
    setPendingStartDate(newStartDate);
    setPendingEndDate(newEndDate);
    setStartDate(newStartDate);
    setEndDate(newEndDate);
  };

  const handleApplyFilters = () => {
    // Apply pending filters to active filters (triggers API call)
    setStartDate(pendingStartDate);
    setEndDate(pendingEndDate);
    setSelectedPractitionerId(pendingPractitionerId);
    setSelectedServiceItemId(pendingServiceItemId);
    setShowOverwrittenOnly(pendingShowOverwrittenOnly);
    // Reset to page 1 when filters change
    setPage(1);
  };

  const handleViewAppointment = useCallback(async (appointmentId: number, receiptId: number, rowIndex: number) => {
    const rowKey = `${receiptId}-${rowIndex}`;
    try {
      setLoadingRowKey(rowKey);
      
      // Fetch appointment details directly by ID (no need for date/practitioner)
      const appointmentData = await apiService.getAppointmentDetails(appointmentId);
      
      // Convert AppointmentListItem to CalendarEvent format for EventModal
      const resource: CalendarEvent['resource'] = {
        type: 'appointment',
        calendar_event_id: appointmentData.calendar_event_id,
        appointment_id: appointmentData.calendar_event_id,
        patient_id: appointmentData.patient_id,
        patient_name: appointmentData.patient_name,
        practitioner_id: appointmentData.practitioner_id,
        practitioner_name: appointmentData.practitioner_name,
        appointment_type_id: appointmentData.appointment_type_id,
        appointment_type_name: appointmentData.appointment_type_name,
        status: appointmentData.status,
        is_auto_assigned: appointmentData.is_auto_assigned,
        originally_auto_assigned: appointmentData.originally_auto_assigned,
        has_active_receipt: appointmentData.has_active_receipt,
        has_any_receipt: appointmentData.has_any_receipt,
        receipt_id: appointmentData.receipt_id || null,
        receipt_ids: appointmentData.receipt_ids || [],
      };
      
      // Only include optional fields if they have values
      if (appointmentData.notes) {
        resource.notes = appointmentData.notes;
      }
      if (appointmentData.clinic_notes) {
        resource.clinic_notes = appointmentData.clinic_notes;
      }
      if (appointmentData.line_display_name) {
        resource.line_display_name = appointmentData.line_display_name;
      }
      
      const calendarEvent: CalendarEvent = {
        id: appointmentData.calendar_event_id,
        title: appointmentData.event_name,
        start: new Date(appointmentData.start_time),
        end: new Date(appointmentData.end_time),
        resource,
      };
      
      setSelectedAppointmentEvent(calendarEvent);
      setShowAppointmentModal(true);
    } catch (error) {
      logger.error('Failed to load appointment details:', error);
      alert('無法載入預約詳情，請稍後再試');
    } finally {
      setLoadingRowKey(null);
    }
  }, []);

  const handleViewReceipt = (receiptId: number) => {
    setSelectedReceiptId(receiptId);
    setShowReceiptModal(true);
  };

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

  const { summary, items, total, page: currentPage, page_size } = data;
  const totalPages = Math.ceil(total / page_size);

  return (
    <>
      <DashboardBackButton />
      <div className="max-w-7xl mx-auto px-0 md:px-6 md:py-6">
        {/* Page Header */}
      <div className="px-3 md:px-0 mb-4 md:mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-xl md:text-2xl font-semibold text-gray-900">診所分潤審核</h1>
          <InfoButton onClick={() => setShowPageInfoModal(true)} ariaLabel="查看說明" />
        </div>
        <p className="text-xs md:text-sm text-gray-600 mt-1">審核和檢視診所分潤，確認計費方案選擇和金額覆寫</p>
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
              hasNullPractitionerInData={hasNullPractitionerInData}
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
          <div className="flex items-end gap-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={pendingShowOverwrittenOnly}
                onChange={(e) => setPendingShowOverwrittenOnly(e.target.checked)}
                className="mr-2"
              />
              <span className="text-xs md:text-sm text-gray-700">僅顯示覆寫計費方案</span>
              <InfoButton
                onClick={() => setShowOverwrittenFilterInfoModal(true)}
                ariaLabel="查看覆寫計費方案說明"
              />
            </label>
          </div>
        </div>
        <div className="mt-3 md:mt-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <TimeRangePresets 
              onSelect={handleTimeRangePreset} 
              activePreset={detectPresetFromDates(startDate, endDate)}
            />
          </div>
          <button
            onClick={handleApplyFilters}
            className="px-3 md:px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs md:text-sm font-medium"
          >
            套用篩選
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-4 mb-4 md:mb-6">
        <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6">
          <p className="text-xs md:text-sm text-gray-600 mb-1">總營收</p>
          <p className="text-lg md:text-2xl font-semibold text-gray-900">{formatCurrency(summary.total_revenue)}</p>
        </div>
        <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6">
          <p className="text-xs md:text-sm text-gray-600 mb-1">總診所分潤</p>
          <p className="text-lg md:text-2xl font-semibold text-blue-600">{formatCurrency(summary.total_clinic_share)}</p>
        </div>
        <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6">
          <p className="text-xs md:text-sm text-gray-600 mb-1">收據項目數</p>
          <p className="text-lg md:text-2xl font-semibold text-gray-900">{summary.receipt_item_count}</p>
        </div>
      </div>

      {/* Receipts List */}
      <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm pt-6 border-t border-gray-200 md:pt-0 md:border-t-0">
        <div className="px-3 py-2 md:px-6 md:py-6 border-b border-gray-200">
          <h2 className="text-base md:text-lg font-semibold text-gray-900">收據明細</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="divide-y divide-gray-200" style={{ minWidth: '1200px' }}>
            <thead className="bg-gray-50">
              <tr>
                <SortableTableHeader
                  column="receipt_number"
                  currentSort={currentSort}
                  onSort={handleSort}
                  align="left"
                  className="whitespace-nowrap"
                  style={{ minWidth: '100px' }}
                >
                  收據編號
                </SortableTableHeader>
                <SortableTableHeader
                  column="date"
                  currentSort={currentSort}
                  onSort={handleSort}
                  align="left"
                  className="whitespace-nowrap"
                  style={{ minWidth: '90px' }}
                >
                  預約日期
                </SortableTableHeader>
                <SortableTableHeader
                  column="patient"
                  currentSort={currentSort}
                  onSort={handleSort}
                  align="left"
                  className="whitespace-nowrap"
                  style={{ minWidth: '80px' }}
                >
                  病患
                </SortableTableHeader>
                <SortableTableHeader
                  column="item"
                  currentSort={currentSort}
                  onSort={handleSort}
                  align="left"
                  style={{ minWidth: '140px' }}
                >
                  項目
                </SortableTableHeader>
                <SortableTableHeader
                  column="quantity"
                  currentSort={currentSort}
                  onSort={handleSort}
                  align="center"
                  className="whitespace-nowrap"
                  style={{ minWidth: '60px' }}
                >
                  數量
                </SortableTableHeader>
                <SortableTableHeader
                  column="practitioner"
                  currentSort={currentSort}
                  onSort={handleSort}
                  align="left"
                  style={{ minWidth: '100px' }}
                >
                  治療師
                </SortableTableHeader>
                <SortableTableHeader
                  column="billing_scenario"
                  currentSort={currentSort}
                  onSort={handleSort}
                  align="left"
                  style={{ minWidth: '100px' }}
                >
                  計費方案
                </SortableTableHeader>
                <SortableTableHeader
                  column="amount"
                  currentSort={currentSort}
                  onSort={handleSort}
                  align="right"
                  className="whitespace-nowrap"
                  style={{ minWidth: '90px' }}
                >
                  金額
                </SortableTableHeader>
                <SortableTableHeader
                  column="revenue_share"
                  currentSort={currentSort}
                  onSort={handleSort}
                  align="right"
                  className="whitespace-nowrap"
                  style={{ minWidth: '100px' }}
                >
                  診所分潤
                </SortableTableHeader>
                <th className="px-2 md:px-4 py-2 md:py-3 text-center text-xs font-medium text-gray-500 uppercase whitespace-nowrap" style={{ minWidth: '140px' }}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-2 md:px-4 py-2 md:py-3 text-center text-xs md:text-sm text-gray-500">
                    目前沒有符合條件的資料
                  </td>
                </tr>
              ) : (
                items.map((item, index) => {
                  const isOverwritten = item.billing_scenario === '其他';
                  return (
                    <tr
                      key={`${item.receipt_id}-${index}`}
                      className={isOverwritten ? 'bg-yellow-100' : ''}
                    >
                      <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium text-gray-900 whitespace-nowrap">
                        {item.receipt_number}
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-500 whitespace-nowrap">
                        {item.date}
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900 whitespace-nowrap">
                        {item.patient_name}
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900">
                        {item.is_custom ? (
                          <>
                            <span className="italic text-gray-600">{item.receipt_name}</span>
                            <span className="text-xs text-gray-400 ml-1">(自訂)</span>
                          </>
                        ) : (
                          item.receipt_name
                        )}
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-500 text-center whitespace-nowrap">
                        {item.quantity}
                      </td>
                      <td className={`px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm whitespace-nowrap ${
                        item.practitioner_id === null ? 'text-gray-500' : 'text-gray-900'
                      }`}>
                        {item.practitioner_name || '無'}
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-500 whitespace-nowrap">
                        {item.billing_scenario}
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900 text-right whitespace-nowrap">
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-blue-600 text-right whitespace-nowrap">
                        {formatCurrency(item.revenue_share)}
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-2">
                          {item.appointment_id && (
                            <>
                              <button
                                className="text-blue-600 hover:text-blue-800 text-xs md:text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => handleViewAppointment(item.appointment_id!, item.receipt_id, index)}
                                disabled={loadingRowKey === `${item.receipt_id}-${index}`}
                              >
                                {loadingRowKey === `${item.receipt_id}-${index}` ? '載入中...' : '檢視預約'}
                              </button>
                              <span className="text-gray-300">|</span>
                            </>
                          )}
                          <button
                            className="text-blue-600 hover:text-blue-800 text-xs md:text-sm whitespace-nowrap"
                            onClick={() => handleViewReceipt(item.receipt_id)}
                          >
                            檢視收據
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="px-3 md:px-6 py-3 md:py-4 border-t border-gray-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2">
          <div className="text-xs md:text-sm text-gray-700">
            顯示 <span className="font-medium">{(currentPage - 1) * page_size + 1}</span> 到{' '}
            <span className="font-medium">{Math.min(currentPage * page_size, total)}</span> 筆，共{' '}
            <span className="font-medium">{total}</span> 筆項目
          </div>
          <div className="flex gap-2">
            <button
              className="px-2 md:px-3 py-1 border border-gray-300 rounded-md text-xs md:text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={currentPage === 1}
              onClick={() => setPage(prev => Math.max(1, prev - 1))}
            >
              上一頁
            </button>
            <button
              className="px-2 md:px-3 py-1 border border-gray-300 rounded-md text-xs md:text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
            >
              下一頁
            </button>
          </div>
        </div>
      </div>

      {/* Info Modals */}
      {showPageInfoModal && (
        <InfoModal
          isOpen={showPageInfoModal}
          onClose={() => setShowPageInfoModal(false)}
          title="診所分潤審核說明"
        >
          <p><strong>目的：</strong>此頁面用於審核和檢視診所分潤，確認治療師在結帳時選擇的計費方案是否正確，以及是否有金額覆寫的情況。</p>
          <p><strong>計費方案：</strong>治療師在結帳時可以選擇預設的計費方案（如「原價」、「九折」、「會員價」），或選擇「其他」並手動輸入金額。</p>
          <p><strong>覆寫項目：</strong>當計費方案顯示為「其他」時，表示金額已被覆寫，需要特別審核確認是否正確。覆寫項目會以黃色背景標示。覆寫可能發生在標準服務項目（使用預設計費方案但金額被手動修改）或自訂服務項目（選擇「其他」並輸入自訂金額）上。</p>
          <p><strong>自訂服務項目：</strong>如果服務項目名稱顯示為斜體並標註「(自訂)」，表示這是治療師在結帳時輸入的自訂項目名稱。</p>
          <p><strong>標準項目覆寫：</strong>即使是標準服務項目（如「初診評估」、「復健治療」），如果治療師選擇「其他」計費方案並手動輸入金額，也會被標記為覆寫項目。</p>
          <p><strong>數量：</strong>顯示該項目的數量。金額和診所分潤欄位顯示的是總額（單價 × 數量）。例如：數量為 3，金額為 $5,400，表示單價為 $1,800，總共 3 個單位。</p>
          <p><strong>無治療師：</strong>如果治療師欄位顯示「無」，表示該項目未指定治療師。</p>
        </InfoModal>
      )}

      {showOverwrittenFilterInfoModal && (
        <InfoModal
          isOpen={showOverwrittenFilterInfoModal}
          onClose={() => setShowOverwrittenFilterInfoModal(false)}
          title="覆寫計費方案說明"
        >
          <p><strong>什麼是覆寫計費方案？</strong></p>
          <p>當治療師在結帳時選擇「其他」計費方案並手動輸入金額時，該項目會被標記為「覆寫計費方案」。</p>
        </InfoModal>
      )}

      {/* Receipt View Modal */}
      {showReceiptModal && selectedReceiptId && (
        <ReceiptViewModal
          receiptId={selectedReceiptId}
          onClose={() => {
            setShowReceiptModal(false);
            setSelectedReceiptId(null);
          }}
          onReceiptVoided={() => {
            // Refetch data after voiding
            // The useApiData hook will automatically refetch when dependencies change
          }}
          isAdmin={isClinicAdmin || false}
        />
      )}

      {/* Appointment View Modal */}
      {showAppointmentModal && selectedAppointmentEvent && (
        <EventModal
          event={selectedAppointmentEvent}
          onClose={() => {
            setShowAppointmentModal(false);
            setSelectedAppointmentEvent(null);
          }}
          formatAppointmentTime={formatEventTimeRange}
          appointmentTypes={settingsData?.appointment_types?.map(at => ({
            id: at.id,
            name: at.name,
            receipt_name: at.receipt_name ?? null,
          })) || []}
          practitioners={practitioners}
          onReceiptCreated={() => {
            // Refetch data after receipt creation
            // The useApiData hook will automatically refetch when dependencies change
          }}
        />
      )}
      </div>
    </>
  );
};

export default RevenueDistributionPage;



