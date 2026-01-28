/**
 * ReceiptListModal Component
 * 
 * Modal for listing all receipts (active and voided) for an appointment.
 * Used when appointment has multiple receipts.
 */

import React, { useState, useEffect } from 'react';
import { BaseModal } from './BaseModal';
import { ModalHeader, ModalBody } from '../shared/ModalParts';
import { apiService } from '../../services/api';
import { logger } from '../../utils/logger';
import { formatCurrency as formatCurrencyUtil } from '../../utils/currencyUtils';
import moment from 'moment-timezone';

interface ReceiptListModalProps {
  appointmentId: number; // Used for context, not directly in component
  receiptIds: number[];
  onClose: () => void;
  onSelectReceipt: (receiptId: number) => void;
}

interface ReceiptSummary {
  receipt_id: number;
  receipt_number: string;
  issue_date: string;
  is_voided: boolean;
  voided_at?: string;
  void_reason?: string;
  total_amount: number;
}

export const ReceiptListModal: React.FC<ReceiptListModalProps> = ({
  receiptIds,
  onClose,
  onSelectReceipt,
}) => {
  const [receipts, setReceipts] = useState<ReceiptSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReceipts();
  }, [receiptIds]);

  const loadReceipts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch all receipts in parallel
      const receiptPromises = receiptIds.map(id => 
        apiService.getReceiptById(id).catch(err => {
          logger.error(`Error loading receipt ${id}:`, err);
          return null;
        })
      );
      
      const receiptData = await Promise.all(receiptPromises);
      
      // Filter out failed loads and map to summary format
      const validReceipts: ReceiptSummary[] = receiptData
        .filter((r): r is any => r !== null)
        .map((r: any) => ({
          receipt_id: r.receipt_id,
          receipt_number: r.receipt_number,
          issue_date: r.issue_date,
          is_voided: r.void_info?.voided || false,
          voided_at: r.void_info?.voided_at,
          void_reason: r.void_info?.reason,
          total_amount: r.total_amount || 0,
        }))
        // Sort by issue_date DESC (newest first)
        .sort((a, b) => {
          const dateA = moment(a.issue_date);
          const dateB = moment(b.issue_date);
          return dateB.diff(dateA);
        });
      
      setReceipts(validReceipts);
    } catch (err: any) {
      logger.error('Error loading receipts:', err);
      setError('無法載入收據列表');
    } finally {
      setIsLoading(false);
    }
  };

  // Use the shared currency utility for consistent formatting
  const formatCurrency = formatCurrencyUtil;

  if (isLoading) {
    return (
      <BaseModal onClose={onClose} aria-label="收據列表" showCloseButton={false}>
        <ModalHeader title="收據列表" showClose onClose={onClose} />
        <ModalBody>
          <div className="text-center py-8">載入中...</div>
        </ModalBody>
      </BaseModal>
    );
  }

  if (error) {
    return (
      <BaseModal onClose={onClose} aria-label="收據列表" showCloseButton={false}>
        <ModalHeader title="收據列表" showClose onClose={onClose} />
        <ModalBody>
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        </ModalBody>
      </BaseModal>
    );
  }

  return (
    <BaseModal onClose={onClose} aria-label="收據列表" showCloseButton={false}>
      <ModalHeader title="收據列表" showClose onClose={onClose} />
      <ModalBody>
        <p className="text-sm text-gray-600 mb-3">
          此預約共有 {receipts.length} 張收據，請選擇要查看的收據：
        </p>
        <div className="space-y-2">
          {receipts.map((receipt) => (
            <button
              key={receipt.receipt_id}
              onClick={() => {
                onSelectReceipt(receipt.receipt_id);
                onClose();
              }}
              className={`w-full text-left p-4 border rounded-lg hover:bg-gray-50 transition-colors ${
                receipt.is_voided
                  ? 'border-gray-300 bg-gray-50 opacity-75'
                  : 'border-blue-300 bg-white'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="font-semibold text-gray-900">
                      {receipt.receipt_number}
                    </span>
                    {receipt.is_voided && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 rounded">
                        已作廢
                      </span>
                    )}
                    {!receipt.is_voided && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded">
                        有效
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">
                    開立日期: {moment(receipt.issue_date).tz('Asia/Taipei').format('YYYY-MM-DD HH:mm')}
                  </p>
                  {receipt.voided_at && (
                    <p className="text-sm text-gray-500">
                      作廢日期: {moment(receipt.voided_at).tz('Asia/Taipei').format('YYYY-MM-DD HH:mm')}
                    </p>
                  )}
                  {receipt.void_reason && (
                    <p className="text-sm text-gray-500 mt-1">
                      <span className="font-medium">作廢原因:</span> {receipt.void_reason}
                    </p>
                  )}
                </div>
                <div className="ml-4 text-right">
                  <p className="font-semibold text-gray-900">
                    {formatCurrency(receipt.total_amount)}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </ModalBody>
    </BaseModal>
  );
};

