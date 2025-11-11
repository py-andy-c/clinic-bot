import React from 'react';
import { Link } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';

const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <PublicHeader />

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 md:py-16">
        <div className="text-center">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-gray-900 mb-4 sm:mb-6 px-2">
            智慧診所管理系統
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-gray-600 mb-8 sm:mb-12 max-w-3xl mx-auto px-4">
            為您的診所提供完整的預約管理、病患管理與 AI 智能客服解決方案
          </p>

          {/* Call to Action */}
          <div className="mt-8 sm:mt-12">
            <Link
              to="/free-trial"
              className="inline-block w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-3 bg-primary-600 text-white text-base sm:text-sm font-medium rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
            >
              立即開始免費試用
            </Link>
            {/* TODO: Implement free trial signup flow - currently redirects to /free-trial page */}
          </div>

          {/* Features Section */}
          <div className="mt-12 sm:mt-16 md:mt-20 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 max-w-5xl mx-auto px-4">
            <div className="text-center">
              <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-blue-100">
                <span className="text-2xl">📅</span>
              </div>
              <h3 className="mt-4 text-base sm:text-lg font-semibold text-gray-900">預約管理</h3>
              <p className="mt-2 text-sm sm:text-base text-gray-600 px-2">
                完整的線上預約系統，讓病患輕鬆預約
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-purple-100">
                <span className="text-2xl">🤖</span>
              </div>
              <h3 className="mt-4 text-base sm:text-lg font-semibold text-gray-900">AI 智能客服</h3>
              <p className="mt-2 text-sm sm:text-base text-gray-600 px-2">
                24/7 自動回覆病患問題，提升服務品質
              </p>
            </div>
            <div className="text-center sm:col-span-2 md:col-span-1">
              <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-orange-100">
                <span className="text-2xl">👥</span>
              </div>
              <h3 className="mt-4 text-base sm:text-lg font-semibold text-gray-900">病患管理</h3>
              <p className="mt-2 text-sm sm:text-base text-gray-600 px-2">
                集中管理病患資料，提升工作效率
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12 sm:mt-16 md:mt-20">
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

