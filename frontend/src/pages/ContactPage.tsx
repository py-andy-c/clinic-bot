import React from 'react';
import PublicHeader from '../components/PublicHeader';

const ContactPage: React.FC = () => {
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

          <div className="flex justify-center">
            <iframe
              src="https://docs.google.com/forms/d/e/1FAIpQLSfUzvRi72aV-AuyPRqkc9u-GYqblJIs_87-sK25jfmKokaWew/viewform?embedded=true"
              width="640"
              height="821"
              frameBorder="0"
              marginHeight={0}
              marginWidth={0}
              className="w-full max-w-2xl"
              style={{ minHeight: '821px' }}
            >
              Loading…
            </iframe>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ContactPage;

