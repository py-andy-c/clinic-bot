import React, { useEffect } from 'react';
import PublicHeader from '../components/PublicHeader';

const CALENDLY_EVENT_URL = 'https://calendly.com/pychen1017/30min';

const FreeTrialPage: React.FC = () => {
  // Load Calendly widget script
  useEffect(() => {
    // Check if script already exists
    const existingScript = document.querySelector('script[src="https://assets.calendly.com/assets/external/widget.js"]');
    if (existingScript) {
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://assets.calendly.com/assets/external/widget.js';
    script.async = true;
    document.body.appendChild(script);
  }, []);

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
              預約免費示範
            </h1>
            <p className="mt-4 text-lg text-gray-600">
              選擇適合的時間，與我們預約一對一示範會議
            </p>
          </div>

          <div className="calendly-inline-widget" data-url={CALENDLY_EVENT_URL} style={{ minWidth: '320px', height: '700px' }}></div>
        </div>
      </main>
    </div>
  );
};

export default FreeTrialPage;

