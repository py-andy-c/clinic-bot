import React, { useState } from 'react';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader, ModalBody } from './shared/ModalParts';
import { preventScrollWheelChange } from '../utils/inputUtils';
import { useNumberInput } from '../hooks/useNumberInput';

interface PractitionerStepSizeSettingsProps {
    stepSizeMinutes: number | null;
    clinicDefaultStep: number;
    onStepSizeChange: (value: number | null) => void;
    showSaveButton?: boolean;
    onSave?: () => void;
    saving?: boolean;
}

const PractitionerStepSizeSettings: React.FC<PractitionerStepSizeSettingsProps> = ({
    stepSizeMinutes,
    clinicDefaultStep,
    onStepSizeChange,
}) => {
    const [showInfoModal, setShowInfoModal] = useState(false);

    const stepInput = useNumberInput(
        stepSizeMinutes as any,
        (value) => onStepSizeChange(value as any),
        {
            fallback: null as any, // Allow it to stay null/empty
            parseFn: 'parseInt',
            min: clinicDefaultStep,
            max: 60
        }
    );

    return (
        <div className="mt-4">
            <div className="flex items-start justify-between">
                <div className="flex-1 mr-4">
                    <div className="flex items-center gap-2 mb-1">
                        <label className="block text-sm font-medium text-gray-900">
                            預約起始時間間隔 (分鐘)
                        </label>
                        <button
                            type="button"
                            onClick={() => setShowInfoModal(true)}
                            className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
                            aria-label="查看說明"
                        >
                            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                        </button>
                        {showInfoModal && (
                            <BaseModal
                                onClose={() => setShowInfoModal(false)}
                                aria-label="預約起始時間間隔說明"
                            >
                                <ModalHeader title="預約起始時間間隔" showClose onClose={() => setShowInfoModal(false)} />
                                <ModalBody>
                                    <div className="text-sm text-gray-700 space-y-2">
                                      <p><strong>預約起始時間間隔</strong>設定預約開始時間的間隔長度，影響病人可選擇的時間點數量。</p>
                                      <p className="mb-3">較短的間隔提供更多選擇，但可能增加排程複雜度；較長的間隔簡化排程，但限制病人選擇。</p>
                                      <p>建議根據您的服務類型和排程需求調整此設定。</p>
                                      <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">
                                        若您沒有特別設定（保持空白），系統將會使用診所預設值 ({clinicDefaultStep} 分鐘)。
                                      </p>
                                    </div>
                                  </ModalBody>
                            </BaseModal>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <input
                            type="number"
                            value={stepInput.displayValue ?? ''}
                            onChange={stepInput.onChange}
                            onBlur={stepInput.onBlur}
                            onWheel={preventScrollWheelChange}
                            placeholder={`預設: ${clinicDefaultStep}`}
                            className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                            min={clinicDefaultStep}
                            max={60}
                            step="5"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PractitionerStepSizeSettings;
