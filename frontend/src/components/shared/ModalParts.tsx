import React from 'react';
import { useTranslation } from 'react-i18next';

interface ModalHeaderProps {
  title?: React.ReactNode;
  children?: React.ReactNode;
  onClose?: () => void;
  showClose?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({ title, children, onClose, showClose = false, className = '', style }) => {
  const { t } = useTranslation();
  return (
    <div className={`px-6 py-3 border-b flex items-center ${className}`} style={style}>
      {title ? (
        <h2 className="text-lg font-semibold text-gray-900">
          {title}
        </h2>
      ) : null}
      {children}
      {showClose && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="ml-auto inline-flex items-center justify-center h-9 w-9 rounded-md text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          aria-label={t('common.close')}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};
ModalHeader.displayName = 'ModalHeader';

interface ModalBodyProps {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export const ModalBody: React.FC<ModalBodyProps> = ({ className = '', style, children }) => {
  return (
    <div className={`px-6 py-4 flex-1 min-h-0 overflow-y-auto ${className}`} style={style}>
      {children}
    </div>
  );
};
ModalBody.displayName = 'ModalBody';

interface ModalFooterProps {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  loading?: boolean;
}

export const ModalFooter: React.FC<ModalFooterProps> = ({ className = '', style, children, loading = false }) => {
  return (
    <div className={`px-6 py-3 border-t flex justify-end space-x-3 ${loading ? 'opacity-70 pointer-events-none' : ''} ${className}`} style={style}>
      {children}
    </div>
  );
};
ModalFooter.displayName = 'ModalFooter';
