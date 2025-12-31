import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../components/shared/BaseModal';
import { Z_INDEX } from '../constants/app';

interface ModalState {
  isOpen: boolean;
  title: string | undefined;
  message: string;
  type: 'alert' | 'confirm';
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface ModalContextType {
  modal: ModalState | null;
  alert: (message: string, title?: string) => Promise<void>;
  confirm: (message: string, title?: string) => Promise<boolean>;
  closeModal: () => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useModal = () => {
  const context = useContext(ModalContext);
  if (context === undefined) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
};

interface ModalProviderProps {
  children: ReactNode;
}

export const ModalProvider: React.FC<ModalProviderProps> = ({ children }) => {
  const [modal, setModal] = useState<ModalState | null>(null);

  const alert = (message: string, title?: string): Promise<void> => {
    return new Promise((resolve) => {
      setModal({
        isOpen: true,
        title,
        message,
        type: 'alert',
        onConfirm: () => {
          setModal(null);
          resolve();
        },
      });
    });
  };

  const confirm = (message: string, title?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setModal({
        isOpen: true,
        title,
        message,
        type: 'confirm',
        onConfirm: () => {
          setModal(null);
          resolve(true);
        },
        onCancel: () => {
          setModal(null);
          resolve(false);
        },
      });
    });
  };

  const closeModal = () => {
    setModal(null);
  };

  const value: ModalContextType = {
    modal,
    alert,
    confirm,
    closeModal,
  };

  return (
    <ModalContext.Provider value={value}>
      {children}
      {modal && <ModalDialog modal={modal} onClose={closeModal} />}
    </ModalContext.Provider>
  );
};

interface ModalDialogProps {
  modal: ModalState;
  onClose: () => void;
}

const ModalDialog: React.FC<ModalDialogProps> = ({ modal, onClose }) => {
  const { t } = useTranslation();
  const handleClose = () => {
    if (modal.onCancel) {
      modal.onCancel();
    } else {
      onClose();
    }
  };

  return (
    <BaseModal
      onClose={handleClose}
      zIndex={Z_INDEX.DIALOG}
      aria-label={modal.title || (modal.type === 'alert' ? t('modal.alert') : t('modal.confirm'))}
    >
      {modal.title && (
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          {modal.title}
        </h3>
      )}

      <p className="text-gray-700 mb-6 whitespace-pre-line">{modal.message}</p>

      <div className="flex justify-end space-x-3">
        {modal.type === 'confirm' && modal.onCancel && (
          <button
            onClick={modal.onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
          >
            {t('common.cancel')}
          </button>
        )}

        <button
          onClick={modal.onConfirm}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          autoFocus
        >
          {modal.type === 'alert' ? t('common.ok') : t('common.confirm')}
        </button>
      </div>
    </BaseModal>
  );
};
