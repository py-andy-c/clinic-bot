import React, { useState, useMemo } from 'react';
import { useApiData } from '../../hooks/useApiData';
import { apiService } from '../../services/api';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { InfoButton, InfoModal } from '../../components/shared';

const LineUsagePage: React.FC = () => {
  const [showPaidMessagesModal, setShowPaidMessagesModal] = useState(false);
  const [showAiRepliesModal, setShowAiRepliesModal] = useState(false);
  const [showPageInfoModal, setShowPageInfoModal] = useState(false);

  const fetchDashboardMetrics = () => apiService.getDashboardMetrics();
  const { data, loading, error } = useApiData(fetchDashboardMetrics, {
    cacheTTL: 2 * 60 * 1000, // 2 minutes cache
  });

  // Group paid messages by recipient_type, then by event_type
  const paidMessagesTableData = useMemo(() => {
    if (!data?.paid_messages_by_month) return null;

    const paidMessages = data.paid_messages_by_month;
    const months = Array.from(
      new Set(paidMessages.map((m) => `${m.month.year}-${m.month.month}`))
    ).map((key) => {
      const [year, month] = key.split('-').map(Number);
      const found = paidMessages.find((m) => m.month.year === year && m.month.month === month);
      if (!found) {
        throw new Error(`Month ${year}-${month} not found in paid messages`);
      }
      return found.month;
    });

    const recipientGroups = new Map<
      string,
      {
        events: Map<string, { displayName: string; data: Array<{ count: number; percentage: number }> }>;
        subtotal: Array<{ count: number; percentage: number }>;
      }
    >();

    // Calculate grand total for percentage calculation
    const grandTotalByMonth = months.map(() => 0);
    paidMessages.forEach((msg) => {
      const monthIndex = months.findIndex(
        (m) => m.year === msg.month.year && m.month === msg.month.month
      );
      if (monthIndex >= 0 && grandTotalByMonth[monthIndex] !== undefined) {
        grandTotalByMonth[monthIndex] += msg.count;
      }
    });

    // Group messages
    paidMessages.forEach((msg) => {
      if (!msg.recipient_type) return;

      if (!recipientGroups.has(msg.recipient_type)) {
        recipientGroups.set(msg.recipient_type, {
          events: new Map(),
          subtotal: months.map(() => ({ count: 0, percentage: 0 })),
        });
      }

      const group = recipientGroups.get(msg.recipient_type);
      if (!group) return;
      const eventKey = msg.event_type || 'unknown';

      if (!group.events.has(eventKey)) {
        group.events.set(eventKey, {
          displayName: msg.event_display_name,
          data: months.map(() => ({ count: 0, percentage: 0 })),
        });
      }

      const monthIndex = months.findIndex(
        (m) => m.year === msg.month.year && m.month === msg.month.month
      );
      if (monthIndex >= 0) {
        const eventData = group.events.get(eventKey);
        const grandTotal = grandTotalByMonth[monthIndex];
        if (eventData && eventData.data[monthIndex] !== undefined && grandTotal !== undefined) {
          eventData.data[monthIndex] = {
            count: msg.count,
            percentage: grandTotal > 0 ? Math.round((msg.count / grandTotal) * 100) : 0,
          };
          // Update subtotal
          const subtotal = group.subtotal[monthIndex];
          if (subtotal) {
            subtotal.count += msg.count;
            subtotal.percentage = grandTotal > 0
              ? Math.round((subtotal.count / grandTotal) * 100)
              : 0;
          }
        }
      }
    });

    return { months, recipientGroups, grandTotalByMonth };
  }, [data?.paid_messages_by_month]);

  // AI replies data - calculate percentage relative to paid messages + AI replies total
  const aiRepliesData = useMemo(() => {
    if (!data?.ai_reply_messages_by_month || !paidMessagesTableData) return null;

    const aiReplies = data.ai_reply_messages_by_month;
    const months = paidMessagesTableData.months; // Use same months as paid messages
    const grandTotalByMonth = paidMessagesTableData.grandTotalByMonth;

    const dataByMonth = months.map(() => ({ count: 0, percentage: 0 }));

    aiReplies.forEach((msg) => {
      const monthIndex = months.findIndex(
        (m) => m.year === msg.month.year && m.month === msg.month.month
      );
      if (monthIndex >= 0 && dataByMonth[monthIndex] !== undefined) {
        dataByMonth[monthIndex].count += msg.count;
      }
    });

    // Calculate percentages relative to grand total (paid + AI)
    dataByMonth.forEach((cell, idx) => {
      const paidTotal = grandTotalByMonth?.[idx] || 0;
      const aiCount = cell.count;
      const grandTotal = paidTotal + aiCount;
      cell.percentage = grandTotal > 0 ? Math.round((aiCount / grandTotal) * 100) : 0;
    });

    return { months, dataByMonth };
  }, [data?.ai_reply_messages_by_month, paidMessagesTableData]);

  if (loading && !data) {
    return <LoadingSpinner size="xl" />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!data || !paidMessagesTableData || !aiRepliesData) {
    return null;
  }

  const { months, recipientGroups, grandTotalByMonth } = paidMessagesTableData;
  const { months: aiMonths, dataByMonth: aiRepliesByMonth } = aiRepliesData || { months: [], dataByMonth: [] };

  return (
    <div className="max-w-7xl mx-auto px-0 md:px-6 md:py-6">
      {/* Page Header */}
      <div className="px-3 md:px-0 mb-4 md:mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-xl md:text-2xl font-semibold text-gray-900">LINE 訊息統計</h1>
          <InfoButton onClick={() => setShowPageInfoModal(true)} ariaLabel="查看說明" />
        </div>
        <p className="text-xs md:text-sm text-gray-600 mt-1">注意：當月數據可能仍會變動</p>
      </div>

      {/* LINE Push Messages Section */}
      <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6 pt-6 border-t border-gray-200 md:pt-6 md:border-t-0 mb-4 md:mb-6">
        <div className="flex items-center gap-2 mb-3 md:mb-4">
          <h2 className="text-base md:text-lg font-semibold text-gray-900">LINE 推播訊息</h2>
          <InfoButton onClick={() => setShowPaidMessagesModal(true)} ariaLabel="查看說明" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="sticky left-0 bg-gray-50 px-2 md:px-4 py-2 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap z-10">
                  訊息類型
                </th>
                {months.map((month) => (
                  <th
                    key={`${month.year}-${month.month}`}
                    className={`px-2 md:px-4 py-2 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap ${
                      month.is_current ? 'bg-blue-50' : ''
                    }`}
                  >
                    {month.display_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {Array.from(recipientGroups.entries()).map(([recipientType, group]) => (
                <React.Fragment key={recipientType}>
                  {/* Group Header */}
                  <tr className="bg-gray-100">
                    <td className="sticky left-0 bg-gray-100 px-2 md:px-4 py-2 md:py-3 text-sm font-medium text-gray-900 whitespace-nowrap z-10">
                      {recipientType === 'patient' ? '發送給病患' : '發送給治療師'}
                    </td>
                    {group.subtotal.map((subtotal, index) => (
                      <td
                        key={index}
                        className={`px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900 text-center whitespace-nowrap font-medium ${
                          months[index]?.is_current ? 'bg-blue-100' : ''
                        }`}
                      >
                        {subtotal.count}({subtotal.percentage}%)
                      </td>
                    ))}
                  </tr>
                  {/* Event Rows */}
                  {Array.from(group.events.entries()).map(([eventKey, eventData]) => (
                    <tr key={eventKey}>
                      <td className="sticky left-0 bg-white px-2 md:px-4 py-2 md:py-3 pl-8 text-sm text-gray-900 whitespace-nowrap z-10">
                        {eventData.displayName}
                      </td>
                      {eventData.data.map((item, index) => (
                        <td
                          key={index}
                          className={`px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900 text-center whitespace-nowrap ${
                            months[index]?.is_current ? 'bg-blue-50' : ''
                          }`}
                        >
                          {item.count}({item.percentage}%)
                        </td>
                      ))}
                    </tr>
                  ))}
                  {/* Subtotal Row */}
                  <tr className="bg-gray-50">
                    <td className="sticky left-0 bg-gray-50 px-2 md:px-4 py-2 md:py-3 text-sm font-medium text-gray-900 whitespace-nowrap z-10">
                      {recipientType === 'patient' ? '發送給病患 小計' : '發送給治療師 小計'}
                    </td>
                    {group.subtotal.map((subtotal, index) => (
                      <td
                        key={index}
                        className={`px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900 text-center whitespace-nowrap font-medium ${
                          months[index]?.is_current ? 'bg-blue-100' : ''
                        }`}
                      >
                        {subtotal.count}({subtotal.percentage}%)
                      </td>
                    ))}
                  </tr>
                </React.Fragment>
              ))}
              {/* Grand Total */}
              <tr className="bg-blue-50">
                <td className="sticky left-0 bg-blue-50 px-2 md:px-4 py-2 md:py-3 text-sm font-bold text-gray-900 whitespace-nowrap z-10">
                  總計
                </td>
                {grandTotalByMonth.map((total) => (
                  <td
                    key={`total-${total}`}
                    className="px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900 text-center whitespace-nowrap font-bold"
                  >
                    {total}(100%)
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Reply Messages Section */}
      <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm px-3 py-2 md:px-6 md:py-6 pt-6 border-t border-gray-200 md:pt-6 md:border-t-0 mb-4 md:mb-6">
        <div className="flex items-center gap-2 mb-3 md:mb-4">
          <h2 className="text-base md:text-lg font-semibold text-gray-900">AI 回覆訊息</h2>
          <InfoButton onClick={() => setShowAiRepliesModal(true)} ariaLabel="查看說明" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="sticky left-0 bg-gray-50 px-2 md:px-4 py-2 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap z-10">
                  訊息類型
                </th>
                {aiMonths.map((month) => (
                  <th
                    key={`${month.year}-${month.month}`}
                    className={`px-2 md:px-4 py-2 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap ${
                      month.is_current ? 'bg-blue-50' : ''
                    }`}
                  >
                    {month.display_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              <tr>
                <td className="sticky left-0 bg-white px-2 md:px-4 py-2 md:py-3 text-sm text-gray-900 whitespace-nowrap z-10">
                  AI 回覆訊息
                </td>
                {aiRepliesByMonth.map((item, idx) => (
                  <td
                    key={`ai-${item.count}-${item.percentage}`}
                    className={`px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm text-gray-900 text-center whitespace-nowrap ${
                      aiMonths[idx]?.is_current ? 'bg-blue-50' : ''
                    }`}
                  >
                    {item.count}({item.percentage}%)
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Page Info Modal */}
      {showPageInfoModal && (
        <InfoModal
          isOpen={showPageInfoModal}
          onClose={() => setShowPageInfoModal(false)}
          title="LINE 訊息統計說明"
        >
          <p>此頁面顯示 LINE 訊息使用統計，包括推播訊息和 AI 回覆訊息的使用情況。</p>
          <p><strong>數據期間：</strong>顯示過去 3 個月及當月的數據。當月數據可能仍會變動。</p>
          <p><strong>格式：</strong>數據以「數量(百分比%)」格式顯示，百分比為四捨五入後的整數。</p>
        </InfoModal>
      )}

      {/* Paid Messages Info Modal */}
      {showPaidMessagesModal && (
        <InfoModal
          isOpen={showPaidMessagesModal}
          onClose={() => setShowPaidMessagesModal(false)}
          title="LINE 推播訊息"
        >
          <p>LINE 推播訊息由 LINE 平台收費，診所需自行負擔相關費用。</p>
          <p>若 LINE 訊息配額用盡，系統將無法發送推播訊息，但預約系統仍可正常運作。</p>
        </InfoModal>
      )}

      {/* AI Replies Info Modal */}
      {showAiRepliesModal && (
        <InfoModal
          isOpen={showAiRepliesModal}
          onClose={() => setShowAiRepliesModal(false)}
          title="AI 回覆訊息"
        >
          <p>AI 回覆訊息不會消耗 LINE 訊息配額。</p>
        </InfoModal>
      )}
    </div>
  );
};

export default LineUsagePage;



