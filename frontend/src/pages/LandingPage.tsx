import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';
import LineChatMock from '../components/LineChatMock';
import ClinicTypeTabs from '../components/ClinicTypeTabs';
import { consultationMessages } from '../data/consultationMessages';
import { serviceMessages } from '../data/serviceMessages';
import type { ClinicType } from '../data/consultationMessages';
import { LINE_THEME } from '../constants/lineTheme';

const LandingPage: React.FC = () => {
  const [consultationTab, setConsultationTab] = useState<ClinicType>('物理治療');
  const [serviceTab, setServiceTab] = useState<ClinicType>('物理治療');

  const clinicTypes: ClinicType[] = ['物理治療', '醫美', '牙醫'];

  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      {/* Hero Section - Light Blue */}
      <section className="bg-blue-50 py-8 sm:py-12 md:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-gray-900 mb-4 sm:mb-6 px-2">
              全天候智能診所助理
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-gray-600 mb-8 sm:mb-12 max-w-3xl mx-auto px-4">
              透過診所LINE官方帳號，提供諮詢、客服、到預約的全自動化服務
            </p>

            {/* Call to Action */}
            <div className="mt-8 sm:mt-12">
              <Link
                to="/free-trial"
                className="inline-block w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-3 bg-primary-600 text-white text-base sm:text-lg font-medium rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
              >
                免費試用
              </Link>
              {/* TODO: Implement free trial signup flow - currently redirects to /free-trial page */}
            </div>
          </div>
        </div>
      </section>

      {/* 線上諮詢 Section - White */}
      <section className="bg-white py-12 sm:py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              線上諮詢
            </h2>
            <p className="text-base sm:text-lg text-gray-600 max-w-2xl mx-auto">
              24小時提供初步諮詢，抓住潛在客源
            </p>
          </div>

          {/* Tabs */}
          <ClinicTypeTabs
            types={clinicTypes}
            activeType={consultationTab}
            onChange={setConsultationTab}
            ariaLabel="選擇診所類型以查看諮詢範例"
          />

          {/* Chat Mock */}
          <LineChatMock
            messages={consultationMessages[consultationTab] || []}
            clinicType={consultationTab}
          />
        </div>
      </section>

      {/* 智能客服 Section - Light Blue */}
      <section className="bg-blue-50 py-12 sm:py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              智能客服
            </h2>
            <p className="text-base sm:text-lg text-gray-600 max-w-2xl mx-auto">
              24小時智能客服，從需求分析到療程選擇，提升轉換率
            </p>
          </div>

          {/* Tabs */}
          <ClinicTypeTabs
            types={clinicTypes}
            activeType={serviceTab}
            onChange={setServiceTab}
            ariaLabel="選擇診所類型以查看服務比較範例"
          />

          {/* Chat Mock */}
          <LineChatMock
            messages={serviceMessages[serviceTab] || []}
            clinicType={serviceTab}
          />
        </div>
      </section>

      {/* 預約管理 Section - White */}
      <section className="bg-white py-12 sm:py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              預約管理
            </h2>
            <p className="text-base sm:text-lg text-gray-600 max-w-2xl mx-auto">
              智能預約管理，提升診所時間利用率
            </p>
          </div>

          {/* Value Proposition Content */}
          <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-6 md:p-8">
            <div className="max-w-4xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
                {/* Value Proposition 1: Convenient Booking */}
                <div className="text-center">
                  <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-3xl">📱</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">LINE預約 降低預約門檻</h3>
                  
                  {/* Mock UI: Time Selection */}
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 max-w-[280px] mx-auto">
                    <div className="bg-gray-50 rounded-lg p-3 mb-2">
                      <div className="text-xs text-gray-500 mb-2">選擇預約時間</div>
                      <div className="grid grid-cols-3 gap-2">
                        <button className="bg-blue-500 text-white text-xs py-2 px-2 rounded">10:00</button>
                        <button className="bg-gray-200 text-gray-700 text-xs py-2 px-2 rounded">10:30</button>
                        <button className="bg-gray-200 text-gray-700 text-xs py-2 px-2 rounded">11:00</button>
                        <button className="bg-gray-200 text-gray-700 text-xs py-2 px-2 rounded">11:30</button>
                        <button className="bg-gray-200 text-gray-700 text-xs py-2 px-2 rounded">14:00</button>
                        <button className="bg-gray-200 text-gray-700 text-xs py-2 px-2 rounded">14:30</button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="flex-1 bg-gray-200 text-gray-700 text-xs py-2 rounded">取消</button>
                      <button className="flex-1 bg-blue-500 text-white text-xs py-2 rounded">確認</button>
                    </div>
                  </div>
                </div>

                {/* Value Proposition 2: Appointment Reminders */}
                <div className="text-center">
                  <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-3xl">🔔</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">診前提醒 降低爽約率</h3>
                  
                  {/* Mock UI: Reminder Message */}
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 max-w-[280px] mx-auto" style={{ backgroundColor: LINE_THEME.chatBackground }}>
                    <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-6 h-6 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <span className="text-xs font-semibold text-gray-900">診所 Line官方帳號</span>
                      </div>
                      <div className="text-sm text-gray-900">
                        🔔 提醒您，明天 10:00 AM 有預約
                      </div>
                    </div>
                  </div>
                </div>

                {/* Value Proposition 3: Cancellation Notifications */}
                <div className="text-center">
                  <div className="mx-auto w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-3xl">⚡</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">空檔通知 提升利用率</h3>
                  
                  {/* Mock UI: Cancellation Notification Message */}
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 max-w-[280px] mx-auto" style={{ backgroundColor: LINE_THEME.chatBackground }}>
                    <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-6 h-6 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <span className="text-xs font-semibold text-gray-900">診所 Line官方帳號</span>
                      </div>
                      <div className="text-sm text-gray-900">
                        ⚡ 明天 2:00 PM 時段有新的空檔，是您之前想預約的時間，要幫您預約嗎？
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="text-center text-sm sm:text-base text-gray-600">
            <p>&copy; {new Date().getFullYear()} 診所小幫手. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;

