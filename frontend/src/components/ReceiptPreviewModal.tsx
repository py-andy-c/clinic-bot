/**
 * ReceiptPreviewModal Component
 * 
 * Modal for previewing receipt with current settings.
 * Displays the receipt HTML in an iframe to match the PDF exactly.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { BaseModal } from './shared/BaseModal';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';

interface ReceiptPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  customNotes: string | null;
  showStamp: boolean;
}

export const ReceiptPreviewModal: React.FC<ReceiptPreviewModalProps> = ({
  isOpen,
  onClose,
  customNotes,
  showStamp,
}) => {
  const [receiptHtml, setReceiptHtml] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const html = await apiService.getReceiptPreview(customNotes, showStamp);
      setReceiptHtml(html);
    } catch (err: unknown) {
      logger.error('Error loading receipt preview:', err);
      setError('無法載入收據預覽');
    } finally {
      setIsLoading(false);
    }
  }, [customNotes, showStamp]);

  useEffect(() => {
    if (isOpen) {
      loadPreview();
    } else {
      // Reset state when modal closes
      setReceiptHtml(null);
      setError(null);
    }
  }, [isOpen, customNotes, showStamp, loadPreview]);

  if (!isOpen) return null;

  if (isLoading) {
    return (
      <BaseModal onClose={onClose} aria-label="收據預覽" fullScreen>
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
      <BaseModal onClose={onClose} aria-label="收據預覽" fullScreen>
        <div className="flex items-center justify-center h-full">
          <div className="bg-red-50 border border-red-200 rounded-md p-6 max-w-md">
            <p className="text-sm text-red-800">{error || '無法載入收據預覽'}</p>
          </div>
        </div>
      </BaseModal>
    );
  }

  return (
    <BaseModal onClose={onClose} aria-label="收據預覽" fullScreen className="p-0">
      {/* Receipt HTML in iframe */}
      <iframe
        srcDoc={receiptHtml || ''}
        className="w-full h-full border-0"
        title="收據預覽"
        style={{ minHeight: '100vh' }}
        sandbox="allow-same-origin"
      />
    </BaseModal>
  );
};

