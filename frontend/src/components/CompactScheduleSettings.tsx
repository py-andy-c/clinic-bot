import React, { useState } from 'react';
import { BaseModal } from './shared/BaseModal';

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

  return (
    <div className="pt-0 border-t-0 md:pt-6 md:border-t md:border-gray-200">
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
                      aria-label="緊湊排程說明"
                    >
                      <div className="flex items-start">
                        <div className="flex-shrink-0">
                          <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="ml-3 flex-1">
                          <h3 className="text-lg font-semibold text-gray-900 mb-3">緊湊排程</h3>
                          <div className="text-sm text-gray-700 space-y-2">
                            <p className="mb-3 text-xs">
                              建議現有預約「前後相鄰」的時段，幫助您整合看診時間，減少中間瑣碎的空檔。
                            </p>

                            <div className="space-y-3 mb-3">
                              {/* Example 1 */}
                              <div className="bg-gray-50 p-3 rounded">
                                <p className="font-medium text-xs mb-2">範例：多個預約</p>
                                <div className="space-y-2 text-xs">
                                  <div>
                                    <div className="text-gray-600 mb-1">目前預約：09:00、13:00</div>
                                    <div className="flex items-center gap-1 mb-1">
                                      <div className="w-12 h-6 bg-blue-400 rounded text-white text-[10px] flex items-center justify-center">09:00</div>
                                      <div className="flex-1 border-b border-dashed border-gray-300 mx-1"></div>
                                      <div className="w-12 h-6 bg-blue-400 rounded text-white text-[10px] flex items-center justify-center">13:00</div>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-gray-600 mb-1">系統建議：</div>
                                    <div className="flex items-center gap-1">
                                      <div className="w-12 h-6 bg-gray-200 border-2 border-teal-400 rounded text-gray-600 text-[10px] flex items-center justify-center relative">
                                        10:00
                                        <span className="absolute -top-1 -right-1 bg-teal-500 text-white text-[8px] px-0.5 rounded">建議</span>
                                      </div>
                                      <div className="w-12 h-6 bg-gray-200 border-2 border-teal-400 rounded text-gray-600 text-[10px] flex items-center justify-center relative">
                                        12:00
                                        <span className="absolute -top-1 -right-1 bg-teal-500 text-white text-[8px] px-0.5 rounded">建議</span>
                                      </div>
                                      <div className="w-12 h-6 bg-gray-200 border-2 border-teal-400 rounded text-gray-600 text-[10px] flex items-center justify-center relative">
                                        14:00
                                        <span className="absolute -top-1 -right-1 bg-teal-500 text-white text-[8px] px-0.5 rounded">建議</span>
                                      </div>
                                    </div>
                                    <p className="text-[10px] text-gray-500 mt-1">※ 優先建議現有預約相連的最接近時段。</p>
                                  </div>
                                </div>
                              </div>

                              {/* Exception note */}
                              <div className="bg-gray-50 p-3 rounded">
                                <p className="font-medium text-xs mb-2">排班限制</p>
                                <div className="space-y-1 text-xs text-gray-600">
                                  <p>• 若中間有「休假」或「私人行程」，則不會建議跨越該時段。</p>
                                  <p>• 若所有可選時段都是建議時段，則不會特別標註。</p>
                                </div>
                              </div>
                            </div>

                            <div className="bg-blue-50 border-l-4 border-blue-400 p-2">
                              <p className="text-xs text-blue-800">
                                <strong>提示：</strong>緊湊排程不會減少可供病人選擇的總時段，僅提供視覺引導。
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </BaseModal>
                  )}
                </div>
              </div>
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => onToggle(!compactScheduleEnabled)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${compactScheduleEnabled ? 'bg-primary-600' : 'bg-gray-200'
                    }`}
                  role="switch"
                  aria-checked={compactScheduleEnabled}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${compactScheduleEnabled ? 'translate-x-5' : 'translate-x-0'
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

