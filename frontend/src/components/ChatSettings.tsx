import React, { useState, useEffect, useRef } from 'react';
import { ChatSettings as ChatSettingsType } from '../schemas/api';
import { ChatTestModal } from './ChatTestModal';
import { hasChatSettingsChanged } from '../utils/chatSettingsComparison';

interface ChatSettingsProps {
  chatSettings: ChatSettingsType;
  onChatSettingsChange: (chatSettings: ChatSettingsType) => void;
  isClinicAdmin?: boolean;
}

// Templates for complex fields
const TEMPLATES = {
  clinic_description: `我們是一間專注於運動傷害復健的物理治療診所，成立於2010年。

專長領域：
我們特別專精於運動傷害、肩頸痠痛、下背痛、膝關節問題及術後復健等領域。

治療理念：
我們採用徒手治療結合運動治療的整合性方式，為每位病患量身訂製治療計畫。
我們相信透過專業的評估、精準的治療和持續的運動指導，能幫助病患恢復健康，
重返運動場或日常生活。

服務特色：
我們提供一對一的個人化治療，確保每位病患都能獲得最適合的照護。`,

  therapist_info: `王大明 物理治療師

學歷與證照：
- 國立台灣大學物理治療學系學士
- 國立台灣大學物理治療學系碩士
- 中華民國物理治療師證照
- 美國運動傷害防護師認證 (ATC)
- 澳洲徒手治療協會認證 (AMTA)

專業經歷：
- 10年臨床經驗
- 曾任職於台大醫院復健部
- 曾擔任職棒球隊隨隊物理治療師
- 專精於運動傷害評估與治療

專長領域：
- 運動傷害：肩關節、膝關節、踝關節等運動相關傷害
- 慢性疼痛：下背痛、肩頸痠痛、肌筋膜疼痛症候群
- 術後復健：前十字韌帶重建、旋轉肌袖修補等術後復健計畫
- 運動表現提升：動作分析、功能性訓練、運動專項訓練

治療特色：
王治療師擅長結合徒手治療與運動治療，透過精準的動作評估找出問題根源，
並設計個人化的運動計畫。他特別注重病患教育，會詳細解釋治療原理，
讓病患了解自己的狀況並主動參與復健過程。

特殊技能：
- 動態動作分析
- 肌筋膜放鬆技術
- 關節鬆動術
- 功能性訓練設計`,

  treatment_details: `徒手治療

價格：自費 $800/次，健保給付需符合適應症
時長：每次60分鐘（包含評估15分鐘、治療40分鐘、運動指導5分鐘）

治療內容：
徒手治療是我們的核心服務之一，由經驗豐富的物理治療師親自執行。
治療師會先進行詳細的動作評估和觸診，找出疼痛或功能受限的根本原因。
接著運用各種徒手技術，包括：
- 關節鬆動術：改善關節活動度，減輕關節僵硬和疼痛
- 軟組織放鬆：針對緊繃的肌肉和筋膜進行深度放鬆
- 神經鬆動術：改善神經組織的延展性和滑動性
- 肌肉能量技術：透過病患主動配合的技術，改善肌肉張力和關節位置

治療過程中，治療師會持續與病患溝通，確保治療的舒適度和有效性。
治療結束後，治療師會提供居家運動指導，教導病患如何在家中繼續進行
復健運動，加速恢復並預防復發。

適用情況：
- 運動傷害：肌肉拉傷、韌帶扭傷、關節疼痛等
- 慢性疼痛：長期肩頸痠痛、下背痛、頭痛等
- 姿勢問題：圓肩、駝背、骨盆前傾等姿勢不良導致的疼痛
- 術後復健：手術後關節僵硬、疤痕組織沾黏等問題

治療效果：
透過專業的徒手治療，大多數病患在第一次治療後就能感受到明顯改善。
通常建議連續治療3-6次，配合居家運動，能達到最佳的治療效果。
我們會根據每位病患的狀況調整治療頻率和內容，確保個人化的照護。`,

  service_item_selection_guide: `如何選擇適合的服務項目？

選擇服務項目時，您可以根據以下指引來決定：

【根據症狀選擇】
- 急性疼痛或新發生的傷害（如：運動後突然疼痛、扭傷等）
  → 建議選擇「徒手治療」，可立即緩解疼痛並進行初步評估

- 慢性疼痛或長期不適（如：長期肩頸痠痛、下背痛等）
  → 建議選擇「徒手治療」搭配「運動治療」，從根本改善問題

- 術後復健或關節活動度受限
  → 建議選擇「徒手治療」配合「運動治療」，逐步恢復功能

- 想要提升運動表現或預防傷害
  → 建議選擇「運動治療」或「功能性訓練」

【根據治療目標選擇】
- 目標：快速緩解疼痛
  → 優先選擇「徒手治療」

- 目標：改善姿勢或動作模式
  → 建議「徒手治療」+「運動治療」組合

- 目標：恢復運動能力或提升表現
  → 建議「運動治療」或「功能性訓練」

- 目標：長期維持健康狀態
  → 建議定期進行「徒手治療」保養，並配合居家運動

【第一次來診的建議】
如果您是第一次來診，建議先選擇「徒手治療」進行完整評估。
治療師會在第一次治療時詳細了解您的狀況，並為您制定個人化的
治療計畫，之後再根據評估結果建議最適合的服務項目組合。

【不確定該選什麼？】
如果您不確定該選擇哪個服務項目，歡迎在預約時告訴我們您的症狀
或需求，我們會根據您的描述提供建議。或者您也可以先選擇「徒手治療」，
讓治療師在第一次評估後為您推薦最適合的治療方案。`,

  booking_policy: `預約方式：
- LINE預約：請使用LINE官方帳號下方的「選單」進行預約

取消與改期：
- 如需取消或改期，請於24小時前通知
- 若於24小時內取消，將收取50%的費用
- 若當天未到診且未通知，將收取全額費用
- 緊急情況（如突發疾病）可彈性處理，請主動聯繫我們

遲到處理：
- 遲到15分鐘內，仍可進行治療，但會縮短治療時間
- 遲到超過15分鐘，可能需要重新安排時段

注意事項：
- 本診所採預約制，不接受現場掛號
- 請提前預約以確保您能在理想的時段接受治療`,

  equipment_facilities: `我們擁有寬敞舒適的治療空間，總面積達80坪，分為多個獨立治療室和
開放式運動治療區。每個治療室都經過精心設計，確保病患的隱私和舒適。

專業設備：
我們配備了最新的物理治療設備，包括：
- 超音波治療儀：用於深層組織加熱，促進血液循環和組織修復
- 電療設備：包括經皮神經電刺激(TENS)、干擾波(IFC)等，有效緩解疼痛
- 冷熱敷設備：提供即時的疼痛緩解和消腫
- 牽引設備：針對頸椎和腰椎問題，安全有效地減輕椎間盤壓力

運動治療區：
我們的開放式運動治療區佔地30坪，配備了完整的運動訓練設備：
- 懸吊訓練系統(TRX)：用於核心穩定和功能性訓練
- 彈力帶和彈力球：多樣化的阻力訓練工具
- 平衡訓練設備：包括平衡板、BOSU球等，提升本體感覺和平衡能力
- 跑步機和固定式腳踏車：用於心肺功能訓練和漸進式負重訓練

環境特色：
診所採用溫暖的色調和柔和的燈光，營造出放鬆舒適的氛圍。
我們特別注重環境衛生，每個治療室在病患離開後都會徹底消毒，
確保下一位病患能在乾淨安全的環境中接受治療。
此外，我們還設有舒適的候診區，提供免費WiFi和茶水，讓等待的過程
也能很舒適。`,

  common_questions: `Q: 第一次來需要帶什麼？
A: 請攜帶健保卡（如使用健保）和相關的檢查報告（如X光片、MRI報告等）。
   如果之前在其他地方接受過治療，也歡迎帶相關的病歷資料，這有助於
   我們更全面地了解您的狀況。

Q: 需要預約嗎？
A: 是的，本診所採預約制，不接受現場掛號。請使用LINE官方帳號下方的「選單」
   進行預約，或透過線上預約系統提前預約，這樣可以確保您能在理想的時段
   接受治療。

Q: 治療需要多久時間？需要幾次？
A: 每次治療時間約60分鐘。治療次數會根據您的狀況而定，一般來說：
   - 急性傷害：約3-6次
   - 慢性問題：約6-12次
   - 術後復健：可能需要數個月
   治療師會在第一次評估後，為您制定個人化的治療計畫。

Q: 健保可以給付嗎？
A: 是的，我們是健保特約診所。健保給付的項目包括：物理治療、運動治療等。
   部分特殊治療項目（如徒手治療的某些技術）可能需要自費，治療師會
   在治療前向您說明。`,
};

const ChatSettings: React.FC<ChatSettingsProps> = ({
  chatSettings,
  onChatSettingsChange,
  isClinicAdmin = false,
}) => {
  const [showAiGuidancePopup, setShowAiGuidancePopup] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previousChatSettingsRef = useRef<ChatSettingsType | null>(null);
  const isInitialMountRef = useRef(true);

  // Listen for custom event to open test modal from header button
  useEffect(() => {
    const handleOpenTest = () => {
      if (chatSettings.chat_enabled) {
        setShowTestModal(true);
      }
    };
    window.addEventListener('open-chat-test', handleOpenTest);
    return () => {
      window.removeEventListener('open-chat-test', handleOpenTest);
    };
  }, [chatSettings.chat_enabled]);

  // Auto-close test modal when chat settings change
  useEffect(() => {
    // Skip on initial mount
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      previousChatSettingsRef.current = { ...chatSettings };
      return;
    }

    // Compare current settings with previous settings
    const prevSettings = previousChatSettingsRef.current;
    if (!prevSettings) {
      previousChatSettingsRef.current = { ...chatSettings };
      return;
    }

    // Use utility function for efficient comparison with normalization
    if (hasChatSettingsChanged(prevSettings, chatSettings) && showTestModal) {
      // Close modal when settings change to force fresh session
      setShowTestModal(false);
    }
    
    // Update ref for next comparison
    previousChatSettingsRef.current = { ...chatSettings };
  }, [chatSettings, showTestModal]);

  // Close popup when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showAiGuidancePopup &&
        popupRef.current &&
        buttonRef.current &&
        !popupRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowAiGuidancePopup(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showAiGuidancePopup) {
        setShowAiGuidancePopup(false);
      }
    };

    if (showAiGuidancePopup) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showAiGuidancePopup]);

  const handleToggle = (enabled: boolean) => {
    onChatSettingsChange({
      ...chatSettings,
      chat_enabled: enabled,
    });
  };

  const handleFieldChange = (field: keyof ChatSettingsType, value: string) => {
    onChatSettingsChange({
      ...chatSettings,
      [field]: value || null,
    });
  };

  const handleLoadTemplate = (field: keyof typeof TEMPLATES) => {
    onChatSettingsChange({
      ...chatSettings,
      [field]: TEMPLATES[field],
    });
  };

  const getCharacterCount = (value: string | null | undefined): number => {
    return value ? value.length : 0;
  };

  // Type for string-only fields in ChatSettings (excludes chat_enabled which is boolean)
  type StringChatSettingsField = Exclude<keyof ChatSettingsType, 'chat_enabled'>;

  const renderField = (
    label: string,
    field: StringChatSettingsField,
    placeholder: string,
    hasTemplate: boolean = false
  ) => {
    const fieldValue = chatSettings[field];
    const value = (fieldValue ?? '') as string;
    const charCount = getCharacterCount(fieldValue ?? null);
    const maxChars = 10000;
    const hasContent = charCount > 0;

    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-900">
            {label}
          </label>
          {hasTemplate && (
            <button
              type="button"
              onClick={() => handleLoadTemplate(field as keyof typeof TEMPLATES)}
              disabled={!isClinicAdmin || hasContent}
              className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasContent ? '欄位已有內容，請先清除後再使用範本' : '帶入範本'}
            >
              帶入範本
            </button>
          )}
        </div>
        <textarea
          value={value}
          onChange={(e) => handleFieldChange(field, e.target.value)}
          placeholder={placeholder}
          disabled={!isClinicAdmin}
          maxLength={maxChars}
          rows={6}
          className="input w-full resize-y"
        />
        <div className="flex justify-between mt-1">
          <p className="text-xs text-gray-500">
            最多 {maxChars.toLocaleString()} 字元
          </p>
          <p className={`text-xs ${charCount > maxChars * 0.9 ? 'text-orange-600' : 'text-gray-500'}`}>
            {charCount.toLocaleString()} / {maxChars.toLocaleString()}
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-6 max-w-2xl">
        {/* Toggle */}
        <div>
          <div className="flex items-center justify-between max-w-2xl">
            <label className="block text-sm font-medium text-gray-700">
              啟用 AI 聊天功能
            </label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={chatSettings.chat_enabled}
                onChange={(e) => handleToggle(e.target.checked)}
                disabled={!isClinicAdmin}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"></div>
            </label>
          </div>
        </div>

        {/* Expanded form - only show when toggle is ON */}
        {chatSettings.chat_enabled && (
          <div className="space-y-6 pt-4 border-t border-gray-200">
            {renderField(
              '診所介紹',
              'clinic_description',
              '簡短描述診所的特色、理念或服務重點...',
              true
            )}

            {renderField(
              '治療師介紹',
              'therapist_info',
              '介紹診所的治療師，包括專長和經驗...',
              true
            )}

            {renderField(
              '治療項目詳情',
              'treatment_details',
              '詳細說明各項治療服務，包括價格、時長、內容...',
              true
            )}

            {renderField(
              '服務項目選擇指南',
              'service_item_selection_guide',
              '提供病患選擇服務項目的指引和建議...',
              true
            )}

            {renderField(
              '營業時間',
              'operating_hours',
              '例如：週一至週五：09:00-18:00，週六：09:00-12:00...',
              false
            )}

            {renderField(
              '交通資訊',
              'location_details',
              '例如：診所位於捷運站出口步行5分鐘，附近有停車場...',
              false
            )}

            {renderField(
              '預約與取消政策',
              'booking_policy',
              '說明預約和取消的相關規定...',
              true
            )}

            {renderField(
              '付款方式',
              'payment_methods',
              '例如：接受健保、自費，可刷卡、現金、轉帳...',
              false
            )}

            {renderField(
              '設備與設施',
              'equipment_facilities',
              '介紹診所的設備和設施...',
              true
            )}

            {renderField(
              '常見問題',
              'common_questions',
              '列出病患常問的問題和答案...',
              true
            )}

            {renderField(
              '其他',
              'other_info',
              '其他診所相關資訊...',
              false
            )}

            {/* AI指引 field with info icon */}
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 relative">
                  <label className="block text-sm font-medium text-gray-900">
                    AI指引
                  </label>
                  <button
                    ref={buttonRef}
                    type="button"
                    onClick={() => setShowAiGuidancePopup(!showAiGuidancePopup)}
                    className="text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded-full p-1"
                    title="如何設定AI指引"
                    aria-label="顯示AI指引說明"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </button>
                  {showAiGuidancePopup && (
                    <div ref={popupRef} className="absolute left-0 top-8 z-50 w-96 max-w-[calc(100vw-2rem)] sm:max-w-md bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-h-[80vh] overflow-y-auto">
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowAiGuidancePopup(false)}
                          className="absolute top-0 right-0 text-gray-400 hover:text-gray-600 focus:outline-none"
                          aria-label="關閉"
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                        <h3 className="text-sm font-semibold text-gray-900 mb-2 pr-6">
                          如何設定AI指引
                        </h3>
                        <div className="text-sm text-gray-700 space-y-2">
                          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-3">
                            <p className="font-medium text-yellow-800 mb-1">⚠️ 重要提醒</p>
                            <p className="text-yellow-700 text-xs">
                              AI指引是進階功能，用於自訂AI的行為模式。除非您有明確的需求（例如：改變問候語風格、調整服務推廣時機），否則建議保持空白，使用系統預設值即可。
                            </p>
                          </div>
                          
                          <p>
                            AI指引可以自訂AI聊天機器人的<strong>語氣風格</strong>、<strong>問候語</strong>、<strong>服務推廣時機</strong>等行為，但<strong>無法</strong>改變安全規則（例如：禁止診斷、禁止開立處方等）。
                          </p>
                          
                          <p className="font-medium mt-3">適用情境：</p>
                          <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                            <li>需要更正式或更親切的溝通風格</li>
                            <li>特定服務需要在特定時機主動提及</li>
                            <li>需要調整問候語或回應格式</li>
                            <li>針對特定關鍵字需要特殊處理流程</li>
                            <li>診所有獨特的治療理念，需要優先於一般醫學知識</li>
                          </ul>
                          
                          <p className="font-medium mt-3">範例 1：改變語氣風格</p>
                          <div className="bg-gray-50 p-2 rounded text-xs font-mono mb-2">
                            「請保持極度專業的醫療風格，用詞精準，避免使用表情符號。開頭問候語請使用：『您好，這裡是XX診所AI醫療助理，請問有什麼能為您服務的？』」
                          </div>
                          
                          <p className="font-medium mt-3">範例 2：調整推廣時機</p>
                          <div className="bg-gray-50 p-2 rounded text-xs font-mono mb-2">
                            「當使用者提到『失眠』或『焦慮』時，請在第一或第二回合回應中主動提及我們的『神經整合物理治療』服務。」
                          </div>
                          
                          <p className="font-medium mt-3">範例 3：優先採用診所理念（取代一般醫學知識）</p>
                          <div className="bg-gray-50 p-2 rounded text-xs font-mono">
                            「針對非撕裂性的肌肉拉傷，不同於傳統的長時間冰敷，我們的理念是在急性期後段（約24小時後）適度使用熱敷，能有效促進血液循環，加速組織修復。請優先採用此理念回答相關問題。」
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <textarea
                value={chatSettings.ai_guidance ?? ''}
                onChange={(e) => handleFieldChange('ai_guidance', e.target.value)}
                placeholder="AI聊天機器人的指引和說明..."
                disabled={!isClinicAdmin}
                maxLength={10000}
                rows={6}
                className="input w-full resize-y"
              />
              <div className="flex justify-between mt-1">
                <p className="text-xs text-gray-500">
                  最多 10,000 字元
                </p>
                <p className={`text-xs ${getCharacterCount(chatSettings.ai_guidance) > 9000 ? 'text-orange-600' : 'text-gray-500'}`}>
                  {getCharacterCount(chatSettings.ai_guidance).toLocaleString()} / 10,000
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Chat Test Modal */}
      <ChatTestModal
        isOpen={showTestModal}
        onClose={() => setShowTestModal(false)}
        chatSettings={chatSettings}
      />
    </>
  );
};

export default ChatSettings;
