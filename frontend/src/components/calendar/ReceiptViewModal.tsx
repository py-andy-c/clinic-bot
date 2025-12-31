/**
 * ReceiptViewModal Component
 * 
 * Modal for viewing receipt details and actions (download PDF, void receipt).
 * Displays the full receipt HTML in an iframe to match the PDF exactly.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { BaseModal } from './BaseModal';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { Z_INDEX } from '../../constants/app';

interface ReceiptViewModalProps {
  appointmentId?: number;
  receiptId?: number;
  onClose: () => void;
  onReceiptVoided?: () => void;
  isClinicUser: boolean;
}

export const ReceiptViewModal: React.FC<ReceiptViewModalProps> = ({
  appointmentId,
  receiptId,
  onClose,
  onReceiptVoided,
  isClinicUser,
}) => {
  const [receiptHtml, setReceiptHtml] = useState<string | null>(null);
  interface ReceiptInfo {
    receipt_id: number;
    void_info?: {
      voided: boolean;
      reason?: string;
      voided_at?: string;
      voided_by?: {
        name?: string;
        email?: string;
      };
    };
  }
  const [receiptInfo, setReceiptInfo] = useState<ReceiptInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const loadReceipt = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let targetReceiptId: number | undefined;
      
      // Determine receipt ID
      if (receiptId) {
        targetReceiptId = receiptId;
      } else if (appointmentId) {
        // Get receipt for appointment first to get receipt ID
        const receiptData = await apiService.getReceiptForAppointment(appointmentId);
        targetReceiptId = receiptData.receipt_id;
      } else {
        setError('缺少收據ID或預約ID');
        setIsLoading(false);
        return;
      }

      if (!targetReceiptId) {
        setError('無法取得收據ID');
        setIsLoading(false);
        return;
      }

      // Fetch both HTML and basic receipt info in parallel
      const [html, receiptData] = await Promise.all([
        apiService.getReceiptHtml(targetReceiptId),
        apiService.getReceiptById(targetReceiptId),
      ]);

      setReceiptHtml(html);
      setReceiptInfo(receiptData);
    } catch (err: unknown) {
      logger.error('Error loading receipt:', err);
      setError('無法載入收據資料');
    } finally {
      setIsLoading(false);
    }
  }, [appointmentId, receiptId]);

  useEffect(() => {
    loadReceipt();
  }, [appointmentId, receiptId, loadReceipt]);

  const handleDownloadPDF = async () => {
    const targetReceiptId = receiptId || receiptInfo?.receipt_id;
    
    if (!targetReceiptId) {
      alert('無法下載：缺少收據ID');
      return;
    }
    
    setIsDownloading(true);
    try {
      const blob = await apiService.downloadReceiptPDF(targetReceiptId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const receiptNumber = (receiptInfo as { receipt_number?: string })?.receipt_number || 'receipt';
      a.download = `receipt_${receiptNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      logger.error('Error downloading PDF:', err);
      const axiosError = err as { response?: { data?: { detail?: string } }; message?: string };
      alert(`下載失敗，請重試: ${axiosError?.response?.data?.detail || axiosError?.message || '未知錯誤'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleVoidReceipt = async () => {
    const targetReceiptId = receiptId || receiptInfo?.receipt_id;
    
    if (!targetReceiptId) {
      alert('無法作廢：缺少收據ID');
      return;
    }
    
    // Validate void reason is required
    if (!voidReason.trim()) {
      alert('請輸入作廢原因');
      return;
    }
    
    setIsVoiding(true);
    try {
      await apiService.voidReceipt(targetReceiptId, voidReason.trim());
      setShowVoidConfirm(false);
      setVoidReason('');
      if (onReceiptVoided) {
        onReceiptVoided();
      }
      onClose();
    } catch (err: unknown) {
      logger.error('Error voiding receipt:', err);
      const axiosError = err as { response?: { data?: { detail?: string } } };
      alert(axiosError.response?.data?.detail || '作廢失敗，請重試');
    } finally {
      setIsVoiding(false);
    }
  };

  const isVoided = receiptInfo?.void_info?.voided || false;

  if (isLoading) {
    return (
      <BaseModal onClose={onClose} aria-label="檢視收據" fullScreen>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-lg">載入中...</p>
          </div>
        </div>
      </BaseModal>
    );
  }

  if (error || !receiptHtml) {
    return (
      <BaseModal onClose={onClose} aria-label="檢視收據" fullScreen>
        <div className="flex items-center justify-center h-full">
          <div className="bg-red-50 border border-red-200 rounded-md p-6 max-w-md">
            <p className="text-sm text-red-800">{error || '無法載入收據'}</p>
          </div>
        </div>
      </BaseModal>
    );
  }

  const voidInfo = receiptInfo?.void_info;
  const voidedReason = voidInfo?.reason;
  const voidedAt = voidInfo?.voided_at;
  const voidedBy = voidInfo?.voided_by;

  return (
    <>
      <BaseModal onClose={onClose} aria-label="檢視收據" fullScreen className="p-0">
        {/* Void information banner */}
        {isVoided && (
          <div 
            className="bg-red-50 border-b border-red-200 px-4 py-3"
            style={{ zIndex: Z_INDEX.MODAL + 5 }}
          >
            <div className="flex items-start space-x-2">
              <svg className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-1">
                  <span className="font-semibold text-red-800">此收據已作廢</span>
                </div>
                {voidedAt && (
                  <p className="text-sm text-red-700">
                    作廢日期: {new Date(voidedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
                {voidedBy && (
                  <p className="text-sm text-red-700">
                    作廢者: {voidedBy.name || voidedBy.email}
                  </p>
                )}
                {voidedReason && (
                  <p className="text-sm text-red-700 mt-1">
                    <span className="font-medium">作廢原因:</span> {voidedReason}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Receipt HTML in iframe */}
        <iframe
          srcDoc={receiptHtml || ''}
          className="w-full h-full border-0"
          title="收據"
          style={{ minHeight: '100vh' }}
          sandbox="allow-same-origin"
        />

        {/* Floating action buttons */}
        <div 
          className="fixed bottom-6 right-6 flex flex-col gap-3"
          style={{ zIndex: Z_INDEX.MODAL + 10 }}
        >
          {/* Download button */}
          <button
            onClick={handleDownloadPDF}
            disabled={isDownloading}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-full p-3 shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title="下載收據"
            aria-label="下載收據"
          >
            {isDownloading ? (
              <svg className="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
          </button>

          {/* Void button (only show if not voided and is clinic user) */}
          {!isVoided && isClinicUser && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowVoidConfirm(true);
              }}
              className="bg-red-600 hover:bg-red-700 text-white rounded-full p-3 shadow-lg hover:shadow-xl transition-all"
              title="作廢收據"
              aria-label="作廢收據"
              type="button"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </BaseModal>

      {/* Void Confirmation Dialog - Rendered in portal to ensure it's above the modal */}
      {showVoidConfirm && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center"
          style={{ zIndex: Z_INDEX.MODAL + 100 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowVoidConfirm(false);
              setVoidReason('');
            }
          }}
        >
          <div 
            className="bg-white rounded-lg p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-lg font-semibold mb-4">確認作廢收據</h4>
            <p className="text-sm text-gray-700 mb-4">
              確定要作廢此收據嗎？此操作無法復原。作廢後可以重新開立新收據。
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                作廢原因 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="input"
                placeholder="例如：輸入錯誤"
                required
                autoFocus
              />
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setShowVoidConfirm(false);
                  setVoidReason('');
                }}
                className="btn-secondary"
                disabled={isVoiding}
                type="button"
              >
                取消
              </button>
              <button
                onClick={handleVoidReceipt}
                className="btn-primary bg-red-600 hover:bg-red-700 disabled:hover:bg-red-600"
                disabled={isVoiding || !voidReason.trim()}
                type="button"
              >
                {isVoiding ? '處理中...' : '確認作廢'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
