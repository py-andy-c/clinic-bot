/**
 * ReceiptViewModal Component
 * 
 * Modal for viewing receipt details and actions (download PDF, void receipt).
 */

import React, { useState, useEffect } from 'react';
import { BaseModal } from './BaseModal';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/currencyUtils';
import { Z_INDEX } from '../../constants/app';
import moment from 'moment-timezone';

interface ReceiptViewModalProps {
  appointmentId?: number;
  receiptId?: number;
  onClose: () => void;
  onReceiptVoided?: () => void;
  isAdmin: boolean;
}

export const ReceiptViewModal: React.FC<ReceiptViewModalProps> = ({
  appointmentId,
  receiptId,
  onClose,
  onReceiptVoided,
  isAdmin,
}) => {
  const [receipt, setReceipt] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    loadReceipt();
  }, [appointmentId, receiptId]);

  const loadReceipt = async () => {
    setIsLoading(true);
    setError(null);
    try {
      let data;
      if (receiptId) {
        data = await apiService.getReceiptById(receiptId);
      } else if (appointmentId) {
        data = await apiService.getReceiptForAppointment(appointmentId);
      } else {
        setError('缺少收據ID或預約ID');
        setIsLoading(false);
        return;
      }
      setReceipt(data);
    } catch (err: any) {
      logger.error('Error loading receipt:', err);
      setError('無法載入收據資料');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    const receiptId = receipt?.receipt_id;
    
    if (!receiptId) {
      alert('無法下載：缺少收據ID');
      return;
    }
    
    setIsDownloading(true);
    try {
      const blob = await apiService.downloadReceiptPDF(receiptId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt_${receipt.receipt_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      logger.error('Error downloading PDF:', err);
      alert(`下載失敗，請重試: ${err?.response?.data?.detail || err?.message || '未知錯誤'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleVoidReceipt = async () => {
    const receiptId = receipt?.receipt_id;
    
    if (!receiptId) {
      alert('無法作廢：缺少收據ID');
      return;
    }
    
    setIsVoiding(true);
    try {
      await apiService.voidReceipt(receiptId, voidReason || undefined);
      setShowVoidConfirm(false);
      setVoidReason('');
      if (onReceiptVoided) {
        onReceiptVoided();
      }
      onClose();
    } catch (err: any) {
      logger.error('Error voiding receipt:', err);
      alert(err.response?.data?.detail || '作廢失敗，請重試');
    } finally {
      setIsVoiding(false);
    }
  };

  if (isLoading) {
    return (
      <BaseModal onClose={onClose} aria-label="檢視收據">
        <div className="p-6 text-center">
          <p>載入中...</p>
        </div>
      </BaseModal>
    );
  }

  if (error || !receipt) {
    return (
      <BaseModal onClose={onClose} aria-label="檢視收據">
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error || '無法載入收據'}</p>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={onClose} className="btn-secondary">
              關閉
            </button>
          </div>
        </div>
      </BaseModal>
    );
  }

  const receiptData = receipt.receipt_data || {};
  // Use standardized void_info structure (both endpoints now return ReceiptResponse)
  const isVoided = receipt.void_info?.voided || false;
  const voidedAt = receipt.void_info?.voided_at;
  const voidedByName = receipt.void_info?.voided_by?.name;
  const receiptVoidReason = receipt.void_info?.reason;

  // Format payment method for display
  const formatPaymentMethod = (method: string): string => {
    const mapping: Record<string, string> = {
      'cash': '現金',
      'card': '刷卡',
      'transfer': '轉帳',
      'other': '其他'
    };
    return mapping[method] || method;
  };

  return (
    <BaseModal onClose={onClose} aria-label="檢視收據">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">收據詳情</h3>

        {/* Voided Status Banner */}
        {isVoided && (
          <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <span className="text-xl font-bold text-red-600">已作廢</span>
            </div>
            {voidedAt && (
              <p className="text-sm text-gray-700">
                作廢日期: {moment(voidedAt).tz('Asia/Taipei').format('YYYY-MM-DD HH:mm')}
              </p>
            )}
            {voidedByName && (
              <p className="text-sm text-gray-700">
                作廢者: {voidedByName}
              </p>
            )}
            {receiptVoidReason && (
              <p className="text-sm text-gray-700">
                作廢原因: {receiptVoidReason}
              </p>
            )}
          </div>
        )}

        {/* Receipt Details */}
        <div className="space-y-2">
          <p><strong>收據編號:</strong> {receipt.receipt_number}</p>
          {receiptData.visit_date && (
            <p><strong>看診日期:</strong> {moment(receiptData.visit_date).tz('Asia/Taipei').format('YYYY-MM-DD HH:mm')}</p>
          )}
          {receiptData.issue_date && (
            <p><strong>開立日期:</strong> {moment(receiptData.issue_date).tz('Asia/Taipei').format('YYYY-MM-DD HH:mm')}</p>
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
                // Get item name based on item_type
                const itemName = item.item_type === 'service_item' 
                  ? (item.service_item?.receipt_name || item.service_item?.name || '')
                  : (item.item_name || '');
                
                return (
                  <div key={index} className="flex justify-between text-sm">
                    <span>
                      {itemName}
                      {item.practitioner?.name && ` (${item.practitioner.name})`}
                    </span>
                    <span>{formatCurrency(item.amount)}</span>
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

        {/* Stamp */}
        {receiptData.stamp?.enabled && (
          <div className="border-2 border-gray-300 rounded p-2 text-center">
            <p className="font-semibold">{receiptData.clinic?.display_name || ''}</p>
            <p className="text-sm text-gray-600">
              {receiptData.issue_date && moment(receiptData.issue_date).tz('Asia/Taipei').format('YYYY-MM-DD')}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-200">
          <button
            onClick={handleDownloadPDF}
            disabled={isDownloading}
            className="btn-primary"
          >
            {isDownloading ? '下載中...' : '下載收據'}
          </button>
          {!isVoided && isAdmin && (
            <button
              onClick={() => setShowVoidConfirm(true)}
              className="btn-primary bg-red-600 hover:bg-red-700"
            >
              作廢收據
            </button>
          )}
        </div>

        {/* Void Confirmation Dialog */}
        {showVoidConfirm && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center"
            style={{ zIndex: Z_INDEX.MODAL + 1 }}
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
                  作廢原因 (選填)
                </label>
                <input
                  type="text"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  className="input"
                  placeholder="例如：輸入錯誤"
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
                >
                  取消
                </button>
                <button
                  onClick={handleVoidReceipt}
                  className="btn-primary bg-red-600 hover:bg-red-700"
                  disabled={isVoiding}
                >
                  {isVoiding ? '處理中...' : '確認作廢'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </BaseModal>
  );
};


