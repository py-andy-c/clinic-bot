import React from 'react';
import { Link } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';

const FreeTrialPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <PublicHeader activePath="/free-trial" />

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 md:py-16">
        <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 md:p-12">
          <div className="text-center mb-8">
            <div className="mx-auto h-20 w-20 flex items-center justify-center rounded-full bg-primary-100">
              <span className="text-4xl">🎁</span>
            </div>
            <h1 className="mt-6 text-3xl md:text-4xl font-extrabold text-gray-900">
              免費試用
            </h1>
          </div>

          <div className="prose max-w-none">
            <p className="text-lg text-gray-600 mb-6">
              歡迎體驗診所小幫手！我們提供完整的免費試用方案，讓您無風險地體驗所有功能。
            </p>

            <h2 className="text-2xl font-bold text-gray-900 mt-8 mb-4">試用方案內容</h2>
            <ul className="list-disc list-inside space-y-2 text-gray-700 mb-8">
              <li>完整的預約管理系統</li>
              <li>AI 智能客服功能</li>
              <li>病患資料管理</li>
              <li>LINE 官方帳號整合</li>
              <li>無限制的預約數量</li>
              <li>完整的技術支援</li>
            </ul>

            <h2 className="text-2xl font-bold text-gray-900 mt-8 mb-4">如何開始</h2>
            <ol className="list-decimal list-inside space-y-2 text-gray-700 mb-8">
              <li>填寫基本診所資訊</li>
              <li>設定您的 LINE 官方帳號</li>
              <li>開始使用所有功能</li>
              <li>試用期間完全免費，無需信用卡</li>
            </ol>

            <div className="mt-10 text-center">
              {/* TODO: Implement free trial signup flow - connect to clinic signup endpoint */}
              <button 
                onClick={() => {
                  // TODO: Navigate to signup flow or open signup modal
                  window.location.href = '/signup/clinic';
                }}
                className="w-full sm:w-auto px-8 py-3 bg-primary-600 text-white font-medium rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                立即開始免費試用
              </button>
              <p className="mt-4 text-sm text-gray-500 px-4">
                或 <Link to="/contact" className="text-primary-600 hover:text-primary-700">聯絡我們</Link> 了解更多資訊
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default FreeTrialPage;

