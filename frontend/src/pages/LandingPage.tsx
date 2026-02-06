import React from 'react';
import { Link } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';

const FeatureSection: React.FC<{
  title: string;
  valueProp: string;
  features: string[];
  imageSide: 'left' | 'right';
  placeholderDesc: string;
  bgColor?: string;
}> = ({ title, valueProp, features, imageSide, placeholderDesc, bgColor = 'bg-white' }) => {
  const textContent = (
    <div className="flex-1">
      <h2 className="text-3xl font-bold text-gray-900 mb-4">{title}</h2>
      <p className="text-lg text-primary-600 font-medium mb-6">{valueProp}</p>
      <ul className="space-y-4">
        {features.map((feature, index) => (
          <li key={index} className="flex items-start">
            <svg className="h-6 w-6 text-green-500 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-gray-700">{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  const imageContent = (
    <div className="flex-1 w-full lg:max-w-xl">
      <div className="bg-gray-100 border-2 border-dashed border-gray-300 rounded-2xl flex items-center justify-center aspect-video p-8 text-center group hover:border-primary-400 transition-colors">
        <div className="space-y-2">
          <svg className="mx-auto h-12 w-12 text-gray-400 group-hover:text-primary-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-sm font-medium text-gray-600">UI Mockup Placeholder</p>
          <p className="text-xs text-gray-400 max-w-xs">{placeholderDesc}</p>
        </div>
      </div>
    </div>
  );

  return (
    <section className={`${bgColor} py-16 md:py-24`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`flex flex-col ${imageSide === 'left' ? 'lg:flex-row-reverse' : 'lg:flex-row'} items-center gap-12 lg:gap-20`}>
          {textContent}
          {imageContent}
        </div>
      </div>
    </section>
  );
};

const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 to-white py-20 lg:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-4xl mx-auto">
            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-extrabold text-gray-900 tracking-tight mb-6">
              全方位診所資訊系統
            </h1>
            <p className="text-xl sm:text-2xl text-gray-600 mb-10 leading-relaxed max-w-4xl mx-auto px-4">
              釋放行政人力，讓醫療團隊專注於臨床專業，<br className="hidden md:block" />
              同時提升病患體驗與回診率。
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-center">
              <Link
                to="/free-trial"
                className="w-full sm:w-auto px-12 py-4 bg-primary-600 text-white text-lg font-semibold rounded-xl hover:bg-primary-700 shadow-lg shadow-primary-200 transition-all transform hover:-translate-y-1"
              >
                免費開始試用
              </Link>
            </div>
          </div>
        </div>

        {/* Abstract background element */}
        <div className="absolute top-0 right-0 -translate-y-1/4 translate-x-1/4 hidden lg:block">
          <div className="w-[600px] h-[600px] bg-primary-50 rounded-full blur-3xl opacity-50"></div>
        </div>
      </section>

      <div id="features">
        {/* Section 1: LINE 智能預約 */}
        <FeatureSection
          title="LINE 智能預約"
          valueProp="24/7 預約不打烊，極致簡單的病患旅程。"
          features={[
            "30秒自動預約：在 LINE 上點選療程與時段即可完成。",
            "診前自動提醒：系統自動發送訊息，有效降低爽約率。",
            "個人預約管理：病患可隨時查看，減輕櫃檯回覆壓力。",
            "空檔自動通知：時段釋出自動媒合候補，填補閒置人力。"
          ]}
          imageSide="right"
          placeholderDesc="LINE 畫面展示：使用者在 LINE 聊天室點選預約選單，顯示日期選擇器與時段確認按鈕。"
        />

        {/* Section 2: 智慧排班與資源管理 */}
        <FeatureSection
          title="智慧排班與資源管理"
          valueProp="資源最佳化，徹底杜絕撞單與混亂。"
          features={[
            "多維度排班：整合人力、診間、與儀器設備的綜合排班。",
            "自動資源分配：預約時自動分配診間設備，防止設備／診間超收。",
            "視覺化經營視角：一眼掌握全診所資源負荷狀況。"
          ]}
          imageSide="left"
          bgColor="bg-gray-50"
          placeholderDesc="管理後台畫面：精美的日曆視圖，結合了醫師、診間與設備的甘特圖式排班介面。"
        />

        {/* Section 3: 專業病歷系統 */}
        <FeatureSection
          title="專業病歷系統"
          valueProp="安全、便利、客製化的雲端病例系統。"
          features={[
            "自定義病歷模板：診所自定義各情境的病例模板。",
            "影像照片管理：雲端保存，安全又便利。",
            "歷史數據快查：秒速調閱過往病歷紀錄，確保治療連續性。"
          ]}
          imageSide="right"
          placeholderDesc="病歷編輯介面：顯示患者基本資料、左側歷史紀錄清單，以及右側包含圖片註解功能的病歷內容頁。"
        />

        {/* Section 4: 個案關懷與追蹤 */}
        <FeatureSection
          title="個案關懷與追蹤"
          valueProp="自動化關懷，提升病患回診率。"
          features={[
            "術後／診後關懷：根據診療項目定時自動發送追蹤訊息。",
            "客製化互動：根據不同的療程給予不同的衛教或關懷文字。",
            "提升黏著度：讓病患感受專業溫暖，將初次就診轉化為穩定客源。"
          ]}
          imageSide="left"
          bgColor="bg-gray-50"
          placeholderDesc="自動化流程介面：展示拖拉式的自動訊息排程工具，例如『診療後 24 小時發送關懷訊息』。"
        />

        {/* Section 5: 數位收據與結帳 */}
        <FeatureSection
          title="數位收據與結帳"
          valueProp="數位化快速結帳，告別繁瑣手寫，提升行政效率。"
          features={[
            "一鍵產製收據：結帳後即時生成數位收據。",
            "作廢稽核機制：嚴緊的作廢流程與原因記錄，杜絕財務漏洞。",
            "電子收據支援：提供 PDF 下載與 LINE 傳送，邁向無紙化診所。"
          ]}
          imageSide="right"
          placeholderDesc="結帳收據視圖：顯示診所數位收據樣貌，包含診療項目、金額、QR Code 以及手機端接收到的 LINE 收據預覽。"
        />

        {/* Section 6: 財務管理與自動分潤 */}
        <FeatureSection
          title="財務管理與自動分潤"
          valueProp="數據決策，一鍵搞定繁瑣分潤。"
          features={[
            "自動分潤計算：根據項目自動統計人員業績與佣金，月底結薪不再算錯。",
            "營收統計報表：視覺化呈現各項療程表現與團隊業績。"
          ]}
          imageSide="left"
          bgColor="bg-gray-50"
          placeholderDesc="數據報表介面：包含營收趨勢折線圖、療程佔比圓餅圖，以及醫師業績與分潤明細表。"
        />

        {/* Section 7: AI 智能客服 */}
        <FeatureSection
          title="AI 智能客服"
          valueProp="24／7 全天在線，不再漏接任何訊息，不錯過潛在客源。"
          features={[
            "知識庫可擴充：診所可自行上傳 FAQ、服務項目等資訊，讓 AI 成為專屬客服。",
            "精準回覆原則：僅根據診所提供的資訊進行回覆。",
            "專業嚴謹：嚴格過濾診斷建議，遇專業問題保持沉默或引進人工。"
          ]}
          imageSide="right"
          placeholderDesc="AI 設定介面：展示診所上傳文件（PDF/Word）的功能區塊，以及 AI 在 LINE 上回覆患者諮詢的對話範例。"
        />
      </div>

      {/* Customer Testimonial Section */}
      <section className="bg-primary-900 py-20 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold mb-16">各界專業診所的一致推薦</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 text-left border border-white/10">
                <div className="flex items-center mb-6">
                  <div className="w-12 h-12 bg-gray-300 rounded-full mr-4"></div>
                  <div>
                    <p className="font-bold">診所院長 {i}</p>
                    <p className="text-sm text-primary-200">OO 牙醫診所</p>
                  </div>
                </div>
                <p className="text-gray-300 italic leading-relaxed">
                  「這是一個令人驚艷的系統。自從導入後，我們的行政效率提升了 40%，且病患對於 LINE 預約的便利性評價極高。作為管理者，我現在能對診所的營運狀況有更即時、更精確的掌握。」
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-white py-20 border-t border-gray-100">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">準備好全面升級您的診所了嗎？</h2>
          <p className="text-lg text-gray-600 mb-10">立即加入 100+ 診所的選擇，體驗自動化營運的力量。</p>
          <Link
            to="/free-trial"
            className="inline-block px-10 py-5 bg-primary-600 text-white text-xl font-bold rounded-xl hover:bg-primary-700 shadow-xl shadow-primary-200 transition-all transform hover:-translate-y-1"
          >
            免費申請體驗
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-50 border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center text-gray-500">
            <p className="mb-4 font-bold text-gray-900">診所小幫手</p>
            <p className="text-sm">&copy; {new Date().getFullYear()} 診所小幫手. 版權所有.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;

