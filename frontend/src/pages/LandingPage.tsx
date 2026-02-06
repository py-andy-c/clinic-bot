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
  activeIndex?: number;
  onHoverFeature?: (index: number) => void;
  onLeaveFeature?: () => void;
}> = ({ title, valueProp, features, imageSide, mockup, bgColor = 'bg-white', activeIndex = -1, onHoverFeature, onLeaveFeature }) => {
  const textContent = (
    <div className="flex-1 lg:py-12">
      <h2 className="text-3xl font-bold text-gray-900 mb-4">{title}</h2>
      <p className="text-lg text-primary-600 font-medium mb-8 leading-relaxed">{valueProp}</p>
      <ul className="space-y-6">
        {features.map((feature, index) => (
          <li
            key={index}
            className={`flex items-start transition-all duration-500 rounded-xl p-4 -ml-4 ${index === activeIndex ? 'bg-primary-50 translate-x-3' : 'opacity-60'}`}
            onMouseEnter={() => onHoverFeature?.(index)}
            onMouseLeave={() => onLeaveFeature?.()}
          >
            <div className={`mt-1 flex-shrink-0 transition-colors duration-500 ${index === activeIndex ? 'text-primary-600' : 'text-gray-400'}`}>
              <div className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-500 border-2 ${index === activeIndex ? 'bg-white border-primary-500 shadow-sm' : 'bg-gray-100 border-transparent'}`}>
                {index === activeIndex ? (
                  <span className="text-sm font-bold">{index + 1}</span>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
            <span className={`ml-4 text-base leading-7 font-semibold transition-colors duration-500 ${index === activeIndex ? 'text-gray-900' : 'text-gray-500'}`}>
              {feature}
            </span>
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
              <div className="absolute -inset-8 bg-gradient-to-r from-primary-200 to-blue-200 rounded-[3rem] blur-3xl opacity-20 group-hover:opacity-40 transition-opacity duration-700"></div>
              <div className="relative transition-all duration-700 animate-in fade-in zoom-in-95">
                {mockup}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// --- Mockup Components ---

const LineBookingMock = ({ scenario }: { scenario: number }) => {
  const renderContent = () => {
    switch (scenario) {
      case 0: // LIFF Booking View (Accuracy: Real LIFF app is a webview)
        return (
          <div key="liff" className="h-full bg-white animate-in fade-in slide-in-from-bottom-2 duration-700 pt-8 rounded-t-[1.5rem] flex flex-col shadow-inner">
            {/* LIFF Header */}
            <div className="bg-white border-b border-gray-100 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-gray-100 rounded-full flex items-center justify-center text-[10px]">✕</div>
                <span className="text-sm font-bold text-gray-800">預約掛號</span>
              </div>
              <div className="flex gap-1">
                <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
              </div>
            </div>
            {/* Selection Grid */}
            <div className="flex-1 p-5 overflow-y-auto">
              <p className="text-xs font-bold text-gray-500 mb-4">選擇預約時段 - 02/06 (五)</p>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {['09:00', '10:30', '14:00', '15:30'].map(t => (
                  <div key={t} className={`p-4 rounded-xl border-2 text-center transition-all ${t === '14:00' ? 'border-primary-500 bg-primary-50 text-primary-600 font-bold' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    <div className="text-xs">{t}</div>
                  </div>
                ))}
              </div>
              <div className="bg-primary-50 p-4 rounded-xl border border-primary-100">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] text-primary-700 font-bold">已選時段</span>
                  <span className="text-[10px] text-gray-600 font-bold">王大明 治療師</span>
                </div>
                <div className="text-sm font-bold text-primary-900">02/06 (五) 14:00 - 物理治療</div>
              </div>
            </div>
            {/* Action Button */}
            <div className="p-4 border-t border-gray-50 bg-white">
              <button className="w-full bg-primary-600 text-white py-4 rounded-xl text-sm font-bold shadow-lg shadow-primary-200">
                下一步
              </button>
            </div>
          </div>
        );
      case 1: // Reminder (Accuracy: Matches DEFAULT_REMINDER_MESSAGE)
        return (
          <div key="reminder" className="p-4 pt-4 space-y-4 animate-in fade-in slide-in-from-right-4 duration-700">
            <div className="bg-white rounded-2xl p-5 shadow-lg border-t-4 border-amber-400 text-gray-700">
              <p className="text-sm leading-relaxed">
                提醒您，您預約的<span className="font-bold">【物理治療】</span>預計於<span className="font-bold">【02/06 14:00】</span>開始，由<span className="font-bold">【王大明治療師】</span>為您服務。
              </p>
              <p className="text-sm mt-3">請準時前往診所，期待為您服務！</p>
            </div>
          </div>
        );
      case 2: // Vacancy (Accuracy: Matches batched slot display)
        return (
          <div key="vacancy" className="p-4 pt-4 space-y-4 animate-in fade-in slide-in-from-right-4 duration-700">
            <div className="bg-white rounded-2xl p-5 shadow-lg border-t-4 border-primary-500 text-gray-700">
              <p className="text-sm font-bold mb-4">
                【空位提醒】您關注的預約時段有新的空位了！
              </p>
              <div className="space-y-1 mb-4 text-xs">
                <p>預約類型：物理治療</p>
                <p>治療師：不指定</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <p className="text-xs font-bold mb-2 text-gray-700">可用時間：</p>
                <div className="space-y-2">
                  <p className="text-sm font-medium">02/06 (五): 14:00, 15:30</p>
                  <p className="text-sm font-medium">02/07 (六): 09:00, 10:30</p>
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="mx-auto w-[310px] h-[640px] bg-gray-900 rounded-[3.5rem] p-4 shadow-[0_0_80px_-15px_rgba(0,0,0,0.6)] border-[10px] border-gray-800 relative overflow-hidden transform group-hover:scale-[1.02] transition-transform duration-700">
      {/* Phone status bar */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-36 h-8 bg-gray-800 rounded-b-[2rem] z-30 flex items-center justify-center gap-2 font-mono text-[8px] text-gray-500 pt-1">
        <span>9:41</span>
        <div className="w-12 h-1.5 bg-gray-900 rounded-full"></div>
        <span>🔋</span>
      </div>

      <div className={`h-full w-full rounded-[2.8rem] overflow-hidden flex flex-col transition-colors duration-1000 ${scenario === 0 ? 'bg-gray-100' : 'bg-gradient-to-b from-[#7494C0] to-[#5A7BA8]'}`}>
        {/* LINE navigation - only show in Scenario 1 and 2 */}
        {scenario !== 0 && (
          <div className="bg-white/10 backdrop-blur-md p-5 pb-3 flex items-center justify-between border-b border-white/10 pt-12 text-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 border border-white/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z" />
                </svg>
              </div>
              <div className="text-sm font-bold tracking-wide">健康診所</div>
            </div>
            <div className="w-6 h-6 rotate-90 opacity-60">⋮</div>
          </div>
        )}

        {/* Main Interface Area */}
        <div className="flex-1 overflow-hidden relative">
          {renderContent()}
        </div>

        {/* Messenger Footer - only show in Scenario 1 and 2 */}
        {scenario !== 0 && (
          <div className="bg-white h-20 flex items-center px-6 gap-3 mt-auto shadow-2xl">
            <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 font-bold transition-transform hover:scale-110">+</div>
            <div className="flex-1 h-10 bg-gray-100 rounded-full px-5 flex items-center text-xs text-gray-400 italic whitespace-nowrap truncate">請輸入訊息...</div>
            <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center shadow-lg shadow-primary-200">
              <svg className="w-5 h-5 text-white rotate-90" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const SchedulingMock = ({ scenario }: { scenario: number }) => {
  const [dragProgress, setDragProgress] = React.useState(0);
  const [showConflict, setShowConflict] = React.useState(false);
  const [autoState, setAutoState] = React.useState<'idle' | 'clicking' | 'created'>('idle');

  // Animation controller
  React.useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (scenario === 0) { // Scenario 0: Auto Allocation with Click
      setAutoState('idle');
      let step = 0;
      interval = setInterval(() => {
        step = (step + 1) % 40;
        if (step < 10) setAutoState('idle');
        else if (step < 20) setAutoState('clicking');
        else setAutoState('created');
      }, 150);
    } else if (scenario === 1) { // Scenario 1: Linked Drag and Drop
      setDragProgress(0);
      let progress = 0;
      interval = setInterval(() => {
        progress += 0.02;
        if (progress > 1) progress = 0;
        setDragProgress(progress);
      }, 50);
    } else if (scenario === 2) { // Scenario 2: Conflict Prevention
      setShowConflict(false);
      interval = setInterval(() => {
        setShowConflict(prev => !prev);
      }, 800);
    } else {
      setDragProgress(0);
      setShowConflict(false);
      setAutoState('idle');
    }
    return () => clearInterval(interval);
  }, [scenario]);

  const timeSlots = ['09:00', '10:00', '11:00', '12:00'];
  const resources = [
    { name: '王院長', type: '專科醫師', color: 'blue' },
    { name: '陳醫師', type: '住院醫師', color: 'indigo' },
    { name: '診間 A', type: 'ROOM', color: 'emerald' },
    { name: '診間 B', type: 'ROOM', color: 'teal' }
  ];

  const getDragTransform = () => {
    if (scenario !== 1) return '';
    const yOffset = Math.sin(dragProgress * Math.PI) * 120;
    return `translateY(${yOffset}px)`;
  };

  return (
    <div className="max-w-3xl mx-auto transform transition-all duration-700">
      <div className="grid grid-cols-[60px_1fr_1fr_1fr_1fr] bg-white rounded-2xl overflow-hidden border border-gray-200 shadow-xl relative">
        {/* Cursor Overlay for Scenario 0 */}
        {scenario === 0 && (
          <div
            className={`absolute z-50 pointer-events-none transition-all duration-700 ease-in-out
              ${autoState === 'idle' ? 'top-1/2 left-1/4 opacity-0' :
                autoState === 'clicking' ? 'top-[164px] left-[140px] opacity-100 scale-90' :
                  'top-[164px] left-[140px] opacity-0 scale-75'}`}
          >
            <div className="relative">
              <svg className="w-8 h-8 text-primary-600 drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
                <path d="M7 2l12 11.2l-5.8 0.5l3.3 7.3l-2.2 1l-3.2-7.4l-4.1 3.9z" />
              </svg>
              {autoState === 'clicking' && (
                <div className="absolute top-0 left-0 w-8 h-8 rounded-full bg-primary-400/30 animate-ping"></div>
              )}
            </div>
          </div>
        )}

        {/* Categorical Headers */}
        <div className="p-2 border-b border-r border-gray-100 bg-gray-50/50"></div>
        <div className="col-span-2 p-2 border-b border-r border-blue-100 bg-blue-50/50 text-center">
          <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">醫療團隊</span>
        </div>
        <div className="col-span-2 p-2 border-b border-gray-100 bg-emerald-50/50 text-center">
          <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">空間資源</span>
        </div>

        {/* Header Row */}
        <div className="p-4 border-b border-r border-gray-100 bg-gray-50/80"></div>
        {resources.map((res, idx) => (
          <div key={res.name} className={`p-4 border-b border-gray-100 text-center flex items-center justify-center
            ${idx < 2 ? 'bg-blue-50/30 border-r border-blue-100' : 'bg-emerald-50/30 border-r border-emerald-100'}
            ${idx === 1 ? 'border-r-2 border-r-gray-200' : ''}`}
          >
            <p className="text-[12px] font-bold text-gray-900 leading-tight">{res.name}</p>
          </div>
        ))}

        {/* Time Rows */}
        {timeSlots.map((time, timeIdx) => (
          <React.Fragment key={time}>
            <div className="p-4 border-b border-r border-gray-100 bg-gray-100/10 text-center flex items-start justify-center h-28">
              <span className="text-[11px] font-bold text-gray-400 mt-1">{time}</span>
            </div>

            {resources.map((res, resIdx) => (
              <div key={`${time}-${res.name}`} className={`relative border-b border-white h-28 group
                ${resIdx < 2 ? 'bg-blue-50/5 border-r border-blue-50/50' : 'bg-emerald-50/5 border-r border-emerald-50/50'}
                ${resIdx === 1 ? 'border-r-2 border-r-gray-100' : ''}`}
              >
                {/* Visual Context: Existing Appointments */}
                {((resIdx === 1 && timeIdx === 0) || (resIdx === 3 && timeIdx === 0)) && (
                  <div className="absolute inset-x-2 inset-y-2">
                    <div className={`h-full w-full rounded-xl border-l-4 shadow-md p-3 flex flex-col justify-center
                        ${resIdx === 1 ? 'bg-indigo-50 border-indigo-500' : 'bg-teal-50 border-teal-500'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-gray-900 truncate">門診預約</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Scenario 0: Auto Allocation (Practitioner Click & Room Auto-Fill) */}
                {scenario === 0 && timeIdx === 1 && autoState === 'created' && (resIdx === 0 || resIdx === 2) && (
                  <div className="absolute inset-x-2 inset-y-2 animate-in zoom-in-95 fade-in duration-500">
                    <div className={`h-full w-full rounded-xl border-l-4 shadow-md p-3 flex flex-col justify-center transition-all duration-300
                      ${resIdx === 0 ? 'bg-blue-50 border-blue-500' : 'bg-emerald-50 border-emerald-500'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-gray-900 truncate">門診預約</span>
                        {resIdx === 2 && <span className="text-[8px] font-black text-emerald-600 animate-pulse">AUTO</span>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Scenario 1: Linked Drag and Drop */}
                {scenario === 1 && timeIdx === 0 && (resIdx === 0 || resIdx === 2) && (
                  <div
                    className="absolute inset-x-2 inset-y-2 z-10 transition-transform duration-75"
                    style={{ transform: getDragTransform() }}
                  >
                    <div className={`h-full w-full rounded-xl border-l-4 shadow-2xl p-3 flex flex-col justify-center text-white opacity-95
                      ${resIdx === 0 ? 'bg-blue-600 border-blue-700' : 'bg-emerald-600 border-emerald-700'}`}
                    >
                      <span className="text-[10px] font-bold">同步移動</span>
                      <div className="mt-2 h-1 w-full bg-white/20 rounded-full overflow-hidden">
                        <div className="h-full bg-white animate-[pulse_1.5s_infinite]" style={{ width: '60%' }}></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Scenario 2: Conflict Prevention */}
                {scenario === 2 && resIdx === 2 && timeIdx === 0 && (
                  <>
                    <div className="absolute inset-x-2 inset-y-2 bg-purple-50 border-l-4 border-purple-200 rounded-xl p-3 opacity-40">
                      <span className="text-[8px] font-bold text-gray-400">已佔用</span>
                    </div>
                    <div className={`absolute inset-x-2 inset-y-2 rounded-xl border-2 border-dashed flex items-center justify-center transition-all duration-300
                      ${showConflict ? 'bg-red-50 border-red-500 scale-105 z-20' : 'bg-transparent border-transparent'}`}
                    >
                      {showConflict && (
                        <div className="text-center p-2">
                          <div className="text-[20px] mb-1 animate-bounce">🚫</div>
                          <span className="text-[9px] font-black text-red-600 uppercase tracking-tighter">時段衝突</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

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
  const [activeLineFeature, setActiveLineFeature] = React.useState(0);
  const [activeSchedulingFeature, setActiveSchedulingFeature] = React.useState(0);
  const [isPaused, setIsPaused] = React.useState(false);

  React.useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setActiveLineFeature((prev) => (prev + 1) % 3);
      setActiveSchedulingFeature((prev) => (prev + 1) % 3);
    }, 4500);
    return () => clearInterval(interval);
  }, [isPaused]);

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

      <div id="features" className="divide-y divide-gray-100">
        {/* Section 1: LINE 智能預約 */}
        <FeatureSection
          title="LINE 智能預約"
          valueProp="24/7 預約不打烊，極致簡單的病患旅程。"
          features={[
            "30秒自動預約：在 LINE 上點選療程與時段即可完成。",
            "診前自動提醒：系統自動發送訊息，有效降低爽約率。",
            "空檔自動通知：時段釋出自動媒合候補，填補閒置人力。"
          ]}
          imageSide="right"
          activeIndex={activeLineFeature}
          onHoverFeature={(index) => {
            setActiveLineFeature(index);
            setIsPaused(true);
          }}
          onLeaveFeature={() => setIsPaused(false)}
          mockup={<LineBookingMock scenario={activeLineFeature} />}
        />

        {/* Section 2: 智慧排班與資源管理 */}
        <FeatureSection
          title="智慧排班與資源管理"
          valueProp="資源最佳化，徹底杜絕撞單與混亂。"
          features={[
            "一鍵預約，萬全準備：預約瞬間自動鎖定診間與儀器，無需人工核對。",
            "連動式拖拉排班：移動預約時，所有關聯資源同步更新，流程不中斷。",
            "智能衝突斷路：實時偵測資源超收，從源頭阻斷排班錯誤。"
          ]}
          imageSide="left"
          bgColor="bg-gray-50"
          activeIndex={activeSchedulingFeature}
          onHoverFeature={(index) => {
            setActiveSchedulingFeature(index);
            setIsPaused(true);
          }}
          onLeaveFeature={() => setIsPaused(false)}
          mockup={<SchedulingMock scenario={activeSchedulingFeature} />}
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

