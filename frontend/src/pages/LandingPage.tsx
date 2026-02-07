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
    <div className="w-full flex-1 lg:py-12">
      <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-1 lg:mb-4 text-left">{title}</h2>
      <p className="text-sm lg:text-lg text-primary-600 font-medium mb-3 lg:mb-8 leading-relaxed text-left">{valueProp}</p>

      {/* Feature List - Static Full Text for Mobile */}
      <ul className="w-full space-y-3 lg:space-y-6 text-left">
        {features.map((feature, index) => {
          const isActive = index === activeIndex;

          return (
            <li
              key={index}
              className={`group relative flex items-center transition-all duration-300 lg:-ml-4 lg:p-4 lg:rounded-2xl
                ${isActive ? 'opacity-100 lg:bg-primary-50 lg:translate-x-3' : 'opacity-100'}`}
              onMouseEnter={() => onHoverFeature?.(index)}
              onMouseLeave={() => onLeaveFeature?.()}
            >
              <div className={`flex-shrink-0 transition-colors duration-500 ${isActive || activeIndex === -1 ? 'text-primary-600' : 'text-gray-500'}`}>
                <div className={`flex h-5 w-5 lg:h-8 lg:w-8 items-center justify-center rounded-full transition-all duration-500 border-2 ${isActive || activeIndex === -1 ? 'bg-white border-primary-500 shadow-sm' : 'bg-gray-100 border-transparent'}`}>
                  <span className="text-[9px] lg:text-sm font-bold">{index + 1}</span>
                </div>
              </div>
              <div className="ml-3 lg:ml-4 flex-1">
                <p className={`text-[14px] lg:text-base leading-snug lg:leading-7 transition-colors duration-500 ${isActive || activeIndex === -1 ? 'text-gray-900 font-bold' : 'text-gray-700 font-semibold'}`}>
                  {feature}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <section className={`${bgColor} py-6 lg:py-32 overflow-hidden`}>
      <div className="max-w-7xl mx-auto px-4 lg:px-8">
        <div className={`flex flex-col ${imageSide === 'left' ? 'lg:flex-row-reverse' : 'lg:flex-row'} lg:items-center gap-4 lg:gap-24`}>
          {textContent}

          {/* Mockup - Edge-to-edge oriented for Mobile */}
          <div className="w-full flex-1 relative mt-4 lg:mt-0">
            <div className="relative group mx-auto max-w-full lg:max-w-none">
              {/* Decorative background glow - Hidden on mobile to avoid overlapping with text */}
              <div className="hidden lg:block absolute lg:-inset-8 bg-gradient-to-r from-primary-200 to-blue-200 rounded-[3rem] blur-2xl opacity-10 group-hover:opacity-40 transition-opacity duration-700"></div>
              <div key={activeIndex} className="relative transition-all duration-700 animate-in fade-in zoom-in-95 transform lg:scale-100 origin-top">
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
            <div className="bg-white rounded-2xl p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1)] border-t-4 border-amber-400 text-gray-700">
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
            <div className="bg-white rounded-2xl p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1)] border-t-4 border-primary-500 text-gray-700">
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
    <div className="mx-auto w-[310px] h-[640px] bg-gray-900 rounded-[3.5rem] p-4 shadow-[0_40px_80px_-15px_rgba(0,0,0,0.4)] border-[10px] border-gray-800 relative overflow-hidden transform group-hover:scale-[1.02] transition-transform duration-700">
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
            <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center shadow-lg shadow-primary-200/50">
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
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
      <div className="grid grid-cols-[60px_1fr_1fr_1fr_1fr] bg-white rounded-2xl overflow-hidden border border-gray-200 shadow-2xl shadow-gray-200/50 relative">


        {/* Categorical Headers */}
        <div className="p-2 border-b border-r border-gray-100 bg-gray-50/50"></div>
        <div className="col-span-2 p-2 border-b border-r border-blue-100 bg-blue-50/50 text-center">
          <span className="text-[12px] font-black text-blue-600 uppercase tracking-widest">醫療團隊</span>
        </div>
        <div className="col-span-2 p-2 border-b border-gray-100 bg-emerald-50/50 text-center">
          <span className="text-[12px] font-black text-emerald-600 uppercase tracking-widest">空間資源</span>
        </div>

        {/* Header Row */}
        <div className="p-4 border-b border-r border-gray-100 bg-gray-50/80"></div>
        {resources.map((res, idx) => (
          <div key={res.name} className={`p-4 border-b border-gray-100 text-center flex items-center justify-center
            ${idx < 2 ? 'bg-blue-50/30 border-r border-blue-100' : 'bg-emerald-50/30 border-r border-emerald-100'}
            ${idx === 1 ? 'border-r-2 border-r-gray-200' : ''}`}
          >
            <p className="text-[13px] font-bold text-gray-900 leading-tight">{res.name}</p>
          </div>
        ))}

        {/* Time Rows */}
        {timeSlots.map((time, timeIdx) => (
          <React.Fragment key={time}>
            <div className="p-4 border-b border-r border-gray-100 bg-gray-100/10 text-center flex items-start justify-center h-28">
              <span className="text-[12px] font-bold text-gray-400 mt-1">{time}</span>
            </div>

            {resources.map((res, resIdx) => (
              <div key={`${time}-${res.name}`} className={`relative border-b border-white h-28 group
                ${resIdx < 2 ? 'bg-blue-50/5 border-r border-blue-50/50' : 'bg-emerald-50/5 border-r border-emerald-50/50'}
                ${resIdx === 1 ? 'border-r-2 border-r-gray-100' : ''}`}
              >
                {/* Visual Context: Existing Appointments */}
                {((resIdx === 1 && timeIdx === 0) || (resIdx === 3 && timeIdx === 0)) && (
                  <div className="absolute inset-x-2 inset-y-2 z-20">
                    <div className={`h-full w-full rounded-xl border-l-4 shadow-md p-3 flex flex-col justify-center
                        ${resIdx === 1 ? 'bg-indigo-50 border-indigo-500' : 'bg-teal-50 border-teal-500'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-gray-900 leading-tight">門診預約</span>
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
                        <span className="text-[11px] font-bold text-gray-900 leading-tight">門診預約</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Scenario 0: Cursor click in target cell (王院長/10:00) */}
                {scenario === 0 && timeIdx === 1 && resIdx === 0 && (
                  <div className={`absolute inset-0 flex items-center justify-center z-50 pointer-events-none transition-all duration-700
                    ${autoState === 'idle' ? 'opacity-0 scale-150 translate-y-8' :
                      autoState === 'clicking' ? 'opacity-100 scale-100 translate-y-0' :
                        'opacity-0 scale-95'}`}
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

                {/* Scenario 0: Linking Animation in 陳醫師/10:00 cell */}
                {scenario === 0 && timeIdx === 1 && resIdx === 1 && autoState === 'created' && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    {/* Horizontal connecting line with arrow */}
                    <div className="relative w-full h-1 mx-1">
                      {/* Line background */}
                      <div
                        className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-400 via-primary-400 to-emerald-400"
                        style={{
                          animation: 'linkLineGrow 0.5s ease-out forwards',
                          transformOrigin: 'left center',
                          transform: 'scaleX(0)',
                        }}
                      />
                      {/* Glow effect */}
                      <div
                        className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-400 via-primary-400 to-emerald-400 blur-sm opacity-60"
                        style={{
                          animation: 'linkLineGrow 0.5s ease-out forwards',
                          transformOrigin: 'left center',
                          transform: 'scaleX(0)',
                        }}
                      />
                      {/* Arrow head at the end */}
                      <div
                        className="absolute -right-2 top-1/2 -translate-y-1/2 text-emerald-500"
                        style={{
                          animation: 'linkArrowFade 0.5s ease-out forwards',
                          opacity: 0,
                        }}
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                        </svg>
                      </div>
                    </div>
                    {/* Inline keyframes */}
                    <style>{`
                      @keyframes linkLineGrow {
                        from { transform: scaleX(0); }
                        to { transform: scaleX(1); }
                      }
                      @keyframes linkArrowFade {
                        0% { opacity: 0; transform: translateY(-50%) translateX(-8px); }
                        50% { opacity: 0; }
                        100% { opacity: 1; transform: translateY(-50%) translateX(0); }
                      }
                    `}</style>
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
                      <span className="text-[11px] font-bold leading-tight">同步移動</span>
                      <div className="mt-2 h-1 w-full bg-white/20 rounded-full overflow-hidden">
                        <div className="h-full bg-white animate-[pulse_1.5s_infinite]" style={{ width: '60%' }}></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Scenario 2: Conflict Prevention - Attempting to book at 09:30 spanning into 10:00 slot */}
                {scenario === 2 && resIdx === 3 && timeIdx === 0 && (
                  <>
                    <div className={`absolute left-2 right-2 top-14 h-24 z-30 rounded-xl border-2 border-dashed flex items-center justify-center transition-all duration-300
                      ${showConflict ? 'bg-red-50 border-red-500 scale-105' : 'bg-transparent border-transparent'}`}
                    >
                      {showConflict && (
                        <div className="text-center p-2">
                          <div className="text-[20px] mb-1 animate-bounce">🚫</div>
                          <span className="text-[10px] font-black text-red-600 uppercase tracking-tighter leading-tight">時段衝突</span>
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

const MedicalRecordMock = ({ scenario }: { scenario: number }) => {
  const [templateIndex, setTemplateIndex] = React.useState(0);

  // Internal auto-switch for templates in scenario 0
  React.useEffect(() => {
    if (scenario !== 0) return;
    const interval = setInterval(() => {
      setTemplateIndex(prev => (prev + 1) % 2);
    }, 2500);
    return () => clearInterval(interval);
  }, [scenario]);

  const templates = [
    {
      title: '初診病歷',
      fields: [
        { label: '患者主訴', type: 'textarea', placeholder: '描述主要不適...' },
        { label: '疼痛評分 (VAS)', type: 'radio', options: ['1', '2', '3', '4', '5'] },
        { label: '過往病史', type: 'checkbox', options: ['過敏', '手術', '慢性病'] }
      ]
    },
    {
      title: '複診追蹤',
      fields: [
        { label: '治療反饋', type: 'textarea', placeholder: '上次治療後狀況...' },
        { label: '改善程度', type: 'radio', options: ['顯著', '穩定', '緩慢'] },
        { label: '今日部位', type: 'checkbox', options: ['頸部', '背部', '腰部'] }
      ]
    },
    { title: '特約評估', fields: [] } // For sidebar display only
  ];

  const renderContent = () => {
    switch (scenario) {
      case 0: // Templates
        return (
          <div key="templates" className="h-full flex flex-col animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="flex flex-1 overflow-hidden">
              {/* Sidebar Tabs */}
              <div className="w-[110px] border-r border-gray-100 bg-gray-50 p-2 space-y-2">
                {templates.map((t, i) => (
                  <div key={i} className={`p-2 rounded-lg text-[11px] font-bold transition-all ${i === templateIndex ? 'bg-white shadow-sm text-primary-600 border border-primary-100' : 'text-gray-400'}`}>
                    {t.title}
                  </div>
                ))}
              </div>
              {/* Dynamic Form Content */}
              <div className="flex-1 p-4 overflow-y-auto bg-white/50">
                {templates[templateIndex] && (
                  <div key={templateIndex} className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-5">
                    <p className="text-sm font-black text-gray-800 border-b border-gray-100 pb-2">{templates[templateIndex].title}</p>
                    {templates[templateIndex].fields.map((field, i) => (
                      <div key={i} className="space-y-2 text-left">
                        <label className="text-xs font-bold text-gray-700 block">{field.label}</label>

                        {field.type === 'textarea' && (
                          <div className="h-16 w-full bg-gray-50 border border-gray-200 rounded-lg p-2">
                            <div className="h-1.5 w-full bg-gray-200 rounded mb-1 animate-pulse" />
                            <div className="h-1.5 w-2/3 bg-gray-200 rounded animate-pulse" />
                          </div>
                        )}

                        {field.type === 'radio' && (
                          <div className="flex gap-2">
                            {field.options?.map(opt => (
                              <div key={opt} className="flex items-center gap-1">
                                <div className="w-3.5 h-3.5 rounded-full border border-gray-300 bg-white" />
                                <span className="text-[11px] text-gray-400">{opt}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {field.type === 'checkbox' && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {field.options?.map(opt => (
                              <div key={opt} className="flex items-center gap-1">
                                <div className="w-3.5 h-3.5 rounded border border-gray-300 bg-white" />
                                <span className="text-[11px] text-gray-400">{opt}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      case 1: // Gallery Timeline (Vertical Scroll)
        return (
          <div key="photos" className="h-full flex flex-col pt-2 animate-in fade-in slide-in-from-right-4 duration-500 overflow-hidden relative">
            <style>{`
              @keyframes slowScrollGallery {
                0% { transform: translateY(0); }
                100% { transform: translateY(-60%); }
              }
            `}</style>

            <div className="flex-1 px-4 sm:px-6">
              <div
                className="space-y-10"
                style={{
                  animation: 'slowScrollGallery 15s linear infinite'
                }}
              >
                {[
                  {
                    date: '2024年1月10日',
                    photos: [
                      { color: 'from-slate-500 to-slate-200', label: 'X光' }
                    ]
                  },
                  {
                    date: '2024年1月24日',
                    photos: [
                      { color: 'from-amber-400 to-amber-50', label: '兩週追蹤' },
                      { color: 'from-orange-400 to-orange-50', label: '日常紀錄' },
                      { color: 'from-amber-300 to-amber-100', label: '療程紀錄' }
                    ]
                  },
                  {
                    date: '2024年2月7日',
                    photos: [
                      { color: 'from-emerald-400 to-emerald-50', label: '術後復原' },
                      { color: 'from-blue-400 to-blue-50', label: '結案追蹤' }
                    ]
                  },
                  // Duplicate for Loop
                  {
                    date: '2024年1月10日',
                    photos: [
                      { color: 'from-slate-500 to-slate-200', label: 'X光' }
                    ]
                  }
                ].map((group, i) => (
                  <div key={i} className="space-y-4">
                    {/* Date Header matching PatientGalleryPage */}
                    <div className="flex items-center gap-3 border-b border-gray-100 pb-2">
                      <div className="w-2 h-2 rounded-full bg-primary-600 shadow-[0_0_8px_rgba(37,99,235,0.4)]"></div>
                      <h2 className="text-sm font-bold text-gray-900">{group.date}</h2>
                      <span className="text-[10px] text-gray-400 font-medium">({group.photos.length} 張)</span>
                    </div>

                    {/* Square Photo Grid */}
                    <div className="grid grid-cols-3 gap-2">
                      {group.photos.map((photo, j) => (
                        <div key={j} className="aspect-square rounded-lg bg-gradient-to-br border border-gray-100 shadow-sm relative overflow-hidden cursor-default">
                          <div className={`absolute inset-0 bg-gradient-to-br ${photo.color}`}></div>

                          {/* Caption footer - Always Visible */}
                          <div className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 py-2.5 px-1">
                            <p className="text-[13px] text-gray-900 font-black truncate text-center leading-none tracking-tight">{photo.label}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Fade overlays for smooth scrolling effect */}
            <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-white via-white/80 to-transparent z-10 pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white via-white/80 to-transparent z-10 pointer-events-none" />
          </div>
        );
      case 2: // History
        return (
          <div key="history" className="h-full flex flex-col animate-in fade-in slide-in-from-right-4 duration-500 overflow-hidden relative">
            <style>{`
              @keyframes slowScrollHistory {
                0% { transform: translateY(0); }
                100% { transform: translateY(-50%); }
              }
            `}</style>

            <div className="p-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white shrink-0 shadow-lg z-20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center text-xl shadow-inner border border-white/20 text-left">👤</div>
                <div>
                  <h3 className="font-bold text-lg leading-tight">王曉明</h3>
                  <p className="text-[10px] text-primary-100 font-medium opacity-80 mt-0.5">病歷號: CLIN-2024-001</p>
                </div>
              </div>
            </div>

            <div className="flex-1 relative bg-gray-50/50 overflow-hidden">
              <div
                className="p-6 space-y-5"
                style={{
                  animation: 'slowScrollHistory 20s linear infinite'
                }}
              >
                {[
                  { date: '2024/02/06', type: '複診追蹤', doc: '陳醫師' },
                  { date: '2024/01/30', type: '病患表單', doc: '系統' },
                  { date: '2024/01/23', type: '初診', doc: '王院長' },
                  { date: '2023/12/15', type: '療程紀錄', doc: '陳醫師' },
                  { date: '2023/11/20', type: '複診追蹤', doc: '陳醫師' },
                  // Duplicate for Loop
                  { date: '2024/02/06', type: '複診追蹤', doc: '陳醫師' },
                  { date: '2024/01/30', type: '病患表單', doc: '系統' },
                  { date: '2024/01/23', type: '初診', doc: '王院長' },
                  { date: '2023/12/15', type: '療程紀錄', doc: '陳醫師' },
                  { date: '2023/11/20', type: '複診追蹤', doc: '陳醫師' },
                ].map((rec, i) => (
                  <div key={i} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:border-primary-200 transition-colors group cursor-pointer text-left">
                    <div className="flex justify-between items-start text-left">
                      <div>
                        <span className="text-[14px] font-black text-gray-400 block mb-1.5">{rec.date}</span>
                        <span className="text-[22px] font-black text-gray-900 leading-tight">{rec.type}</span>
                      </div>
                      <span className="text-[13px] font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded text-left shrink-0">{rec.doc}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Fade overlays for smooth scrolling effect */}
              <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-gray-50/80 to-transparent z-10 pointer-events-none" />
              <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-gray-50/80 to-transparent z-10 pointer-events-none" />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.15)] border border-gray-100 overflow-hidden h-[420px] max-w-lg mx-auto transform transition-all duration-700">
      {renderContent()}
    </div>
  );
};

const AutomationFlowMock = () => {
  return (
    <div className="flex flex-row items-center justify-center gap-3 sm:gap-6 lg:gap-10 py-4 w-full">
      {/* Sequence Card */}
      <div className="bg-white w-[165px] sm:w-48 lg:w-64 h-[250px] sm:h-[320px] lg:h-[400px] rounded-xl sm:rounded-2xl lg:rounded-[2rem] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.1)] lg:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.15)] border border-gray-100 p-3 sm:p-5 lg:p-4 flex flex-col justify-center shrink-0">
        <div className="space-y-5 sm:space-y-8 lg:space-y-10 relative flex flex-col justify-center h-full pl-1 sm:pl-2">
          {[
            { label: '療程結束', time: '觸發', color: 'bg-green-500', icon: '✅' },
            { label: '術後關懷', time: '24h 後', color: 'bg-primary-500', icon: '📱' },
            { label: '滿意度', time: '7天 後', color: 'bg-primary-400', icon: '📊' }
          ].map((step, i, arr) => (
            <div key={i} className="flex items-center gap-4 sm:gap-5 lg:gap-4 relative">
              <div className="relative flex-shrink-0">
                <div className={`w-10 h-10 sm:w-12 sm:h-12 lg:w-16 lg:h-16 ${step.color} rounded-xl sm:rounded-2xl lg:rounded-3xl shadow-md lg:shadow-lg shadow-gray-200/50 flex items-center justify-center text-lg sm:text-xl lg:text-3xl relative z-20`}>
                  {step.icon}
                </div>
                {i < arr.length - 1 && (
                  <div className="absolute top-10 sm:top-12 lg:top-16 left-5 sm:left-6 lg:left-8 w-1 sm:w-1.5 h-6 sm:h-8 lg:h-10 bg-gray-100 z-10 -translate-x-1/2" />
                )}
              </div>
              <div className="relative z-20">
                <p className="text-xs sm:text-sm lg:text-base font-black text-primary-600 uppercase tracking-wider mb-0.5 lg:mb-1">{step.time}</p>
                <p className="text-base sm:text-xl lg:text-3xl font-black text-gray-900 leading-tight">{step.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Message Preview (Phone Style) */}
      <div className="bg-[#7494C0] w-[155px] sm:w-44 lg:w-56 h-[250px] sm:h-[320px] lg:h-[400px] rounded-[1.5rem] sm:rounded-[2rem] lg:rounded-[3rem] p-2 sm:p-3 lg:p-4 shadow-[10px_20px_40px_-10px_rgba(0,0,0,0.3)] lg:shadow-[20px_40px_60px_-15px_rgba(0,0,0,0.5)] flex flex-col justify-center shrink-0 border-4 border-gray-800/20">
        <div className="flex flex-col justify-center h-full">
          {/* Message Bubble - Simplified without avatar/time */}
          <div className="bg-white rounded-2xl rounded-tl-none p-3 sm:p-4 lg:p-4 shadow-lg border border-blue-50 relative w-full">
            <p className="text-sm sm:text-base lg:text-lg text-gray-800 leading-relaxed mb-3">
              <span className="font-bold text-base sm:text-lg lg:text-xl block mb-1">王先生您好：</span>
              術後感覺如何呢？請參考復健指引影片，有任何問題請聯繫診所！
            </p>
            <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden relative group cursor-pointer border border-gray-100 shadow-inner">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-black/40 rounded-full flex items-center justify-center text-white backdrop-blur-sm pl-0.5">
                  <svg className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 fill-current" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const DigitalReceiptMock = () => (
  <div className="flex flex-row items-center justify-center gap-3 sm:gap-6 lg:gap-10 py-4 w-full">
    {/* Physical Receipt Card */}
    <div className="bg-white w-[165px] sm:w-48 lg:w-64 h-[250px] sm:h-[320px] lg:h-[400px] rounded-xl sm:rounded-2xl lg:rounded-[2rem] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.1)] lg:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.15)] border border-gray-100 p-4 sm:p-6 lg:p-8 lg:pb-12 space-y-4 sm:space-y-4 lg:space-y-6 shrink-0">
      <div className="text-center text-lg sm:text-2xl lg:text-4xl border-b sm:border-b-2 border-gray-100 pb-2 lg:pb-4 text-gray-900 tracking-tight font-medium">收據</div>
      <div className="space-y-2 lg:space-y-4 text-xs sm:text-base lg:text-lg">
        <div className="flex justify-between text-gray-600 font-medium"><span>治療費</span><span className="text-gray-900 font-medium">$1,200</span></div>
        <div className="flex justify-between text-gray-600 font-medium"><span>材料費</span><span className="text-gray-900 font-medium">$150</span></div>
        <div className="border-t sm:border-t-2 border-gray-50 pt-2 lg:pt-4 flex justify-between items-baseline font-medium">
          <span className="text-sm sm:text-lg lg:text-xl">總計</span><span className="text-base sm:text-lg lg:text-xl text-primary-600">$1,350</span>
        </div>
      </div>
      <div className="pt-1 flex justify-center">
        <div className="w-16 h-16 sm:w-20 lg:w-24 lg:h-24 border-2 border-red-600 rounded flex items-center justify-center transform relative">
          <div className="text-sm sm:text-base lg:text-xl font-bold text-red-600 leading-tight text-center tracking-tighter">
            <span className="whitespace-nowrap">健康診所</span><br /><span className="whitespace-nowrap">收訖章</span>
          </div>
        </div>
      </div>
    </div>

    {/* Mobile Digital Preview (LIFF) */}
    <div className="w-[155px] sm:w-44 lg:w-56 h-[250px] sm:h-[320px] lg:h-[400px] bg-gray-900 rounded-[1.5rem] sm:rounded-[2rem] lg:rounded-[3rem] p-1 sm:p-2 lg:p-2.5 border-2 sm:border-4 border-gray-800 shadow-[10px_20px_40px_-10px_rgba(0,0,0,0.3)] lg:shadow-[20px_40px_60px_-15px_rgba(0,0,0,0.5)] relative overflow-hidden shrink-0">
      <div className="h-full w-full bg-gray-50 rounded-[1.2rem] sm:rounded-[1.5rem] lg:rounded-[2.5rem] flex flex-col pt-5 sm:pt-6 lg:pt-10 overflow-hidden">
        {/* LIFF Header */}
        <div className="px-3 sm:px-4 lg:px-6 mb-3 sm:mb-4 lg:mb-6">
          <h3 className="text-sm sm:text-lg lg:text-2xl font-medium text-gray-900 leading-tight">我的預約</h3>
        </div>

        <div className="px-2 sm:px-3 lg:px-4">
          <div className="bg-white border border-gray-100 rounded-lg sm:rounded-xl lg:rounded-2xl p-3 sm:p-4 lg:p-6 shadow-sm">
            <div className="mb-2 sm:mb-3 lg:mb-4">
              <h4 className="text-xs sm:text-base lg:text-xl font-medium text-gray-900 leading-tight">王大明</h4>
              <p className="text-[10px] sm:text-sm lg:text-base text-gray-500 font-medium whitespace-nowrap">一般門診</p>
            </div>

            <div className="space-y-1.5 sm:space-y-2 lg:space-y-3 mb-3 sm:mb-4 lg:mb-6">
              <div className="flex items-center text-[10px] sm:text-sm lg:text-base text-gray-600 font-medium">
                <span className="mr-2 sm:mr-2 lg:mr-3 text-sm sm:text-base lg:text-xl opacity-60">👤</span> 李醫師
              </div>
              <div className="flex items-center text-[10px] sm:text-sm lg:text-base text-gray-600 font-medium">
                <span className="mr-2 sm:mr-2 lg:mr-3 text-sm sm:text-base lg:text-xl opacity-60">📅</span> 2/6 14:00
              </div>
            </div>

            <div className="w-full bg-green-100 text-green-800 border-2 border-green-200 rounded-md sm:rounded-lg lg:rounded-xl py-2 sm:py-2.5 lg:py-3.5 text-center text-sm sm:text-base font-bold transition-colors cursor-pointer hover:bg-green-200">
              查看收據
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const FinancialDashboardMock = () => (
  <div className="bg-white rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] p-6 border border-gray-100 space-y-5 max-w-sm mx-auto">
    {/* Key Stats Cards */}
    <div className="w-full">
      {[
        { l: '本月營收', v: '$428,500', c: 'text-primary-600', g: '+18%' }
      ].map(s => (
        <div key={s.l} className="bg-gray-50/50 px-5 py-4 rounded-2xl border border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 font-medium">{s.l}</span>
            <span className={`text-xl lg:text-2xl font-medium ${s.c}`}>{s.v}</span>
          </div>
          <span className="text-sm font-medium text-green-800 bg-green-100 px-2.5 py-1 rounded-full">{s.g}</span>
        </div>
      ))}
    </div>

    {/* Service Breakdown */}
    <div className="space-y-3">
      <div className="flex justify-between items-center text-base">
        <span className="text-gray-900 font-medium">療程項目佔比</span>
      </div>
      <div className="space-y-3">
        {[
          { label: '徒手治療', value: 65, color: 'bg-primary-500' },
          { label: '運動治療', value: 25, color: 'bg-primary-300' },
          { label: '其他', value: 10, color: 'bg-gray-200' }
        ].map((item, i) => (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-sm font-medium text-gray-600">
              <span>{item.label}</span>
              <span>{item.value}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div style={{ width: `${item.value}%` }} className={`h-full ${item.color} rounded-full`}></div>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Practitioner Performance */}
    <div className="space-y-3 pt-1">
      <div className="text-base font-medium text-gray-900">人員業績</div>
      <div className="space-y-3">
        {[
          { name: '李醫師', amount: '$182,400', share: '$63,840' },
          { name: '林治療師', amount: '$124,500', share: '$43,575' }
        ].map((staff, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl border border-gray-100">
            <div className="flex flex-col">
              <span className="text-base font-bold text-gray-900">{staff.name}</span>
              <span className="text-sm text-gray-500 font-medium whitespace-nowrap">業績: {staff.amount}</span>
            </div>
            <div className="text-right">
              <span className="text-base font-bold text-primary-600 block">分潤</span>
              <span className="text-sm text-gray-600 font-bold">{staff.share}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const LINE_THEME = {
  chatBackground: '#8eacda',
  userBubble: '#6fe67c',
};

const AIChatMock = () => {
  const [isScrolledToBottom, setIsScrolledToBottom] = React.useState(true);
  const chatContainerRef = React.useRef<HTMLDivElement>(null);

  const messages = [
    { sender: 'user', text: '請問治療項目' },
    { sender: 'bot', text: '本院提供以下治療項目：\n1. 徒手治療\n2. 運動治療\n3. 運動表現優化\n\n請問您想了解哪一項的細節？' },
    { sender: 'user', text: '徒手治療' },
    { sender: 'bot', text: '徒手治療是由物理治療師透過雙手，針對肌肉、關節、筋膜等軟組織進行放鬆與調整，能有效緩解疼痛並恢復關節活動度。適合落枕、五十肩、下背痛等症狀。\n\n需要幫您預約評估嗎？' }
  ];

  const checkScrollPosition = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;
      setIsScrolledToBottom(isAtBottom);
    }
  };

  React.useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    checkScrollPosition();
    container.addEventListener('scroll', checkScrollPosition);
    window.addEventListener('resize', checkScrollPosition);
    return () => {
      container.removeEventListener('scroll', checkScrollPosition);
      window.removeEventListener('resize', checkScrollPosition);
    };
  }, []);

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] border border-gray-100 overflow-hidden max-w-sm mx-auto h-[500px] flex flex-col">
      {/* LINE Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center shadow-sm z-10">
        <div className="flex items-center flex-1 min-w-0 gap-3">
          <div className="text-gray-900 text-lg">←</div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="font-bold text-sm text-gray-900">健康診所 Line官方帳號</div>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 relative overflow-hidden bg-[#8eacda]">
        <div
          ref={chatContainerRef}
          className="p-4 space-y-4 overflow-y-auto h-full scroll-smooth"
        >
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex items-end ${message.sender === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-500`}
              style={{ animationDelay: `${index * 0.5}s`, animationFillMode: 'both' }}
            >
              {message.sender === 'bot' && (
                <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center mr-2 flex-shrink-0 shadow-sm">
                  <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 relative shadow-sm ${message.sender === 'user' ? 'text-gray-900' : 'bg-white text-gray-900'
                  }`}
                style={{
                  backgroundColor: message.sender === 'user' ? LINE_THEME.userBubble : 'white',
                  borderTopRightRadius: message.sender === 'user' ? '0' : '1rem',
                  borderTopLeftRadius: message.sender === 'bot' ? '0' : '1rem',
                  borderBottomRightRadius: '1rem',
                  borderBottomLeftRadius: '1rem',
                }}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</p>
              </div>
            </div>
          ))}
          <div className="h-4"></div> {/* Spacer for bottom scroll */}
        </div>

        {/* Scroll Indicator */}
        {!isScrolledToBottom && (
          <div
            className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20 cursor-pointer"
            onClick={scrollToBottom}
          >
            <div className="bg-gray-800/60 backdrop-blur-sm rounded-full p-2 shadow-lg animate-bounce text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Message Input Mock */}
      <div className="bg-white p-3 border-t border-gray-200 flex items-center gap-3">
        <div className="w-8 h-8 text-gray-400">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
        </div>
        <div className="flex-1 bg-gray-100 rounded-full h-9 flex items-center px-4 text-xs text-gray-400">
          輸入訊息...
        </div>
        <div className="w-8 h-8 text-blue-500">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
        </div>
      </div>
    </div>
  );
};

const LandingPage: React.FC = () => {
  const [activeLineFeature, setActiveLineFeature] = React.useState(0);
  const [activeSchedulingFeature, setActiveSchedulingFeature] = React.useState(0);
  const [activeMedicalFeature, setActiveMedicalFeature] = React.useState(0);
  const [isPaused, setIsPaused] = React.useState(false);

  React.useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setActiveLineFeature((prev) => (prev + 1) % 3);
      setActiveSchedulingFeature((prev) => (prev + 1) % 3);
      setActiveMedicalFeature((prev) => (prev + 1) % 3);
    }, 5000);
    return () => clearInterval(interval);
  }, [isPaused]);

  const handleHover = (index: number, setter: (i: number) => void) => {
    if (window.matchMedia('(hover: hover)').matches) {
      setter(index);
      setIsPaused(true);
    }
  };

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
          valueProp="24/7 快速預約與自動提醒，最大化診所使用率"
          features={[
            "30秒 Line 預約，降低預約門檻",
            "診前自動提醒，有效降低爽約率。",
            "空檔自動通知，填補閒置人力。"
          ]}
          imageSide="right"
          activeIndex={activeLineFeature}
          onHoverFeature={(index) => handleHover(index, setActiveLineFeature)}
          onLeaveFeature={() => setIsPaused(false)}
          mockup={<LineBookingMock scenario={activeLineFeature} />}
        />

        {/* Section 2: 智慧排班與資源管理 */}
        <FeatureSection
          title="智慧排班與資源管理"
          valueProp="資源最佳化，杜絕撞單與混亂。"
          features={[
            "一鍵預約，自動分配人力、診間、設備",
            "拖拉式排班，關聯資源同步更新。",
            "偵測衝突，避免診間超收。"
          ]}
          imageSide="left"
          bgColor="bg-gray-50"
          activeIndex={activeSchedulingFeature}
          onHoverFeature={(index) => handleHover(index, setActiveSchedulingFeature)}
          onLeaveFeature={() => setIsPaused(false)}
          mockup={<SchedulingMock scenario={activeSchedulingFeature} />}
        />

        {/* Section 3: 專業病歷系統 */}
        <FeatureSection
          title="專業病歷系統"
          valueProp="安全、便利、客製化的雲端病例系統。"
          features={[
            "診所自定義模板，符合多樣場景。",
            "雲端照片管理，安全存取便利。",
            "秒速調閱紀錄，確保治療連續性。"
          ]}
          imageSide="right"
          activeIndex={activeMedicalFeature}
          onHoverFeature={(index) => handleHover(index, setActiveMedicalFeature)}
          onLeaveFeature={() => setIsPaused(false)}
          mockup={<MedicalRecordMock scenario={activeMedicalFeature} />}
        />

        {/* Section 4: 個案關懷與追蹤 */}
        <FeatureSection
          title="個案關懷與追蹤"
          valueProp="自動化關懷，提升病患回診率。"
          features={[
            "根據項目定時，自動發送追蹤訊息。",
            "客製化衛教與治療後關懷內容，提升病患黏著度。"
          ]}
          imageSide="left"
          bgColor="bg-gray-50"
          mockup={<AutomationFlowMock />}
        />

        {/* Section 5: 數位收據與結帳 */}
        <FeatureSection
          title="數位收據與結帳"
          valueProp="數位化結帳，告別繁瑣手寫，提升行政效率。"
          features={[
            "一鍵生成收據，結帳效率倍增。",
            "支援 PDF 與 LINE 傳送，全面無紙化。"
          ]}
          imageSide="right"
          mockup={<DigitalReceiptMock />}
        />

        {/* Section 6: 財務管理與自動分潤 */}
        <FeatureSection
          title="財務管理與自動分潤"
          valueProp="數據決策，一鍵搞定繁瑣分潤。"
          features={[
            "視覺化營收報表，掌握團隊表現。",
            "業績佣金自動結算，薪資不再算錯。"
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
            "診所後台設定知識庫，化身專業客服",
            "僅根據診所提供資訊，精準回覆。",
            "嚴格不做診斷建議"
          ]}
          imageSide="right"
          mockup={<AIChatMock />}
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

