import React, { useState, useRef, useEffect } from 'react';
import { LINE_THEME } from '../constants/lineTheme';

interface Message {
  sender: 'user' | 'bot';
  text: string;
  time?: string;
}

interface LineChatMockProps {
  /** Array of messages to display in the chat */
  messages: Message[];
  /** Clinic type name to display in header */
  clinicType: string;
}

/**
 * LINE chat UI mock component.
 * Displays a realistic LINE chat interface with messages.
 * 
 * @param messages - Array of chat messages to display
 * @param clinicType - Name of the clinic type for the header
 */
const LineChatMock: React.FC<LineChatMockProps> = ({ messages, clinicType }) => {
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Check if scrolled to bottom
  const checkScrollPosition = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 10; // 10px threshold
      setIsScrolledToBottom(isAtBottom);
    }
  };

  // Set up scroll listener
  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      // Initial check
      checkScrollPosition();
      
      // Add scroll listener
      container.addEventListener('scroll', checkScrollPosition);
      
      // Check on resize
      window.addEventListener('resize', checkScrollPosition);
      
      return () => {
        container.removeEventListener('scroll', checkScrollPosition);
        window.removeEventListener('resize', checkScrollPosition);
      };
    }
    return undefined;
  }, [messages]);

  // Scroll to top when clinic type (tab) changes
  useEffect(() => {
    if (chatContainerRef.current) {
      // Immediately set state to prevent auto-scroll
      setIsScrolledToBottom(false);
      // Force scroll to top
      chatContainerRef.current.scrollTop = 0;
      // Verify scroll position after a brief delay
      setTimeout(() => {
        if (chatContainerRef.current) {
          const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
          const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;
          setIsScrolledToBottom(isAtBottom);
        }
      }, 10);
    }
  }, [clinicType]);

  // Auto-scroll to bottom when new messages are added (if already at bottom)
  // Only auto-scroll if we're not switching tabs (clinicType hasn't changed)
  useEffect(() => {
    if (chatContainerRef.current && isScrolledToBottom) {
      // Check if we're actually at the bottom before auto-scrolling
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;
      if (isAtBottom) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    }
  }, [messages, isScrolledToBottom, clinicType]);

  // Scroll to bottom when arrow is clicked
  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  // Handle empty messages array
  if (!messages || messages.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden max-w-md md:max-w-2xl lg:max-w-3xl mx-auto">
        <div className="bg-white border-b border-gray-200 px-3 md:px-4 py-2.5 md:py-3 flex items-center">
          <div className="flex items-center flex-1 min-w-0">
            <div className="text-gray-900 text-lg mr-2">←</div>
            <div className="flex items-center flex-1 min-w-0">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-base sm:text-lg text-gray-900 truncate">{clinicType}診所 Line官方帳號</div>
              </div>
            </div>
          </div>
        </div>
        <div 
          className="p-3 md:p-4 min-h-[300px] md:min-h-[400px] flex items-center justify-center" 
          style={{ backgroundColor: LINE_THEME.chatBackground }}
        >
          <p className="text-gray-600">暫無訊息</p>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden max-w-md md:max-w-2xl lg:max-w-3xl mx-auto">
      {/* LINE Header - White header style */}
      <div className="bg-white border-b border-gray-200 px-3 md:px-4 py-2.5 md:py-3 flex items-center">
        <div className="flex items-center flex-1 min-w-0">
          <div className="text-gray-900 text-lg mr-2">←</div>
          <div className="flex items-center flex-1 min-w-0">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base sm:text-lg text-gray-900 truncate">{clinicType}診所 Line官方帳號</div>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Messages - Blue background */}
      <div 
        className="relative h-[300px] md:h-[400px]"
        style={{ backgroundColor: LINE_THEME.chatBackground }}
      >
        <div 
          ref={chatContainerRef}
          className="p-3 md:p-4 space-y-1 overflow-y-auto h-full"
        >
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex items-end ${message.sender === 'user' ? 'justify-end' : 'justify-start'} mb-1`}
            >
              {message.sender === 'bot' && (
                <div className="w-6 h-6 md:w-7 md:h-7 bg-gray-300 rounded-full flex items-center justify-center mr-1.5 flex-shrink-0">
                  <svg className="w-4 h-4 md:w-5 md:h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
              <div
                className={`max-w-[75%] md:max-w-[80%] rounded-2xl px-3 md:px-4 py-2 md:py-2.5 relative ${
                  message.sender === 'user'
                    ? 'text-gray-900'
                    : 'bg-white text-gray-900'
                }`}
                style={{
                  ...(message.sender === 'user' 
                    ? {
                        backgroundColor: LINE_THEME.userBubble,
                        borderBottomRightRadius: '4px',
                      }
                    : {
                        borderBottomLeftRadius: '4px',
                      }
                  )
                }}
              >
                <p className="text-base sm:text-lg whitespace-pre-wrap leading-relaxed break-words">
                  {message.text}
                </p>
              </div>
            </div>
          ))}
        </div>
        
        {/* Floating scroll indicator - fixed at bottom of visible area */}
        {!isScrolledToBottom && (
          <div 
            className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 cursor-pointer pointer-events-auto"
            onClick={scrollToBottom}
            role="button"
            aria-label="Scroll to bottom"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                scrollToBottom();
              }
            }}
          >
            <div className="animate-bounce">
              <div className="bg-gray-800 bg-opacity-50 rounded-full p-2 shadow-lg backdrop-blur-sm">
                <svg 
                  className="w-5 h-5 md:w-6 md:h-6 text-white" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default LineChatMock;

