/**
 * ExceptionModal Component
 * 
 * Modal for creating availability exceptions (休診時段).
 */

import React from 'react';
import { BaseModal } from './BaseModal';

export interface ExceptionData {
  date: string;
  startTime: string;
  endTime: string;
}

export interface ExceptionModalProps {
  exceptionData: ExceptionData;
  isFullDay: boolean;
  onClose: () => void;
  onCreate: () => void;
  onExceptionDataChange: (data: ExceptionData) => void;
  onFullDayChange: (isFullDay: boolean) => void;
}

export const ExceptionModal: React.FC<ExceptionModalProps> = React.memo(({
  exceptionData,
  isFullDay,
  onClose,
  onCreate,
  onExceptionDataChange,
  onFullDayChange,
}) => {
  return (
    <BaseModal
      onClose={onClose}
      aria-label="新增休診時段"
    >
        <div className="mb-4">
          <h3 className="text-lg font-semibold">新增休診時段</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              日期
            </label>
            <input
              type="date"
              className="input"
              value={exceptionData.date}
              onChange={(e) => onExceptionDataChange({ ...exceptionData, date: e.target.value })}
            />
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="fullDay"
              checked={isFullDay}
              onChange={(e) => {
                const checked = e.target.checked;
                onFullDayChange(checked);
                if (checked) {
                  onExceptionDataChange({ ...exceptionData, startTime: '00:00', endTime: '23:59' });
                }
              }}
              className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
            />
            <label htmlFor="fullDay" className="ml-2 text-sm font-medium text-gray-700">
              全天
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              開始時間
            </label>
            <input
              type="time"
              className="input"
              value={exceptionData.startTime}
              onChange={(e) => {
                onExceptionDataChange({ ...exceptionData, startTime: e.target.value });
                if (isFullDay) {
                  onFullDayChange(false);
                }
              }}
              disabled={isFullDay}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              結束時間
            </label>
            <input
              type="time"
              className="input"
              value={exceptionData.endTime}
              onChange={(e) => {
                onExceptionDataChange({ ...exceptionData, endTime: e.target.value });
                if (isFullDay) {
                  onFullDayChange(false);
                }
              }}
              disabled={isFullDay}
            />
          </div>
        </div>
        <div className="flex justify-end mt-6">
          <button 
            onClick={onCreate}
            className="btn-primary w-full sm:w-auto"
          >
            儲存休診時段
          </button>
        </div>
    </BaseModal>
  );
});

