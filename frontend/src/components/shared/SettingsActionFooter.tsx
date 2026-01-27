import React from 'react';
import { useModal } from '../../contexts/ModalContext';
import { Z_INDEX } from '../../constants/app';

interface SettingsActionFooterProps {
    isVisible: boolean;
    isSubmitting: boolean;
    onDiscard: () => void;
    onSave: () => void;
    discardLabel?: string;
    saveLabel?: string;
}

const SettingsActionFooter: React.FC<SettingsActionFooterProps> = ({
    isVisible,
    isSubmitting,
    onDiscard,
    onSave,
    discardLabel = '捨棄變更',
    saveLabel = '儲存變更'
}) => {
    const { modal } = useModal();
    if (!isVisible || modal?.isOpen) return null;

    return (
        <div
            className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] py-4 transition-transform duration-300 transform translate-y-0"
            style={{ zIndex: Z_INDEX.STICKY_FOOTER }}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="max-w-4xl mx-auto flex justify-end space-x-4">
                    <button
                        type="button"
                        onClick={onDiscard}
                        disabled={isSubmitting}
                        className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                    >
                        {discardLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={isSubmitting}
                        className="px-6 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-md shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 flex items-center"
                    >
                        {isSubmitting ? (
                            <>
                                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                儲存中...
                            </>
                        ) : (
                            saveLabel
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsActionFooter;
