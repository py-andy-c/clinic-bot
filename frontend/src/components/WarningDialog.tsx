import React from 'react';
import { WarningResponse } from '../types';

interface WarningDialogProps {
  warning: WarningResponse | null;
  show: boolean;
  onClose: () => void;
  onConfirm: () => void;
  saving: boolean;
}

const WarningDialog: React.FC<WarningDialogProps> = ({
  warning,
  show,
  onClose,
  onConfirm,
  saving,
}) => {
  if (!show || !warning) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <div className="mt-3 text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100">
            <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mt-4">警告</h3>
          <div className="mt-2 px-7 py-3">
            <p className="text-sm text-gray-500">{warning.message}</p>
            {warning.details && (
              <div className="mt-2 text-sm text-gray-600">
                <p className="font-medium">詳細資訊:</p>
                <ul className="list-disc list-inside mt-1">
                  {warning.details.map((detail, index) => (
                    <li key={index}>{detail}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="items-center px-4 py-3">
            <div className="flex space-x-3">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 bg-gray-300 text-gray-800 text-base font-medium rounded-md shadow-sm hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={onConfirm}
                disabled={saving}
                className="px-4 py-2 bg-primary-600 text-white text-base font-medium rounded-md shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              >
                {saving ? '儲存中...' : '確認儲存'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WarningDialog;
