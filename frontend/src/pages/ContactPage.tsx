import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';

const ContactPage: React.FC = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: '',
  });

  // TODO: Replace with actual contact information from environment variables or config
  const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || 'info@example.com';
  const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@example.com';
  const CONTACT_PHONE = import.meta.env.VITE_CONTACT_PHONE || '+886 2 1234-5678';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement form submission - send to backend API or email service
    // Form data will be sent to backend API endpoint when implemented
    alert('感謝您的訊息！我們會盡快與您聯繫。');
    setFormData({ name: '', email: '', message: '' });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicHeader activePath="/contact" />

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 md:py-16">
        <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 md:p-12">
          <div className="text-center mb-8">
            <div className="mx-auto h-20 w-20 flex items-center justify-center rounded-full bg-green-100">
              <span className="text-4xl">📞</span>
            </div>
            <h1 className="mt-6 text-3xl md:text-4xl font-extrabold text-gray-900">
              聯絡我們
            </h1>
          </div>

          <div className="prose max-w-none">
            <p className="text-lg text-gray-600 mb-8">
              我們很樂意為您提供協助！請透過以下方式與我們聯繫。
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mt-10">
              <div className="border border-gray-200 rounded-lg p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">📧 電子郵件</h3>
                <p className="text-gray-600 mb-2">一般詢問：</p>
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-600 hover:text-primary-700">
                  {CONTACT_EMAIL}
                </a>
                <p className="text-gray-600 mt-4 mb-2">技術支援：</p>
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary-600 hover:text-primary-700">
                  {SUPPORT_EMAIL}
                </a>
              </div>

              <div className="border border-gray-200 rounded-lg p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">📱 電話</h3>
                <p className="text-gray-600 mb-2">服務時間：週一至週五 9:00 - 18:00</p>
                <a href={`tel:${CONTACT_PHONE.replace(/\s/g, '')}`} className="text-primary-600 hover:text-primary-700 text-lg font-medium">
                  {CONTACT_PHONE}
                </a>
              </div>
            </div>

            <div className="mt-10 border border-gray-200 rounded-lg p-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">💬 線上表單</h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                    姓名
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="請輸入您的姓名"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                    電子郵件
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="請輸入您的電子郵件"
                  />
                </div>
                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
                    訊息內容
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    required
                    rows={5}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="請輸入您的問題或建議"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-6 py-3 bg-primary-600 text-white font-medium rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  送出訊息
                </button>
              </form>
            </div>

            <div className="mt-10 text-center">
              <Link
                to="/free-trial"
                className="text-primary-600 hover:text-primary-700 font-medium"
              >
                或立即開始免費試用 →
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ContactPage;

