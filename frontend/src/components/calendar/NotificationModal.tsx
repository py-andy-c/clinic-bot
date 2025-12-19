import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BaseModal } from './BaseModal';
import { apiService } from '../../services/api';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';
import { LoadingSpinner } from '../shared';
import { useModal } from '../../contexts/ModalContext';

export interface NotificationPreview {
  message: string;
  patient_id: number;
  event_type: string;
}

export interface NotificationModalProps {
  visible: boolean;
  onClose: () => void;
  preview: NotificationPreview | null;
}

const NotificationModal: React.FC<NotificationModalProps> = React.memo(({
  visible,
  onClose,
  preview,
}) => {
  const { alert } = useModal();
  const [isSending, setIsSending] = useState(false);
  const [messageContent, setMessageContent] = useState<string>('');
  const [sendError, setSendError] = useState<string | null>(null);
  const justOpenedRef = useRef(false);
  const previousVisibleRef = useRef(false);

  // Set guard flag synchronously when visible changes from false to true
  if (visible && !previousVisibleRef.current && preview) {
    console.log('[NotificationModal] Modal becoming visible - setting guard flag', {
      timestamp: Date.now(),
      historyState: window.history.state
    });
    logger.log('NotificationModal: Modal becoming visible - setting guard flag');
    justOpenedRef.current = true;
    // Clear the flag after a delay
    setTimeout(() => {
      console.log('[NotificationModal] Clearing justOpenedRef flag', {
        timestamp: Date.now(),
        stillVisible: visible
      });
      logger.log('NotificationModal: Clearing justOpenedRef flag');
      justOpenedRef.current = false;
    }, 1000);
  }
  previousVisibleRef.current = visible;

  useEffect(() => {
    logger.log('NotificationModal: useEffect triggered', { visible, hasPreview: !!preview, preview });
    if (visible && preview) {
      setMessageContent(preview.message);
      setSendError(null); // Clear previous errors
    } else if (!visible) {
      // Reset flag when modal becomes invisible
      justOpenedRef.current = false;
      previousVisibleRef.current = false;
    }
  }, [visible, preview]);

  // Prevent closing immediately after opening
  const handleClose = useCallback(() => {
    const justOpened = justOpenedRef.current;
    const stackTrace = new Error().stack;
    console.log('[NotificationModal] handleClose called', { 
      justOpened,
      visible,
      hasPreview: !!preview,
      timestamp: Date.now(),
      stackTrace: stackTrace?.split('\n').slice(0, 5).join('\n')
    });
    if (justOpened) {
      console.log('[NotificationModal] BLOCKED - Prevented immediate close (just opened)');
      logger.log('NotificationModal: BLOCKED - Prevented immediate close (just opened)');
      return;
    }
    console.log('[NotificationModal] Allowing close - calling onClose');
    logger.log('NotificationModal: Allowing close - calling onClose');
    onClose();
  }, [onClose, visible, preview]);

  const handleSendMessage = async () => {
    if (!preview || !messageContent.trim()) {
      setSendError('訊息內容不可為空');
      return;
    }

    console.log('[NotificationModal] handleSendMessage called', {
      timestamp: Date.now(),
      hasPreview: !!preview
    });

    setIsSending(true);
    setSendError(null);

    try {
      await apiService.sendCustomNotification({
        patient_id: preview.patient_id,
        message: messageContent,
        event_type: preview.event_type,
      });
      console.log('[NotificationModal] Notification sent successfully, closing modal and showing alert', {
        timestamp: Date.now()
      });
      // Close modal first, then show success message
      justOpenedRef.current = false; // Allow closing when sending is complete
      handleClose(); // Use handleClose instead of onClose to go through the guard logic
      // Show success message after a brief delay to ensure modal is closed
      setTimeout(async () => {
        console.log('[NotificationModal] About to call alert', {
          timestamp: Date.now()
        });
        await alert('LINE訊息已成功傳送！');
        console.log('[NotificationModal] Alert completed', {
          timestamp: Date.now()
        });
      }, 100);
    } catch (err) {
      logger.error('Error sending custom notification:', err);
      setSendError(getErrorMessage(err) || '傳送LINE訊息失敗');
      setIsSending(false);
    }
  };

  const handleSkip = () => {
    justOpenedRef.current = false; // Allow closing when user explicitly clicks
    handleClose(); // Use handleClose instead of onClose to go through the guard logic
  };

  // Don't render if not visible or no preview
  if (!visible || !preview) {
    logger.log('NotificationModal: Not rendering - visible or preview check failed', { visible, hasPreview: !!preview });
    return null;
  }

  logger.log('NotificationModal: Rendering modal', { visible, hasPreview: !!preview });
  
  console.log('[NotificationModal] Rendering BaseModal', {
    visible,
    hasPreview: !!preview,
    justOpened: justOpenedRef.current,
    timestamp: Date.now()
  });

  return (
    <BaseModal
      onClose={handleClose}
      aria-label="傳送LINE訊息"
      className="!p-0"
      fullScreen={false}
      closeOnOverlayClick={false}
    >
      <div className="flex flex-col h-full px-6 pt-6 pb-6">
        <div className="flex items-center mb-4 flex-shrink-0">
          <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-2">
            <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm-3 9a1 1 0 112 0v1a1 1 0 11-2 0v-1zm5-1a1 1 0 10-2 0v1a1 1 0 102 0v-1z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-blue-800">
            傳送LINE訊息
          </h3>
        </div>

        {sendError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3 flex-shrink-0">
            <p className="text-sm text-red-800">{sendError}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              編輯並傳送給病患
            </label>
            <textarea
              value={messageContent}
              onChange={(e) => setMessageContent(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={6}
              maxLength={1000}
            />
            <div className="flex justify-between mt-1">
              <p className="text-xs text-gray-500">
                預約已成功更新！您可以調整訊息內容後傳送給患者。
              </p>
              <p className="text-xs text-gray-500">
                {messageContent.length}/1000 字元
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-4 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={handleSkip}
            className="btn-secondary"
            disabled={isSending}
          >
            關閉
          </button>
          <button
            onClick={handleSendMessage}
            className="btn-primary"
            disabled={isSending || !messageContent.trim()}
          >
            {isSending ? <LoadingSpinner size="sm" /> : '傳送 LINE 訊息'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
});

NotificationModal.displayName = 'NotificationModal';

export default NotificationModal;
