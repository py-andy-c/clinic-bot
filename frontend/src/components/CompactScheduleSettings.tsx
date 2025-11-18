import React, { useState, useRef } from 'react';
import { InfoModal } from './shared/InfoModal';

interface CompactScheduleSettingsProps {
  compactScheduleEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
}

const CompactScheduleSettings: React.FC<CompactScheduleSettingsProps> = ({
  compactScheduleEnabled,
  onToggle,
  showSaveButton = false,
  onSave,
  saving = false,
}) => {
  const [showInfoModal, setShowInfoModal] = useState(false);
  const infoButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="pt-6 border-t border-gray-200">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">進階排程設定</h2>
          <div className="space-y-4">
            {/* Compact Schedule Toggle */}
            <div className="flex items-start justify-between">
              <div className="flex-1 mr-4">
                <div className="flex items-center gap-2 mb-1">
                  <label className="block text-sm font-medium text-gray-900">
                    緊湊排程
                  </label>
                  <button
                    type="button"
                    ref={infoButtonRef}
                    onClick={() => setShowInfoModal(true)}
                    className="text-gray-400 hover:text-gray-600 focus:outline-none"
                    aria-label="了解更多"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </button>
                  <InfoModal
                    isOpen={showInfoModal}
                    onClose={() => setShowInfoModal(false)}
                    buttonRef={infoButtonRef}
                    title="緊湊排程"
                  >
                    <p className="mb-3 text-xs">
                      盡可能把預約「排在一起」，減少您當日的總工作時間。
                    </p>
                    
                    <div className="space-y-3 mb-3">
                      {/* Example 1 */}
                      <div className="bg-gray-50 p-3 rounded">
                        <p className="font-medium text-xs mb-2">範例 1</p>
                        <div className="space-y-2 text-xs">
                          <div>
                            <div className="text-gray-600 mb-1">目前預約：10:00、12:00</div>
                            <div className="flex items-center gap-1 mb-1">
                              <div className="w-12 h-6 bg-blue-400 rounded text-white text-[10px] flex items-center justify-center">10:00</div>
                              <div className="w-12 h-6 bg-gray-300 rounded text-gray-600 text-[10px] flex items-center justify-center">空</div>
                              <div className="w-12 h-6 bg-blue-400 rounded text-white text-[10px] flex items-center justify-center">12:00</div>
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-600 mb-1">病患可選擇時段：</div>
                            <div className="flex items-center gap-1">
                              <div className="w-12 h-6 bg-gray-200 border border-gray-300 rounded text-gray-600 text-[10px] flex items-center justify-center">09:00</div>
                              <div className="w-12 h-6 bg-gray-200 border-2 border-teal-400 rounded text-gray-600 text-[10px] flex items-center justify-center relative">
                                11:00
                                <span className="absolute -top-1 -right-1 bg-teal-500 text-white text-[8px] px-0.5 rounded">建議</span>
                              </div>
                              <div className="w-12 h-6 bg-gray-200 border border-gray-300 rounded text-gray-600 text-[10px] flex items-center justify-center">13:00</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Example 2 */}
                      <div className="bg-gray-50 p-3 rounded">
                        <p className="font-medium text-xs mb-2">範例 2</p>
                        <div className="space-y-2 text-xs">
                          <div>
                            <div className="text-gray-600 mb-1">目前預約：10:00</div>
                            <div className="flex items-center gap-1 mb-1">
                              <div className="w-12 h-6 bg-blue-400 rounded text-white text-[10px] flex items-center justify-center">10:00</div>
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-600 mb-1">病患可選擇時段：</div>
                            <div className="flex items-center gap-1">
                              <div className="w-12 h-6 bg-gray-200 border-2 border-teal-400 rounded text-gray-600 text-[10px] flex items-center justify-center relative">
                                09:00
                                <span className="absolute -top-1 -right-1 bg-teal-500 text-white text-[8px] px-0.5 rounded">建議</span>
                              </div>
                              <div className="w-12 h-6 bg-gray-200 border-2 border-teal-400 rounded text-gray-600 text-[10px] flex items-center justify-center relative">
                                11:00
                                <span className="absolute -top-1 -right-1 bg-teal-500 text-white text-[8px] px-0.5 rounded">建議</span>
                              </div>
                              <div className="w-12 h-6 bg-gray-200 border border-gray-300 rounded text-gray-600 text-[10px] flex items-center justify-center">12:00</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-blue-50 border-l-4 border-blue-400 p-2">
                      <p className="text-xs text-blue-800">
                        <strong>重要：</strong>不會減少可用時段，僅作為視覺建議。
                      </p>
                    </div>
                  </InfoModal>
                </div>
              </div>
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => onToggle(!compactScheduleEnabled)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                    compactScheduleEnabled ? 'bg-primary-600' : 'bg-gray-200'
                  }`}
                  role="switch"
                  aria-checked={compactScheduleEnabled}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      compactScheduleEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
        {showSaveButton && onSave && (
          <button
            onClick={onSave}
            disabled={saving}
            className="btn-primary ml-4"
          >
            {saving ? '儲存中...' : '儲存更變'}
          </button>
        )}
      </div>
    </div>
  );
};

export default CompactScheduleSettings;

