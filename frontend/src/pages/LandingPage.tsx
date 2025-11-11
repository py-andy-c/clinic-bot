import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';
import LineChatMock from '../components/LineChatMock';
import ClinicTypeTabs from '../components/ClinicTypeTabs';
import { consultationMessages } from '../data/consultationMessages';
import { serviceMessages } from '../data/serviceMessages';
import type { ClinicType } from '../data/consultationMessages';

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
              24小時提供專業醫療諮詢，服務病患並抓住潛在客源
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
              AI 智能分析病患需求，提供專業服務建議與療程比較
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
              智能提醒系統，自動通知病患預約時間，有效降低爽約率
            </p>
          </div>

          {/* Value Proposition Content */}
          <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-6 md:p-8">
            <div className="max-w-3xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                <div className="text-center md:text-left">
                  <div className="mx-auto md:mx-0 w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-3xl">📅</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">自動提醒</h3>
                  <p className="text-gray-600 leading-relaxed">
                    系統會在預約前自動發送 LINE 提醒，讓病患不會忘記預約時間。可設定多個提醒時點，確保病患收到通知。
                  </p>
                </div>
                <div className="text-center md:text-left">
                  <div className="mx-auto md:mx-0 w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-3xl">✅</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">降低爽約率</h3>
                  <p className="text-gray-600 leading-relaxed">
                    透過及時提醒與確認機制，有效減少病患忘記或錯過預約的情況，提升診所時間利用率與營運效率。
                  </p>
                </div>
              </div>
              <div className="mt-8 pt-8 border-t border-gray-200">
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-center">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🔔</span>
                    <span className="text-gray-700">預約前 24 小時提醒</span>
                  </div>
                  <div className="hidden sm:block text-gray-300">•</div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">⏰</span>
                    <span className="text-gray-700">預約前 2 小時再次確認</span>
                  </div>
                  <div className="hidden sm:block text-gray-300">•</div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📱</span>
                    <span className="text-gray-700">LINE 即時通知</span>
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

