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

            {/* Try It Out Section with QR Code */}
            <div className="mt-8 sm:mt-12 mb-8 sm:mb-12">
              <div className="inline-flex flex-col items-center bg-white rounded-lg shadow-md p-6 sm:p-8 border border-gray-200">
                <p className="text-xs sm:text-sm text-gray-600 mb-4 text-center max-w-xs">
                  掃描QR碼，從患者視角體驗智能診所助理
                </p>
                <img 
                  src="https://qr-official.line.me/gs/M_769dzbuz_BW.png?oat_content=qr" 
                  alt="Line官方帳號QR碼" 
                  className="w-48 h-48 sm:w-56 sm:h-56 rounded-lg border-2 border-gray-200"
                />
                <p className="text-xs sm:text-sm text-gray-500 mt-4 text-center">
                  Line ID: @769dzbuz
                </p>
              </div>
            </div>

            {/* Call to Action */}
            <div className="mt-4 sm:mt-8">
              <Link
                to="/free-trial"
                className="inline-block w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-3 bg-primary-600 text-white text-base sm:text-lg font-medium rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
              >
                申請診所免費試用
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

          {/* Helpful but Safe Principle */}
          <div className="max-w-3xl mx-auto mt-8 sm:mt-12">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">
                    專業而警慎
                  </h3>
                  <p className="text-sm sm:text-base text-gray-700 leading-relaxed">
                    我們的AI助理以「專業而警慎」為核心原則，提供有價值的健康建議與診所資訊，嚴格遵守醫療安全規範，絕不進行診斷或開立處方。
                  </p>
                </div>
              </div>
            </div>
          </div>
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

          {/* Customization Feature */}
          <div className="max-w-3xl mx-auto mt-8 sm:mt-12">
            <div className="bg-white border border-blue-200 rounded-lg p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">
                    診所客製化
                  </h3>
                  <p className="text-sm sm:text-base text-gray-700 leading-relaxed">
                    診所可自訂聊天機器人，讓AI回答診所專屬的服務項目、營業時間、治療方式等問題，提供更精準的客戶服務。
                  </p>
                </div>
              </div>
            </div>
          </div>
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

      {/* Final CTA Section */}
      <section className="bg-blue-50 py-12 sm:py-16 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <Link
              to="/free-trial"
              className="inline-block w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-3 bg-primary-600 text-white text-base sm:text-lg font-medium rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
            >
              申請診所免費試用
            </Link>
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

