import React, { useState } from 'react';
import { BaseModal } from './shared/BaseModal';

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
                                <div className="flex items-start">
                                    <div className="flex-shrink-0">
                                        <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                        </svg>
                                    </div>
                                    <div className="ml-3 flex-1 text-left">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-3 text-left">預約起始時間間隔</h3>
                                        <div className="text-sm text-gray-700 space-y-4">
                                            <div className="space-y-2">
                                                <p className="font-medium">範例說明（假設預約時長為 60 分鐘）：</p>
                                                <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                                                    <li><strong>設定為 30 分鐘：</strong>病患可選擇 09:00-10:00、09:30-10:30、10:00-11:00 等時段</li>
                                                    <li><strong>設定為 15 分鐘：</strong>病患可選擇 09:00-10:00、09:15-10:15、09:30-10:30 等更細的時段</li>
                                                </ul>
                                            </div>
                                            <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                                                <strong>特別說明：</strong>個人設定的間隔時間不能小於診所預設值 ({clinicDefaultStep} 分鐘)。
                                            </p>
                                            <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">
                                                若您沒有特別設定（保持空白），系統將會使用診所預設值 ({clinicDefaultStep} 分鐘)。
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </BaseModal>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <input
                            type="number"
                            value={stepSizeMinutes === null ? '' : stepSizeMinutes}
                            onChange={(e) => {
                                const val = e.target.value === '' ? null : parseInt(e.target.value);
                                onStepSizeChange(val);
                            }}
                            placeholder={`預設: ${clinicDefaultStep}`}
                            className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                            min={clinicDefaultStep}
                            max={60}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PractitionerStepSizeSettings;
