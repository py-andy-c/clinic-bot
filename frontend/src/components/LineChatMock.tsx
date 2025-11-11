import React from 'react';
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
  // Handle empty messages array
  if (!messages || messages.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden max-w-md md:max-w-2xl lg:max-w-3xl mx-auto">
        <div className="bg-white border-b border-gray-200 px-3 md:px-4 py-2.5 md:py-3 flex items-center">
          <div className="flex items-center flex-1 min-w-0">
            <div className="text-gray-900 text-lg mr-2">←</div>
            <div className="flex items-center flex-1 min-w-0">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-base sm:text-lg text-gray-900 truncate">{clinicType}診所Line官方帳號</div>
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
              <div className="font-semibold text-base sm:text-lg text-gray-900 truncate">{clinicType}診所Line官方帳號</div>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Messages - Blue background */}
      <div className="p-3 md:p-4 space-y-1 min-h-[300px] md:min-h-[400px] max-h-[400px] md:max-h-[500px] overflow-y-auto" style={{ backgroundColor: LINE_THEME.chatBackground }}>
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

    </div>
  );
};

export default LineChatMock;

