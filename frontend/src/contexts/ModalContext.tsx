import React, { createContext, useContext, useState, ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseModal } from '../components/shared/BaseModal';
import { ModalHeader, ModalBody, ModalFooter } from '../components/shared/ModalParts';
import { Z_INDEX } from '../constants/app';

interface ModalState {
  isOpen: boolean;
  title: string | undefined;
  message: any;
  type: 'alert' | 'confirm';
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface ModalContextType {
  modal: ModalState | null;
  alert: (message: any, title?: string) => Promise<void>;
  confirm: (message: any, title?: string) => Promise<boolean>;
  closeModal: () => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

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

  const alert = useCallback((message: any, title?: string): Promise<void> => {
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
  }, []);

  const confirm = useCallback((message: any, title?: string): Promise<boolean> => {
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
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
  }, []);

  const value = useMemo(() => ({
    modal,
    alert,
    confirm,
    closeModal,
  }), [modal, alert, confirm, closeModal]);

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
      showCloseButton={false}
    >
      <ModalHeader
        title={modal.title || (modal.type === 'alert' ? t('modal.alert') : t('modal.confirm'))}
        showClose
        onClose={handleClose}
      />
      <ModalBody>
        <p className="text-gray-700 whitespace-pre-line">
          {typeof modal.message === 'string'
            ? modal.message
            : JSON.stringify(modal.message, null, 2)}
        </p>
      </ModalBody>
      <ModalFooter>
        {modal.type === 'confirm' && modal.onCancel && (
          <button
            onClick={modal.onCancel}
            className="btn-secondary"
          >
            {t('common.cancel')}
          </button>
        )}
        <button
          onClick={modal.onConfirm}
          className="btn-primary"
          autoFocus
        >
          {modal.type === 'alert' ? t('common.ok') : t('common.confirm')}
        </button>
      </ModalFooter>
    </BaseModal>
  );
};
