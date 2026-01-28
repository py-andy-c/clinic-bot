/**
 * Validation Summary Modal
 * 
 * Displays all validation errors from a save operation, grouped by type.
 * Each error is clickable and opens the relevant modal/tab with the field focused.
 */

import React from 'react';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from './shared/ModalParts';
import { useIsMobile } from '../hooks/useIsMobile';

export interface ValidationError {
  type: 'service-item' | 'group' | 'association';
  itemName?: string; // Name of the service item or group
  field: string; // Field path (e.g., 'name', 'duration_minutes')
  message: string; // Error message
  itemId: number; // ID of the item (can be temporary)
  onNavigate?: () => void; // Callback to navigate to the error location
}

interface ValidationSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  errors: ValidationError[];
}

export const ValidationSummaryModal: React.FC<ValidationSummaryModalProps> = ({
  isOpen,
  onClose,
  errors,
}) => {
  const isMobile = useIsMobile();

  if (!isOpen || errors.length === 0) return null;

  // Group errors by type
  const serviceItemErrors = errors.filter(e => e.type === 'service-item');
  const groupErrors = errors.filter(e => e.type === 'group');
  const associationErrors = errors.filter(e => e.type === 'association');

  const handleErrorClick = (error: ValidationError) => {
    if (error.onNavigate) {
      error.onNavigate();
      onClose();
    }
  };

  return (
    <BaseModal
      onClose={onClose}
      aria-label="驗證錯誤"
      className={isMobile ? 'max-w-full' : 'max-w-2xl'}
    >
      <ModalHeader title="驗證錯誤" showClose onClose={onClose}>
        <div className="ml-4 flex-1">
          <p className="text-xs text-gray-500">
            請修正以下錯誤後再儲存
          </p>
        </div>
      </ModalHeader>

      <ModalBody>
        <div className="space-y-6">
          {/* Service Item Errors */}
          {serviceItemErrors.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3 border-l-4 border-red-500 pl-3">服務項目</h3>
              <ul className="space-y-2">
                {serviceItemErrors.map((error, index) => (
                  <li key={index} className="flex items-start bg-red-50/50 p-2 rounded-md">
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-700">
                        「{error.itemName || `項目 ${error.itemId}`}」
                      </span>
                      <span className="text-sm text-gray-600 ml-1">- {error.message}</span>
                    </div>
                    {error.onNavigate && (
                      <button
                        onClick={() => handleErrorClick(error)}
                        className="ml-4 text-sm text-blue-600 hover:text-blue-800 underline"
                      >
                        前往修正
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Group Errors */}
          {groupErrors.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3 border-l-4 border-amber-500 pl-3">群組</h3>
              <ul className="space-y-2">
                {groupErrors.map((error, index) => (
                  <li key={index} className="flex items-start bg-amber-50/50 p-2 rounded-md">
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-700">
                        「{error.itemName || `群組 ${error.itemId}`}」
                      </span>
                      <span className="text-sm text-gray-600 ml-1">- {error.message}</span>
                    </div>
                    {error.onNavigate && (
                      <button
                        onClick={() => handleErrorClick(error)}
                        className="ml-4 text-sm text-blue-600 hover:text-blue-800 underline"
                      >
                        前往修正
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Association Errors */}
          {associationErrors.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3 border-l-4 border-blue-500 pl-3">關聯設定</h3>
              <ul className="space-y-2">
                {associationErrors.map((error, index) => (
                  <li key={index} className="flex items-start bg-blue-50/50 p-2 rounded-md">
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-700">
                        {error.itemName || `項目 ${error.itemId}`}
                      </span>
                      <span className="text-sm text-gray-600 ml-1">- {error.message}</span>
                    </div>
                    {error.onNavigate && (
                      <button
                        onClick={() => handleErrorClick(error)}
                        className="ml-4 text-sm text-blue-600 hover:text-blue-800 underline"
                      >
                        前往修正
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          onClick={onClose}
          className="btn-primary"
        >
          關閉
        </button>
      </ModalFooter>
    </BaseModal>
  );
};

