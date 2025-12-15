/**
 * Accounting Dashboard Page
 * 
 * Admin-only page for viewing accounting statistics, revenue reports, and managing receipts.
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { LoadingSpinner } from '../components/shared';
import PageHeader from '../components/PageHeader';
import { ReceiptViewModal } from '../components/calendar/ReceiptViewModal';
import { formatCurrency } from '../utils/currencyUtils';
import moment from 'moment-timezone';

const AccountingDashboardPage: React.FC = () => {
  const { isClinicAdmin, isLoading: authLoading } = useAuth();
  const [startDate, setStartDate] = useState<string>(moment().startOf('month').format('YYYY-MM-DD'));
  const [endDate, setEndDate] = useState<string>(moment().endOf('month').format('YYYY-MM-DD'));
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<number | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [voidedReceipts, setVoidedReceipts] = useState<any[]>([]);
  const [receiptNumberStatus, setReceiptNumberStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [practitioners, setPractitioners] = useState<Array<{ id: number; full_name: string }>>([]);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);
  const [showVoidedOnly, setShowVoidedOnly] = useState(false);
  const [selectedPractitionerForDetails, setSelectedPractitionerForDetails] = useState<number | null>(null);
  const [practitionerDetails, setPractitionerDetails] = useState<any>(null);
  const [loadingPractitionerDetails, setLoadingPractitionerDetails] = useState(false);

  // Load practitioners
  useEffect(() => {
    if (isClinicAdmin) {
      loadPractitioners();
    }
  }, [isClinicAdmin]);

  // Load data when filters change
  useEffect(() => {
    if (isClinicAdmin && startDate && endDate) {
      loadData();
    }
  }, [isClinicAdmin, startDate, endDate, selectedPractitionerId]);

  // Load receipt number status
  useEffect(() => {
    if (isClinicAdmin) {
      loadReceiptNumberStatus();
    }
  }, [isClinicAdmin]);

  const loadPractitioners = async () => {
    try {
      const members = await apiService.getMembers();
      const practitioners = members.filter(m => m.roles.includes('practitioner'));
      setPractitioners(practitioners);
    } catch (err) {
      logger.error('Error loading practitioners:', err);
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, voidedData] = await Promise.all([
        apiService.getAccountingSummary(
          startDate,
          endDate,
          selectedPractitionerId || undefined
        ),
        apiService.getVoidedReceipts(startDate, endDate)
      ]);
      setSummary(summaryData);
      setVoidedReceipts(voidedData.voided_receipts || []);
    } catch (err: any) {
      logger.error('Error loading accounting data:', err);
      setError(err.response?.data?.detail || '無法載入會計資料');
    } finally {
      setLoading(false);
    }
  };

  const loadReceiptNumberStatus = async () => {
    try {
      const status = await apiService.getReceiptNumberStatus();
      setReceiptNumberStatus(status);
    } catch (err) {
      logger.error('Error loading receipt number status:', err);
    }
  };

  const loadPractitionerDetails = async (practitionerId: number) => {
    setLoadingPractitionerDetails(true);
    setError(null);
    try {
      const details = await apiService.getPractitionerAccountingDetails(
        practitionerId,
        startDate,
        endDate
      );
      setPractitionerDetails(details);
      setSelectedPractitionerForDetails(practitionerId);
    } catch (err: any) {
      logger.error('Error loading practitioner details:', err);
      setError(err.response?.data?.detail || '無法載入治療師明細');
    } finally {
      setLoadingPractitionerDetails(false);
    }
  };

  if (authLoading) {
    return <LoadingSpinner size="xl" fullScreen />;
  }

  if (!isClinicAdmin) {
    return (
      <div className="space-y-8">
        <PageHeader title="會計儀表板" />
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-6 text-center">
          <h3 className="text-lg font-medium text-yellow-800 mb-2">無權限存取</h3>
          <p className="text-yellow-700">只有診所管理員可以查看會計資料。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="會計儀表板" />

      {/* Receipt Number Status Warning */}
      {receiptNumberStatus && (receiptNumberStatus.is_warning || receiptNumberStatus.is_critical) && (
        <div className={`border rounded-lg p-4 md:p-6 ${
          receiptNumberStatus.is_critical 
            ? 'bg-red-50 border-red-300' 
            : 'bg-yellow-50 border-yellow-300'
        }`}>
          <div className="flex items-center">
            <span className="text-xl mr-2">
              {receiptNumberStatus.is_critical ? '⚠️' : '⚠️'}
            </span>
            <div>
              <p className={`font-semibold ${
                receiptNumberStatus.is_critical ? 'text-red-800' : 'text-yellow-800'
              }`}>
                {receiptNumberStatus.is_critical ? '收據編號即將用盡' : '收據編號接近上限'}
              </p>
              <p className={`text-sm ${
                receiptNumberStatus.is_critical ? 'text-red-700' : 'text-yellow-700'
              }`}>
                {receiptNumberStatus.current_year} 年已使用 {receiptNumberStatus.current_year_receipt_count.toLocaleString()} 個收據編號
                （剩餘 {receiptNumberStatus.remaining_capacity.toLocaleString()} 個）
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm p-2 md:p-4 mb-6 pb-6 border-b border-gray-200 md:mb-0 md:pb-0 md:border-b-0">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              開始日期
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              結束日期
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              治療師
            </label>
            <select
              value={selectedPractitionerId || ''}
              onChange={(e) => setSelectedPractitionerId(e.target.value ? parseInt(e.target.value) : null)}
              className="input"
            >
              <option value="">全部</option>
              {practitioners.map(p => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setStartDate(moment().startOf('month').format('YYYY-MM-DD'));
                setEndDate(moment().endOf('month').format('YYYY-MM-DD'));
                setSelectedPractitionerId(null);
              }}
              className="btn-secondary w-full"
            >
              重置
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : summary && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 pb-6 border-b border-gray-200 md:mb-0 md:pb-0 md:border-b-0">
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 md:p-6">
              <p className="text-sm text-gray-600 mb-1">總收入</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatCurrency(summary.summary.total_revenue)}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 md:p-6">
              <p className="text-sm text-gray-600 mb-1">總診所分潤</p>
              <p className="text-2xl font-semibold text-blue-600">
                {formatCurrency(summary.summary.total_revenue_share)}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 md:p-6">
              <p className="text-sm text-gray-600 mb-1">收據數量</p>
              <p className="text-2xl font-semibold text-gray-900">
                {summary.summary.receipt_count}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 md:p-6">
              <p className="text-sm text-gray-600 mb-1">作廢收據</p>
              <p className="text-2xl font-semibold text-red-600">
                {summary.summary.voided_receipt_count}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm">
            <div className="border-b border-gray-200">
              <nav className="flex -mb-px">
                <button
                  onClick={() => setShowVoidedOnly(false)}
                  className={`px-3 py-2 md:px-6 md:py-3 text-sm font-medium border-b-2 ${
                    !showVoidedOnly
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  收入統計
                </button>
                <button
                  onClick={() => setShowVoidedOnly(true)}
                  className={`px-3 py-2 md:px-6 md:py-3 text-sm font-medium border-b-2 ${
                    showVoidedOnly
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  作廢收據 ({voidedReceipts.length})
                </button>
              </nav>
            </div>

            <div className="p-0 md:p-6">
              {showVoidedOnly ? (
                /* Voided Receipts Tab */
                <div className="space-y-4">
                  {voidedReceipts.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">無作廢收據</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">收據編號</th>
                            <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">開立日期</th>
                            <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">作廢日期</th>
                            <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">病患姓名</th>
                            <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">金額</th>
                            <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">作廢者</th>
                            <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {voidedReceipts.map((receipt) => (
                            <tr key={receipt.receipt_id}>
                              <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-900">{receipt.receipt_number}</td>
                              <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-500">
                                {moment(receipt.issue_date).tz('Asia/Taipei').format('YYYY-MM-DD')}
                              </td>
                              <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-500">
                                {receipt.voided_at ? moment(receipt.voided_at).tz('Asia/Taipei').format('YYYY-MM-DD HH:mm') : '-'}
                              </td>
                              <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-900">{receipt.patient_name}</td>
                              <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-900">
                                {formatCurrency(receipt.total_amount)}
                              </td>
                              <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-500">{receipt.voided_by_user_name || '-'}</td>
                              <td className="px-2 py-2 md:px-4 md:py-3 text-sm">
                                <button
                                  onClick={() => {
                                    // Find appointment_id from receipt
                                    // For now, we'll need to get it from the receipt view
                                    // This is a simplified version - in production, you'd fetch the receipt to get appointment_id
                                    setSelectedReceiptId(receipt.receipt_id);
                                  }}
                                  className="text-blue-600 hover:text-blue-800"
                                >
                                  檢視
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                /* Revenue Statistics Tab */
                <div className="space-y-6">
                  {/* By Practitioner */}
                  {summary.by_practitioner && summary.by_practitioner.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold mb-4">依治療師</h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">治療師</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">總收入</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">總診所分潤</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">收據數</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {summary.by_practitioner.map((stat: any) => (
                              <tr key={stat.practitioner_id}>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm font-medium text-gray-900">
                                  <button
                                    onClick={() => loadPractitionerDetails(stat.practitioner_id)}
                                    className="text-blue-600 hover:text-blue-800 hover:underline"
                                  >
                                    {stat.practitioner_name}
                                  </button>
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-900 text-right">
                                  {formatCurrency(stat.total_revenue)}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-blue-600 text-right">
                                  {formatCurrency(stat.total_revenue_share)}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-500 text-right">{stat.receipt_count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* By Service Item */}
                  {summary.by_service_item && summary.by_service_item.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold mb-4">依服務項目</h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">服務項目</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">總收入</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">總診所分潤</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">項目數</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {summary.by_service_item.map((stat: any) => (
                              <tr key={stat.service_item_id}>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm font-medium text-gray-900">
                                  {stat.receipt_name || stat.service_item_name}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-900 text-right">
                                  {formatCurrency(stat.total_revenue)}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-blue-600 text-right">
                                  {formatCurrency(stat.total_revenue_share)}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-500 text-right">{stat.item_count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Receipt View Modal */}
      {selectedReceiptId && (
        <ReceiptViewModal
          receiptId={selectedReceiptId}
          onClose={() => setSelectedReceiptId(null)}
          onReceiptVoided={async () => {
            await loadData();
            await loadReceiptNumberStatus();
          }}
          isAdmin={isClinicAdmin}
        />
      )}

      {/* Practitioner Details Modal */}
      {selectedPractitionerForDetails && practitionerDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">
                  {practitionerDetails.practitioner.name} - 會計明細
                </h2>
                <button
                  onClick={() => {
                    setSelectedPractitionerForDetails(null);
                    setPractitionerDetails(null);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              {loadingPractitionerDetails ? (
                <div className="flex justify-center py-8">
                  <LoadingSpinner />
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600 mb-1">總收入</p>
                      <p className="text-xl font-semibold">
                        {formatCurrency(practitionerDetails.summary.total_revenue)}
                      </p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600 mb-1">總診所分潤</p>
                      <p className="text-xl font-semibold text-blue-600">
                        {formatCurrency(practitionerDetails.summary.total_revenue_share)}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600 mb-1">收據數</p>
                      <p className="text-xl font-semibold">
                        {practitionerDetails.summary.receipt_count}
                      </p>
                    </div>
                  </div>

                  {/* Items Table */}
                  {practitionerDetails.items && practitionerDetails.items.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold mb-3">明細項目</h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">收據編號</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">預約日期</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">病患</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">服務項目</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">計費方案</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">金額</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">診所分潤</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {practitionerDetails.items.map((item: any, idx: number) => (
                              <tr key={idx}>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-900">{item.receipt_number}</td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-500">
                                  {item.visit_date || (item.issue_date ? moment(item.issue_date).tz('Asia/Taipei').format('YYYY-MM-DD') : '-')}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-900">{item.patient_name}</td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-900">
                                  {item.service_item?.receipt_name || item.service_item?.name || '-'}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-500">
                                  {item.billing_scenario?.name || '-'}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-900 text-right">
                                  {formatCurrency(item.amount)}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-blue-600 text-right">
                                  {formatCurrency(item.revenue_share)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* By Service Item Summary */}
                  {practitionerDetails.by_service_item && practitionerDetails.by_service_item.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold mb-3">依服務項目</h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-left text-xs font-medium text-gray-500 uppercase">服務項目</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">總收入</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">總診所分潤</th>
                              <th className="px-2 py-2 md:px-4 md:py-3 text-right text-xs font-medium text-gray-500 uppercase">項目數</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {practitionerDetails.by_service_item.map((stat: any) => (
                              <tr key={stat.service_item_id}>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm font-medium text-gray-900">
                                  {stat.receipt_name || stat.service_item_name}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-900 text-right">
                                  {formatCurrency(stat.total_revenue)}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-blue-600 text-right">
                                  {formatCurrency(stat.total_revenue_share)}
                                </td>
                                <td className="px-2 py-2 md:px-4 md:py-3 text-sm text-gray-500 text-right">{stat.item_count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountingDashboardPage;


