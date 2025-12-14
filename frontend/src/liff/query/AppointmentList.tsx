import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { checkCancellationConstraint } from '../../utils/appointmentConstraints';
import { logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/currencyUtils';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { liffApiService } from '../../services/liffApi';
import AppointmentCard from './AppointmentCard';
import { useModal } from '../../contexts/ModalContext';
import { useLiffBackButton } from '../../hooks/useLiffBackButton';
import { LanguageSelector } from '../components/LanguageSelector';
import moment from 'moment-timezone';

const TAIWAN_TIMEZONE = "Asia/Taipei";

interface Appointment {
  id: number;
  patient_id: number;
  patient_name: string;
  practitioner_name: string;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: 'confirmed' | 'canceled_by_patient' | 'canceled_by_clinic';
  notes?: string;
  has_active_receipt?: boolean; // Whether appointment has an active (non-voided) receipt
  has_any_receipt?: boolean; // Whether appointment has any receipt (active or voided)
  receipt_id?: number | null; // ID of active receipt (null if no active receipt)
  receipt_ids?: number[]; // List of all receipt IDs (always included, empty if none)
}

type TabType = "future" | "past" | "cancelled";

const AppointmentList: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { alert: showAlert, confirm: showConfirm } = useModal();
  const [activeTab, setActiveTab] = useState<TabType>("future");
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minimumCancellationHours, setMinimumCancellationHours] = useState<number | null>(null);
  const [allowPatientDeletion, setAllowPatientDeletion] = useState<boolean>(true);
  const [viewingReceipt, setViewingReceipt] = useState<{ appointmentId: number; receiptId: number } | null>(null);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [isLoadingReceipt, setIsLoadingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [isDownloadingPDF, setIsDownloadingPDF] = useState(false);

  // Enable back button navigation - always goes back to home
  useLiffBackButton('query');

  useEffect(() => {
    loadAppointments();
    loadClinicInfo();
  }, []);

  const loadClinicInfo = async () => {
    try {
      const clinicInfo = await liffApiService.getClinicInfo();
      setMinimumCancellationHours(clinicInfo.minimum_cancellation_hours_before || 24);
      setAllowPatientDeletion(clinicInfo.allow_patient_deletion ?? true);
    } catch (err) {
      logger.error('Failed to load clinic info:', err);
      // Use default if failed to load (defaulting to true for better UX - allows cancellation)
      setMinimumCancellationHours(24);
      setAllowPatientDeletion(true);
    }
  };

  const loadAppointments = async () => {
    try {
      setIsLoading(true);
      setError(null);
      // Load all appointments (not just upcoming) for tabbed interface
      const response = await liffApiService.getAppointments(false); // all appointments
      setAllAppointments(response.appointments);
    } catch (err) {
      logger.error('Failed to load appointments:', err);
      setError(t('query.errors.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  // Filter appointments by tab
  // Get current time in Taiwan timezone for comparisons
  const nowInTaiwan = moment.tz(TAIWAN_TIMEZONE);
  
  // Calculate counts and filter appointments for all tabs
  // All times are interpreted as Taiwan time
  const futureAppointments = allAppointments
    .filter((apt) => {
      const startTime = moment.tz(apt.start_time, TAIWAN_TIMEZONE);
      // Use isSameOrAfter to include appointments happening exactly "now"
      return startTime.isSameOrAfter(nowInTaiwan) && apt.status === "confirmed";
    })
    .sort((a, b) => {
      // Sort from sooner to further (ascending by start_time)
      const timeA = moment.tz(a.start_time, TAIWAN_TIMEZONE);
      const timeB = moment.tz(b.start_time, TAIWAN_TIMEZONE);
      return timeA.valueOf() - timeB.valueOf();
    });
  const pastAppointments = allAppointments
    .filter((apt) => {
      const startTime = moment.tz(apt.start_time, TAIWAN_TIMEZONE);
      // Use isBefore to exclude appointments happening exactly "now" (they appear in future)
      return startTime.isBefore(nowInTaiwan) && apt.status === "confirmed";
    })
    .sort((a, b) => {
      // Sort from newest to oldest (descending by start_time) to match patient detail page
      const timeA = moment.tz(a.start_time, TAIWAN_TIMEZONE);
      const timeB = moment.tz(b.start_time, TAIWAN_TIMEZONE);
      return timeB.valueOf() - timeA.valueOf();
    });
  const cancelledAppointments = allAppointments
    .filter(
      (apt) =>
        apt.status === "canceled_by_patient" ||
        apt.status === "canceled_by_clinic",
    )
    .sort((a, b) => {
      // Sort from newest to oldest (descending by start_time) to match patient detail page
      const timeA = moment.tz(a.start_time, TAIWAN_TIMEZONE);
      const timeB = moment.tz(b.start_time, TAIWAN_TIMEZONE);
      return timeB.valueOf() - timeA.valueOf();
    });

  const displayAppointments =
    activeTab === "future"
      ? futureAppointments
      : activeTab === "past"
        ? pastAppointments
        : cancelledAppointments;


  const handleCancelAppointment = async (appointmentId: number, appointmentStartTime: string) => {
    // Check constraint immediately before showing confirmation
    if (!checkCancellationConstraint(appointmentStartTime, minimumCancellationHours)) {
      await showAlert(
        t('appointment.errors.cancelTooSoon', { hours: minimumCancellationHours || 24 }),
        t('appointment.cancelFailedTitle')
      );
      return;
    }

    const confirmed = await showConfirm(t('appointment.cancelConfirm'), t('appointment.cancelConfirmTitle'));

    if (!confirmed) return;

    try {
      await liffApiService.cancelAppointment(appointmentId);
      // Refresh the list
      loadAppointments();
    } catch (err: unknown) {
      logger.error('Failed to cancel appointment:', err);
      
      // Check for structured error response (fallback in case constraint changed)
      const errorDetail = (err as any)?.response?.data?.detail;
      if (errorDetail && typeof errorDetail === 'object' && errorDetail.error === 'cancellation_too_soon') {
        // Use structured error response
        const hours = errorDetail.minimum_hours || 24;
        await showAlert(t('appointment.errors.cancelTooSoon', { hours }), t('appointment.cancelFailedTitle'));
      } else {
        // Fallback: try to extract from error message (for backward compatibility)
        const errorMessage = typeof errorDetail === 'string' ? errorDetail : (err as any)?.response?.data?.detail || (err as any)?.message || '';
        // Check for numeric pattern that works across languages
        const hoursMatch = errorMessage.match(/(\d+)/);
        if (hoursMatch && (
          errorMessage.includes('取消') || 
          errorMessage.includes('cancel') || 
          errorMessage.includes('キャンセル')
        )) {
          const hours = hoursMatch[1];
          await showAlert(t('appointment.errors.cancelTooSoon', { hours }), t('appointment.cancelFailedTitle'));
        } else {
          await showAlert(t('appointment.errors.cancelFailed'), t('appointment.cancelFailedTitle'));
        }
      }
    }
  };

  const handleRescheduleAppointment = async (appointmentId: number, appointmentStartTime: string) => {
    // Check constraint immediately before navigating to reschedule page
    if (!checkCancellationConstraint(appointmentStartTime, minimumCancellationHours)) {
      await showAlert(
        t('appointment.errors.rescheduleTooSoon', { hours: minimumCancellationHours || 24 }),
        t('appointment.rescheduleFailedTitle')
      );
      return;
    }

    // Navigate to reschedule page only if constraint passes
    navigate(`/liff?mode=reschedule&appointmentId=${appointmentId}`);
  };

  const handleViewReceipt = async (appointmentId: number) => {
    setIsLoadingReceipt(true);
    setReceiptError(null);
    try {
      const receipt = await liffApiService.getAppointmentReceipt(appointmentId);
      setReceiptData(receipt);
      setViewingReceipt({ appointmentId, receiptId: receipt.receipt_id });
    } catch (err) {
      logger.error('Failed to load receipt:', err);
      setReceiptError(t('receipt.errors.loadFailed', '無法載入收據'));
      await showAlert(
        t('receipt.errors.loadFailed', '無法載入收據'),
        t('receipt.errors.title', '錯誤')
      );
    } finally {
      setIsLoadingReceipt(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!receiptData?.receipt_id) {
      await showAlert('無法下載：缺少收據ID', '錯誤');
      return;
    }

    setIsDownloadingPDF(true);
    try {
      // Use direct fetch with LIFF JWT token from localStorage
      const token = localStorage.getItem('liff_jwt_token');
      if (!token) {
        throw new Error('No authentication token');
      }

      const apiBaseUrl = process.env.REACT_APP_API_URL || '';
      const response = await fetch(
        `${apiBaseUrl}/receipts/${receiptData.receipt_id}/download`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to download PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt_${receiptData.receipt_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      logger.error('Error downloading PDF:', err);
      await showAlert('下載失敗，請重試', '錯誤');
    } finally {
      setIsDownloadingPDF(false);
    }
  };

  // Use the shared currency utility for consistent formatting

  const formatPaymentMethod = (method: string): string => {
    const mapping: Record<string, string> = {
      'cash': '現金',
      'card': '刷卡',
      'transfer': '轉帳',
      'other': '其他'
    };
    return mapping[method] || method;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          {/* Title with language selector inline */}
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold text-gray-900">
              {t('query.title')}
            </h1>
            <LanguageSelector />
          </div>
          <p className="text-sm text-gray-500 mb-6">
            {t('home.manageAppointmentsDesc')}
          </p>
          
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          {/* Title with language selector inline */}
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold text-gray-900">
              {t('query.title')}
            </h1>
            <LanguageSelector />
          </div>
          <p className="text-sm text-gray-500 mb-6">
            {t('home.manageAppointmentsDesc')}
          </p>
          
          <div className="my-8">
            <ErrorMessage message={error} onRetry={loadAppointments} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto">
        {/* Title with language selector inline */}
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-900">
            {t('query.title')}
          </h1>
          <LanguageSelector />
        </div>
        <p className="text-sm text-gray-500 mb-6">
          {t('home.manageAppointmentsDesc')}
        </p>

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab("future")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === "future"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {t('appointments.tabs.future', '未來')} ({futureAppointments.length})
          </button>
          <button
            onClick={() => setActiveTab("past")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === "past"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {t('appointments.tabs.past', '過去')} ({pastAppointments.length})
          </button>
          <button
            onClick={() => setActiveTab("cancelled")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === "cancelled"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {t('appointments.tabs.cancelled', '已取消')} ({cancelledAppointments.length})
          </button>
        </div>

        {displayAppointments.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 text-6xl mb-4">📅</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {t('query.noAppointments')}
            </h3>
            <p className="text-gray-600 mb-6">
              {t('query.noAppointmentsDesc')}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {displayAppointments.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                onCancel={() => handleCancelAppointment(appointment.id, appointment.start_time)}
                onReschedule={() => handleRescheduleAppointment(appointment.id, appointment.start_time)}
                allowPatientDeletion={allowPatientDeletion}
                onViewReceipt={appointment.has_active_receipt ? () => handleViewReceipt(appointment.id) : undefined}
              />
            ))}
          </div>
        )}

        {/* Receipt View Modal */}
        {viewingReceipt && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
                <h2 className="text-xl font-bold">{t('receipt.title', '收據')}</h2>
                <button
                  onClick={() => {
                    setViewingReceipt(null);
                    setReceiptData(null);
                    setReceiptError(null);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
              <div className="p-6">
                {isLoadingReceipt ? (
                  <p className="text-gray-600">{t('receipt.loading', '載入中...')}</p>
                ) : receiptError ? (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-sm text-red-800">{receiptError}</p>
                  </div>
                ) : receiptData ? (
                  <div className="space-y-4">
                    {/* Receipt Details */}
                    <div className="space-y-2">
                      <p><strong>收據編號:</strong> {receiptData.receipt_number}</p>
                      {receiptData.visit_date && (
                        <p><strong>看診日期:</strong> {new Date(receiptData.visit_date).toLocaleString('zh-TW')}</p>
                      )}
                      {receiptData.issue_date && (
                        <p><strong>開立日期:</strong> {new Date(receiptData.issue_date).toLocaleString('zh-TW')}</p>
                      )}
                      {receiptData.clinic?.display_name && (
                        <p><strong>診所名稱:</strong> {receiptData.clinic.display_name}</p>
                      )}
                      {receiptData.patient?.name && (
                        <p><strong>病患姓名:</strong> {receiptData.patient.name}</p>
                      )}
                    </div>

                    {/* Items */}
                    {receiptData.items && receiptData.items.length > 0 && (
                      <div>
                        <strong>項目:</strong>
                        <div className="mt-2 space-y-1">
                          {receiptData.items.map((item: any, index: number) => {
                            const itemName = item.item_type === 'service_item' 
                              ? (item.service_item?.receipt_name || item.service_item?.name || '')
                              : (item.item_name || '');
                            const quantity = item.quantity || 1;
                            const totalAmount = item.amount * quantity;
                            
                            return (
                              <div key={index} className="flex justify-between text-sm">
                                <span>
                                  {itemName}
                                  {quantity > 1 && ` (x${quantity})`}
                                  {item.practitioner?.name && ` (${item.practitioner.name})`}
                                </span>
                                <span>{formatCurrency(totalAmount)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Totals */}
                    <div className="border-t border-gray-200 pt-2 space-y-1">
                      <div className="flex justify-between font-semibold">
                        <span>總費用:</span>
                        <span>{formatCurrency(receiptData.total_amount)}</span>
                      </div>
                    </div>

                    {/* Payment Method */}
                    {receiptData.payment_method && (
                      <p><strong>付款方式:</strong> {formatPaymentMethod(receiptData.payment_method)}</p>
                    )}

                    {/* Custom Notes */}
                    {receiptData.custom_notes && (
                      <div>
                        <strong>收據備註:</strong>
                        <p className="text-sm text-gray-700 whitespace-pre-line mt-1">
                          {receiptData.custom_notes}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-200">
                      <button
                        onClick={handleDownloadPDF}
                        disabled={isDownloadingPDF}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isDownloadingPDF ? '下載中...' : '下載收據 PDF'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AppointmentList;
