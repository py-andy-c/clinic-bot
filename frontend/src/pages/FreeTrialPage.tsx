import React, { useEffect, useRef } from 'react';
import PublicHeader from '../components/PublicHeader';

const CALENDLY_EVENT_URL = 'https://calendly.com/pychen1017/30min';

// TypeScript declaration for Calendly
declare global {
  interface Window {
    Calendly?: {
      initInlineWidget: (options: { url: string; parentElement: HTMLElement | null }) => void;
    };
  }
}

const FreeTrialPage: React.FC = () => {
  const widgetRef = useRef<HTMLDivElement>(null);

  // Load Calendly widget script and initialize widget
  useEffect(() => {
    const initCalendly = () => {
      if (window.Calendly && widgetRef.current) {
        // Clear any existing content
        widgetRef.current.innerHTML = '';
        // Initialize the widget
        window.Calendly.initInlineWidget({
          url: CALENDLY_EVENT_URL,
          parentElement: widgetRef.current,
        });
      }
    };

    // Check if script already exists
    const existingScript = document.querySelector('script[src="https://assets.calendly.com/assets/external/widget.js"]');
    
    if (existingScript) {
      // Script already loaded, initialize widget
      if (window.Calendly) {
        initCalendly();
      } else {
        // Wait for Calendly to be available
        const checkCalendly = setInterval(() => {
          if (window.Calendly) {
            initCalendly();
            clearInterval(checkCalendly);
          }
        }, 100);
        
        return () => clearInterval(checkCalendly);
      }
    } else {
      // Load the script
      const script = document.createElement('script');
      script.src = 'https://assets.calendly.com/assets/external/widget.js';
      script.async = true;
      script.onload = () => {
        initCalendly();
      };
      document.body.appendChild(script);
    }

    // Cleanup: clear widget on unmount
    const currentWidgetRef = widgetRef.current;
    return () => {
      if (currentWidgetRef) {
        currentWidgetRef.innerHTML = '';
      }
    };
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
              預約免費試用
            </h1>
          </div>

          <div ref={widgetRef} style={{ minWidth: '320px', height: '700px' }}></div>
        </div>
      </main>
    </div>
  );
};

export default FreeTrialPage;

