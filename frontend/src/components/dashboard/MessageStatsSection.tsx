import React, { useState, useMemo } from 'react';
import { BaseModal } from '../shared/BaseModal';
import { ModalHeader, ModalBody } from '../shared/ModalParts';

interface MonthInfo {
  year: number;
  month: number;
  display_name: string;
  is_current: boolean;
}

interface MonthlyMessageStat {
  month: MonthInfo;
  recipient_type: string | null;
  event_type: string | null;
  event_display_name: string;
  trigger_source: string | null;
  count: number;
}

interface MessageStatsSectionProps {
  paidMessages: MonthlyMessageStat[];
  aiReplies: MonthlyMessageStat[];
}

export const MessageStatsSection: React.FC<MessageStatsSectionProps> = ({
  paidMessages,
  aiReplies,
}) => {
  const [showPaidMessagesModal, setShowPaidMessagesModal] = useState(false);
  const [showAiRepliesModal, setShowAiRepliesModal] = useState(false);

  // Group paid messages by recipient_type, then by event_type
  const paidMessagesTableData = useMemo(() => {
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
        events: Map<
          string,
          { displayName: string; data: Array<{ count: number; percentage: number }> }
        >;
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

      const group = recipientGroups.get(msg.recipient_type)!;
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
            percentage: grandTotal > 0 ? (msg.count / grandTotal) * 100 : 0,
          };
        }

        // Update subtotal
        const subtotal = group.subtotal[monthIndex];
        if (subtotal && grandTotal !== undefined) {
          subtotal.count += msg.count;
          subtotal.percentage = grandTotal > 0 ? (subtotal.count / grandTotal) * 100 : 0;
        }
      }
    });

    // Calculate grand total
    const grandTotal = months.map((_, idx) => ({
      count: Array.from(recipientGroups.values()).reduce(
        (sum, group) => {
          const subtotal = group.subtotal[idx];
          return sum + (subtotal?.count || 0);
        },
        0
      ),
      percentage: 100,
    }));

    const recipientTypeLabels: Record<string, string> = {
      patient: '發送給病患',
      practitioner: '發送給治療師',
      admin: '發送給管理員',
    };

    return {
      months,
      groups: Array.from(recipientGroups.entries()).map(([recipientType, group]) => ({
        label: recipientTypeLabels[recipientType] || recipientType,
        events: Array.from(group.events.values()),
        subtotal: group.subtotal,
      })),
      grandTotal,
    };
  }, [paidMessages]);

  // Transform AI replies for table
  const aiRepliesTableData = useMemo(() => {
    const months = Array.from(
      new Set(aiReplies.map((m) => `${m.month.year}-${m.month.month}`))
    ).map((key) => {
      const [year, month] = key.split('-').map(Number);
      const found = aiReplies.find((m) => m.month.year === year && m.month.month === month);
      if (!found) {
        throw new Error(`Month ${year}-${month} not found in AI replies`);
      }
      return found.month;
    });

    const data = months.map(() => ({ count: 0, percentage: 0 }));

    aiReplies.forEach((msg) => {
      const monthIndex = months.findIndex(
        (m) => m.year === msg.month.year && m.month === msg.month.month
      );
      if (monthIndex >= 0 && data[monthIndex] !== undefined) {
        data[monthIndex].count += msg.count;
      }
    });

    // Calculate percentages (relative to grand total of paid messages + AI replies)
    const grandTotalByMonth = months.map((_, idx) => {
      const paidTotal = paidMessagesTableData.grandTotal[idx]?.count || 0;
      const aiCount = data[idx]?.count || 0;
      return paidTotal + aiCount;
    });

    data.forEach((cell, idx) => {
      const grandTotal = grandTotalByMonth[idx];
      if (grandTotal !== undefined) {
        cell.percentage = grandTotal > 0 ? (cell.count / grandTotal) * 100 : 0;
      }
    });

    return { months, data };
  }, [aiReplies, paidMessagesTableData]);

  return (
    <div className="bg-white md:rounded-lg md:shadow-sm md:border md:border-gray-200 p-0 md:p-6 mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">LINE 訊息統計</h2>

      {/* Paid Messages Table */}
      <div className="mb-6 overflow-x-auto">
        <div className="flex items-center gap-2 mb-4">
          <p className="text-sm font-medium text-gray-700">LINE 推播訊息</p>
          <button
            type="button"
            onClick={() => setShowPaidMessagesModal(true)}
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
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap z-10">
                  訊息類型
                </th>
                {paidMessagesTableData.months.map((month) => (
                  <th
                    key={`${month.year}-${month.month}`}
                    className={`px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap ${month.is_current ? 'bg-blue-50' : ''
                      }`}
                  >
                    {month.display_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paidMessagesTableData.groups.map((group, groupIdx) => (
                <React.Fragment key={groupIdx}>
                  {/* Group Header */}
                  <tr className="bg-gray-100">
                    <td className="sticky left-0 bg-gray-100 px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap z-10">
                      {group.label}
                    </td>
                    {group.subtotal.map((cell, cellIdx) => {
                      const month = paidMessagesTableData.months[cellIdx];
                      return (
                        <td
                          key={cellIdx}
                          className={`px-4 py-3 text-sm text-gray-900 text-center whitespace-nowrap font-medium ${month?.is_current ? 'bg-blue-100' : ''
                            }`}
                        >
                          {cell.count}({Math.round(cell.percentage)}%)
                        </td>
                      );
                    })}
                  </tr>
                  {/* Events in this group */}
                  {group.events.map((event, eventIdx) => (
                    <tr key={eventIdx}>
                      <td className="sticky left-0 bg-white px-4 py-3 pl-8 text-sm text-gray-900 whitespace-nowrap z-10">
                        {event.displayName}
                      </td>
                      {event.data.map((cell, cellIdx) => {
                        const month = paidMessagesTableData.months[cellIdx];
                        return (
                          <td
                            key={cellIdx}
                            className={`px-4 py-3 text-sm text-gray-900 text-center whitespace-nowrap ${month?.is_current ? 'bg-blue-50' : ''
                              }`}
                          >
                            {cell.count}({Math.round(cell.percentage)}%)
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Subtotal row */}
                  <tr className="bg-gray-50">
                    <td className="sticky left-0 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap z-10">
                      {group.label} 小計
                    </td>
                    {group.subtotal.map((cell, cellIdx) => {
                      const month = paidMessagesTableData.months[cellIdx];
                      return (
                        <td
                          key={cellIdx}
                          className={`px-4 py-3 text-sm text-gray-900 text-center whitespace-nowrap font-medium ${month?.is_current ? 'bg-blue-100' : ''
                            }`}
                        >
                          {cell.count}({Math.round(cell.percentage)}%)
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              ))}
              {/* Grand Total */}
              <tr className="bg-blue-50">
                <td className="sticky left-0 bg-blue-50 px-4 py-3 text-sm font-bold text-gray-900 whitespace-nowrap z-10">
                  總計
                </td>
                {paidMessagesTableData.grandTotal.map((cell, cellIdx) => {
                  const month = paidMessagesTableData.months[cellIdx];
                  return (
                    <td
                      key={cellIdx}
                      className={`px-4 py-3 text-sm text-gray-900 text-center whitespace-nowrap font-bold ${month?.is_current ? 'bg-blue-100' : ''
                        }`}
                    >
                      {cell.count}({Math.round(cell.percentage)}%)
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Reply Messages Table */}
      <div className="overflow-x-auto">
        <div className="flex items-center gap-2 mb-4">
          <p className="text-sm font-medium text-gray-700">AI 回覆訊息</p>
          <button
            type="button"
            onClick={() => setShowAiRepliesModal(true)}
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
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap z-10">
                  訊息類型
                </th>
                {aiRepliesTableData.months.map((month) => (
                  <th
                    key={`${month.year}-${month.month}`}
                    className={`px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap ${month.is_current ? 'bg-blue-50' : ''
                      }`}
                  >
                    {month.display_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              <tr>
                <td className="sticky left-0 bg-white px-4 py-3 text-sm text-gray-900 whitespace-nowrap z-10">
                  AI 回覆訊息
                </td>
                {aiRepliesTableData.data.map((cell, cellIdx) => {
                  const month = aiRepliesTableData.months[cellIdx];
                  return (
                    <td
                      key={cellIdx}
                      className={`px-4 py-3 text-sm text-gray-900 text-center whitespace-nowrap ${month?.is_current ? 'bg-blue-50' : ''
                        }`}
                    >
                      {cell.count}({Math.round(cell.percentage)}%)
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Paid Messages Info Modal */}
      {showPaidMessagesModal && (
        <BaseModal onClose={() => setShowPaidMessagesModal(false)} aria-label="LINE 推播訊息說明">
          <ModalHeader title="LINE 推播訊息" showClose onClose={() => setShowPaidMessagesModal(false)} />
          <ModalBody>
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
                <div className="text-sm text-gray-700 space-y-2">
                  <p>LINE 推播訊息由 LINE 平台收費，診所需自行負擔相關費用。</p>
                  <p>若 LINE 訊息配額用盡，系統將無法發送推播訊息，但預約系統仍可正常運作。</p>
                </div>
              </div>
            </div>
          </ModalBody>
        </BaseModal>
      )}

      {/* AI Replies Info Modal */}
      {showAiRepliesModal && (
        <BaseModal onClose={() => setShowAiRepliesModal(false)} aria-label="AI 回覆訊息說明">
          <ModalHeader title="AI 回覆訊息" showClose onClose={() => setShowAiRepliesModal(false)} />
          <ModalBody>
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
                <div className="text-sm text-gray-700 space-y-2">
                  <p>AI 回覆訊息不會消耗 LINE 訊息配額。</p>
                </div>
              </div>
            </div>
          </ModalBody>
        </BaseModal>
      )}
    </div>
  );
};

