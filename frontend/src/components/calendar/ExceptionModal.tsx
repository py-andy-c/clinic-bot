/**
 * ExceptionModal Component
 * 
 * Modal for creating availability exceptions (休診時段).
 */

import React from 'react';
import { BaseModal } from './BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from '../shared/ModalParts';
import { TimeInput } from '../shared/TimeInput';

export interface ExceptionData {
  date: string;
  startTime: string;
  endTime: string;
  practitionerId: number;
}

export interface ExceptionModalProps {
  exceptionData: ExceptionData;
  isFullDay: boolean;
  practitioners: Array<{ id: number; name: string }>;
  onClose: () => void;
  onCreate: () => void;
  onExceptionDataChange: (data: ExceptionData) => void;
  onFullDayChange: (isFullDay: boolean) => void;
}

export const ExceptionModal: React.FC<ExceptionModalProps> = React.memo(({
  exceptionData,
  isFullDay,
  practitioners,
  onClose,
  onCreate,
  onExceptionDataChange,
  onFullDayChange,
}) => {
  return (
    <BaseModal
      onClose={onClose}
      aria-label="新增休診時段"
      showCloseButton={false}
    >
      <ModalHeader title="新增休診時段" showClose onClose={onClose} />
      <ModalBody>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              治療師
            </label>
            <select
              className="input"
              value={exceptionData.practitionerId}
              onChange={(e) => onExceptionDataChange({ ...exceptionData, practitionerId: parseInt(e.target.value) })}
            >
              {practitioners.map(practitioner => (
                <option key={practitioner.id} value={practitioner.id}>
                  {practitioner.name}
                </option>
              ))}
            </select>
          </div>
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
                  onExceptionDataChange({ ...exceptionData, startTime: '00:00', endTime: '23:00' });
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
            <TimeInput
              value={exceptionData.startTime}
              onChange={(value) => {
                onExceptionDataChange({ ...exceptionData, startTime: value });
                if (isFullDay) {
                  onFullDayChange(false);
                }
              }}
              disabled={isFullDay}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              結束時間
            </label>
            <TimeInput
              value={exceptionData.endTime}
              onChange={(value) => {
                onExceptionDataChange({ ...exceptionData, endTime: value });
                if (isFullDay) {
                  onFullDayChange(false);
                }
              }}
              disabled={isFullDay}
              className="w-full"
            />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          className="btn-secondary"
        >
          取消
        </button>
        <button
          onClick={onCreate}
          className="btn-primary"
        >
          儲存休診時段
        </button>
      </ModalFooter>
    </BaseModal>
  );
});

