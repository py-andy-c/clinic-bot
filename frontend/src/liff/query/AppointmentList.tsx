import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { checkCancellationConstraint } from '../../utils/appointmentConstraints';
import { logger } from '../../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../../components/shared';
import { liffApiService } from '../../services/liffApi';
import AppointmentCard from './AppointmentCard';
import { useModal } from '../../contexts/ModalContext';
import { useLiffBackButton } from '../../hooks/useLiffBackButton';
import { LanguageSelector } from '../components/LanguageSelector';
import { PageInstructions } from '../components/PageInstructions';
import { useAppointmentStore } from '../../stores/appointmentStore';
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
  const queryPageInstructions = useAppointmentStore(state => state.queryPageInstructions);
  const { alert: showAlert, confirm: showConfirm } = useModal();
  const [activeTab, setActiveTab] = useState<TabType>("future");
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minimumCancellationHours, setMinimumCancellationHours] = useState<number | null>(null);
  const [allowPatientDeletion, setAllowPatientDeletion] = useState<boolean>(true);
  const [viewingReceipt, setViewingReceipt] = useState<{ appointmentId: number; receiptId: number } | null>(null);
  const [receiptHtml, setReceiptHtml] = useState<string | null>(null);
  const [isLoadingReceipt, setIsLoadingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const scrollYRef = useRef<number>(0);

  // Enable back button navigation - always goes back to home
  useLiffBackButton('query');

  // Prevent body scroll when receipt modal is open (prevents background scrolling)
  useEffect(() => {
    if (!viewingReceipt) {
      return;
    }

    // Save current scroll position
    scrollYRef.current = window.scrollY;
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalTop = document.body.style.top;
    const originalWidth = document.body.style.width;

    // Fix body position to prevent scrolling (iOS Safari solution)
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollYRef.current}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';

    return () => {
      // Restore original styles
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      document.body.style.width = originalWidth;
      document.body.style.overflow = originalOverflow;

      // Restore scroll position
      window.scrollTo(0, scrollYRef.current);
    };
  }, [viewingReceipt]);

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

  const loadAppointments = useCallback(async () => {
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
  }, [t]);

  useEffect(() => {
    loadAppointments();
    loadClinicInfo();
  }, [loadAppointments]);

  // Filter appointments by tab
  // Get current time in Taiwan timezone for comparisons
  const nowInTaiwan = moment.tz(TAIWAN_TIMEZONE);
  
  // Calculate counts and filter appointments for all tabs
  // All times are interpreted as Taiwan time
  // Memoize filtered arrays to prevent unnecessary re-renders
  // Note: nowInTaiwan is intentionally excluded from dependencies as it changes every render
  // and would defeat the purpose of memoization. The filtered arrays will update when allAppointments changes.
  // allAppointments is a state variable (stable), so the warning about logical expression is a false positive.
  const futureAppointments = useMemo(() => allAppointments
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
    }), [allAppointments]); // eslint-disable-line react-hooks/exhaustive-deps
  const pastAppointments = useMemo(() => allAppointments
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
    }), [allAppointments]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancelledAppointments = useMemo(() => allAppointments
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
    }), [allAppointments]);

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
      const axiosError = err as { response?: { data?: { detail?: string | { error?: string; minimum_hours?: number } } }; message?: string };
      const errorDetail = axiosError?.response?.data?.detail;
      if (errorDetail && typeof errorDetail === 'object' && errorDetail.error === 'cancellation_too_soon') {
        // Use structured error response
        const hours = errorDetail.minimum_hours || 24;
        await showAlert(t('appointment.errors.cancelTooSoon', { hours }), t('appointment.cancelFailedTitle'));
      } else {
        // Fallback: try to extract from error message (for backward compatibility)
        const errorMessage = (typeof errorDetail === 'string' ? errorDetail : (typeof errorDetail === 'object' ? String(errorDetail) : axiosError?.response?.data?.detail || axiosError?.message || '')) as string;
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
      // Get receipt ID first to set viewing state
      const receipt = await liffApiService.getAppointmentReceipt(appointmentId);
      setViewingReceipt({ appointmentId, receiptId: receipt.receipt_id });
      
      // Fetch HTML for display
      const html = await liffApiService.getAppointmentReceiptHtml(appointmentId);
      setReceiptHtml(html);
    } catch (err) {
      logger.error('Failed to load receipt:', err);
      setReceiptError(t('receipt.errors.loadFailed', '無法載入收據'));
      await showAlert(
        t('receipt.errors.loadFailed', '無法載入收據'),
        t('receipt.errors.title', '錯誤')
      );
      setViewingReceipt(null);
    } finally {
      setIsLoadingReceipt(false);
    }
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

        <PageInstructions instructions={queryPageInstructions} />

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
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-0">
            <div className="bg-white w-full h-full flex flex-col">
              {/* Header */}
              <div className="sticky top-0 bg-white border-b px-4 py-3 flex justify-between items-center z-10">
                <h2 className="text-lg font-bold">{t('receipt.title', '收據')}</h2>
                <button
                  onClick={() => {
                    setViewingReceipt(null);
                    setReceiptHtml(null);
                    setReceiptError(null);
                  }}
                  className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                  aria-label={t('common.cancel')}
                >
                  ✕
                </button>
              </div>
              
              {/* Content */}
              <div className="flex-1 overflow-hidden">
                {isLoadingReceipt ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <p className="text-gray-600">{t('receipt.loading', '載入中...')}</p>
                    </div>
                  </div>
                ) : receiptError ? (
                  <div className="flex items-center justify-center h-full p-4">
                    <div className="bg-red-50 border border-red-200 rounded-md p-4 max-w-md">
                      <p className="text-sm text-red-800">{receiptError}</p>
                    </div>
                  </div>
                ) : receiptHtml ? (
                  <iframe
                    srcDoc={receiptHtml}
                    className="w-full h-full border-0"
                    title={t('receipt.title', '收據')}
                    sandbox="allow-same-origin"
                  />
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
