import React from 'react';
import { Link } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';

const FeatureSection: React.FC<{
  title: string;
  valueProp: string;
  features: string[];
  imageSide: 'left' | 'right';
  mockup: React.ReactNode;
  bgColor?: string;
}> = ({ title, valueProp, features, imageSide, mockup, bgColor = 'bg-white' }) => {
  const textContent = (
    <div className="flex-1 lg:py-12">
      <h2 className="text-3xl font-bold text-gray-900 mb-4">{title}</h2>
      <p className="text-lg text-primary-600 font-medium mb-6 leading-relaxed">{valueProp}</p>
      <ul className="space-y-4">
        {features.map((feature, index) => (
          <li key={index} className="flex items-start">
            <div className="mt-1 flex-shrink-0">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-primary-600">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <span className="ml-3 text-gray-700 leading-6 font-medium">{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section className={`${bgColor} py-20 md:py-32 overflow-hidden`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`flex flex-col ${imageSide === 'left' ? 'lg:flex-row-reverse' : 'lg:flex-row'} items-center gap-16 lg:gap-24`}>
          {textContent}
          <div className="flex-1 w-full relative">
            <div className="relative group">
              {/* Decorative background glow */}
              <div className="absolute -inset-4 bg-gradient-to-r from-primary-200 to-blue-200 rounded-3xl blur-2xl opacity-30 group-hover:opacity-50 transition-opacity duration-500"></div>
              {mockup}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// --- Mockup Components ---

const LineBookingMock = () => (
  <div className="mx-auto w-[280px] h-[560px] bg-gray-900 rounded-[3rem] p-3 shadow-2xl border-[6px] border-gray-800 relative overflow-hidden">
    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-800 rounded-b-2xl z-20"></div>
    <div className="h-full w-full bg-[#7494C0] rounded-[2rem] overflow-hidden flex flex-col pt-8">
      <div className="bg-white/10 backdrop-blur-md p-3 flex items-center gap-3 border-b border-white/10">
        <div className="w-8 h-8 rounded-full bg-white/20"></div>
        <div className="text-xs text-white font-bold">OO 診所官方帳號</div>
      </div>
      <div className="flex-1 p-4 space-y-4">
        <div className="bg-white rounded-2xl p-3 shadow-sm max-w-[80%]">
          <p className="text-[10px] text-gray-700">您好！請問想預約什麼時段？</p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg border border-primary-100 overflow-hidden ml-auto max-w-[90%]">
          <div className="bg-primary-50 px-3 py-2 border-b border-primary-100">
            <p className="text-[10px] font-bold text-primary-700">🗓️ 選擇預約時段</p>
          </div>
          <div className="p-3 grid grid-cols-2 gap-2">
            {['10:00', '11:30', '14:00', '15:30'].map(t => (
              <div key={t} className={`text-[9px] py-1.5 text-center rounded border ${t === '10:00' ? 'border-primary-500 bg-primary-600 text-white' : 'border-gray-200 text-gray-600'}`}>
                {t}
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-gray-50 flex justify-center">
            <div className="text-[9px] text-primary-600 font-bold underline">查看更多時段</div>
          </div>
        </div>
      </div>
      <div className="bg-white h-12 flex items-center px-4 gap-2">
        <div className="flex-1 h-8 bg-gray-100 rounded-full px-3 flex items-center text-[10px] text-gray-400 italic">在此輸入訊息...</div>
        <div className="w-8 h-8 rounded-full bg-primary-600"></div>
      </div>
    </div>
  </div>
);

const SchedulingMock = () => (
  <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden max-w-2xl mx-auto">
    <div className="bg-gray-50 p-4 border-b border-gray-100 flex justify-between items-center text-xs font-medium text-gray-500">
      <div className="flex gap-4">
        <span className="text-primary-600">資源排班表</span>
        <span>人力管理</span>
        <span>診間負載</span>
      </div>
      <div className="bg-white border border-gray-200 px-2 py-1 rounded">2026/02/06</div>
    </div>
    <div className="p-4">
      <div className="grid grid-cols-6 gap-px bg-gray-100 border border-gray-100 rounded overflow-hidden">
        {['資源', '09:00', '10:00', '11:00', '12:00', '13:00'].map(h => (
          <div key={h} className="bg-gray-50 p-2 text-[10px] text-center font-bold text-gray-400">{h}</div>
        ))}
        {['王醫師', '陳醫師', '診間 A', '設備 X'].map((r, i) => (
          <React.Fragment key={r}>
            <div className="bg-white p-2 text-[10px] font-bold border-r border-b border-gray-100">{r}</div>
            {[1, 2, 3, 4, 5].map(j => (
              <div key={j} className="bg-white p-2 border-r border-b border-gray-100 relative">
                {(i + j) % 3 === 0 && (
                  <div className="absolute inset-1 rounded bg-primary-100 border-l-4 border-primary-500 p-1">
                    <div className="text-[8px] text-primary-700 font-bold truncate">病患預約</div>
                  </div>
                )}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  </div>
);

const MedicalRecordMock = () => (
  <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex h-[400px]">
    <div className="w-1/3 bg-gray-50 border-r border-gray-100 p-4 space-y-4">
      <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="space-y-2">
          <div className="h-2 w-1/2 bg-gray-200 rounded"></div>
          <div className="h-3 w-full bg-gray-100 rounded"></div>
        </div>
      ))}
    </div>
    <div className="flex-1 p-6 space-y-6">
      <div className="flex justify-between">
        <div className="space-y-1">
          <div className="h-4 w-32 bg-gray-200 rounded"></div>
          <div className="h-3 w-48 bg-gray-100 rounded"></div>
        </div>
        <div className="w-12 h-12 bg-primary-50 rounded-full"></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="h-32 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center">
          <span className="text-[10px] text-gray-400">影像上傳...</span>
        </div>
        <div className="space-y-2">
          <div className="h-2 bg-gray-100 rounded"></div>
          <div className="h-2 bg-gray-100 rounded"></div>
          <div className="h-2 bg-gray-100 rounded w-2/3"></div>
        </div>
      </div>
      <div className="h-20 bg-primary-50/50 rounded-xl p-4">
        <div className="h-2 w-full bg-primary-200/50 rounded mb-2"></div>
        <div className="h-2 w-full bg-primary-200/50 rounded mb-2"></div>
        <div className="h-2 w-2/3 bg-primary-200/50 rounded"></div>
      </div>
    </div>
  </div>
);

const AutomationFlowMock = () => (
  <div className="bg-white rounded-2xl shadow-2xl p-8 border border-gray-100 max-w-md mx-auto relative">
    <div className="space-y-12">
      {[
        { label: '療程結束', color: 'bg-green-500', icon: '✅' },
        { label: '等待 24 小時', color: 'bg-amber-500', icon: '⏳' },
        { label: '發送術後關懷', color: 'bg-primary-500', icon: '📱' }
      ].map((step, i, arr) => (
        <div key={step.label} className="relative">
          <div className="flex items-center gap-6">
            <div className={`w-12 h-12 ${step.color} rounded-2xl shadow-lg flex items-center justify-center text-xl`}>
              {step.icon}
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">STEP {i + 1}</p>
              <p className="text-lg font-bold text-gray-900">{step.label}</p>
            </div>
          </div>
          {i < arr.length - 1 && (
            <div className="absolute left-6 top-12 w-0.5 h-12 bg-gradient-to-b from-gray-200 to-transparent"></div>
          )}
        </div>
      ))}
    </div>
    <div className="absolute top-4 right-4 bg-primary-50 text-primary-600 text-[10px] font-bold px-2 py-1 rounded">
      AUTO-PILOT ON
    </div>
  </div>
);

const DigitalReceiptMock = () => (
  <div className="flex flex-col md:flex-row items-center gap-8 justify-center">
    <div className="bg-white w-56 h-80 rounded shadow-xl border border-gray-200 p-6 space-y-4 transform -rotate-3 hover:rotate-0 transition-transform duration-500">
      <div className="text-center font-serif text-lg border-b border-gray-100 pb-2">CLINIC RECEIPT</div>
      <div className="space-y-2 text-[10px]">
        <div className="flex justify-between"><span>Physiotherapy</span><span>$1,200</span></div>
        <div className="flex justify-between"><span>Consultation</span><span>$300</span></div>
        <div className="border-t border-gray-100 pt-2 flex justify-between font-bold">
          <span>TOTAL</span><span>$1,500</span>
        </div>
      </div>
      <div className="w-16 h-16 bg-gray-100 mx-auto"></div>
      <div className="text-[8px] text-center text-gray-400">Thank you!</div>
    </div>
    <div className="w-48 h-[360px] bg-gray-900 rounded-[2.5rem] p-2 border-4 border-gray-800 shadow-2xl relative overflow-hidden hidden sm:block">
      <div className="h-full w-full bg-[#7494C0] rounded-[2rem] p-3 pt-6 space-y-3">
        <div className="bg-white rounded-lg p-3 shadow-lg scale-90 translate-y-4">
          <p className="text-[10px] font-bold mb-1">您的電子收據已送達 🧾</p>
          <div className="h-1 bg-primary-600 rounded"></div>
          <p className="text-[8px] text-gray-500 mt-2">點擊以下連結查看完整明細...</p>
        </div>
      </div>
    </div>
  </div>
);

const FinancialDashboardMock = () => (
  <div className="bg-[#111827] rounded-2xl shadow-2xl p-6 border border-gray-800 space-y-6">
    <div className="grid grid-cols-2 gap-4">
      {[
        { l: '月營收', v: '$1.2M', c: 'text-green-400' },
        { l: '成長率', v: '+24%', c: 'text-primary-400' }
      ].map(s => (
        <div key={s.l} className="bg-gray-800/50 p-4 rounded-xl border border-white/5">
          <p className="text-[10px] text-gray-400 mb-1">{s.l}</p>
          <p className={`text-xl font-bold ${s.c}`}>{s.v}</p>
        </div>
      ))}
    </div>
    <div className="space-y-3">
      <div className="flex justify-between text-[10px] text-gray-400"><span>業績佔比</span><span>由高至低</span></div>
      {[60, 45, 30].map((w, i) => (
        <div key={i} className="h-8 bg-gray-800/50 rounded flex items-center px-4">
          <div style={{ width: `${w}%` }} className="h-2 bg-primary-500 rounded shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
        </div>
      ))}
    </div>
    <div className="pt-4 border-t border-white/5 flex gap-2">
      {[1, 2, 3, 4, 5].map(i => <div key={i} className="flex-1 h-12 bg-gray-800 rounded-sm"></div>)}
    </div>
  </div>
);

const AISetupMock = () => (
  <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
    <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-primary-600 rounded flex items-center justify-center text-[10px] text-white">AI</div>
        <span className="text-xs font-bold">知識庫設定</span>
      </div>
      <div className="h-6 w-12 bg-primary-200 rounded-full flex items-center px-1">
        <div className="w-4 h-4 bg-primary-600 rounded-full ml-auto"></div>
      </div>
    </div>
    <div className="p-6 flex gap-6">
      <div className="w-1/2 space-y-3">
        <div className="text-[10px] text-gray-400 font-bold">已上傳文件</div>
        {['FAQ.pdf', '服務項目.docx'].map(f => (
          <div key={f} className="p-2 border border-gray-100 rounded text-[9px] flex items-center gap-2">
            <span className="text-primary-500">📄</span> {f}
          </div>
        ))}
        <div className="h-12 border-2 border-dashed border-gray-200 rounded flex items-center justify-center text-[9px] text-gray-400 italic">點此上傳更多...</div>
      </div>
      <div className="w-1/2 bg-gray-50 rounded-xl p-3 space-y-2 border border-gray-100">
        <div className="text-[8px] text-gray-400 font-bold mb-2">AI 預覽</div>
        <div className="bg-white p-2 rounded-lg rounded-bl-none text-[8px] border border-gray-100">請問你們的拔牙費用？</div>
        <div className="bg-primary-600 text-white p-2 rounded-lg rounded-br-none text-[8px] ml-auto w-[90%]">您好！根據知識庫，我們的拔牙費用依難易度約為 $500 - $2,000...</div>
      </div>
    </div>
  </div>
);

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
          mockup={<LineBookingMock />}
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
          mockup={<SchedulingMock />}
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
          mockup={<MedicalRecordMock />}
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
          mockup={<AutomationFlowMock />}
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
          mockup={<DigitalReceiptMock />}
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
          mockup={<FinancialDashboardMock />}
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
          mockup={<AISetupMock />}
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

