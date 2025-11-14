import React, { useState, useRef, useEffect } from 'react';
import { BaseModal } from './calendar/BaseModal';
import { ChatSettings as ChatSettingsType } from '../schemas/api';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

interface ChatTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatSettings: ChatSettingsType;
}

export const ChatTestModal: React.FC<ChatTestModalProps> = ({
  isOpen,
  onClose,
  chatSettings,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Session ID is intentionally not persisted - test sessions are ephemeral
  // and reset when modal closes or settings change. This ensures fresh
  // testing with updated settings.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      // Small delay to ensure modal is fully rendered
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height based on content, with min and max constraints
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 40), 120);
      textarea.style.height = `${newHeight}px`;
    }
  }, [inputText]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setMessages([]);
      setInputText('');
      setSessionId(null);
      setIsLoading(false);
    }
  }, [isOpen]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      text: inputText.trim(),
      isUser: true,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    // Set timeout for request (30 seconds)
    // Use a ref to track if request is still loading when timeout fires
    let timeoutFired = false;
    const timeoutId = setTimeout(() => {
      timeoutFired = true;
      setIsLoading(false);
      const timeoutMessage: Message = {
        id: `error-${Date.now()}`,
        text: "抱歉，我暫時無法處理您的訊息。請稍後再試，或直接聯繫診所。",
        isUser: false,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, timeoutMessage]);
    }, 30000);

    try {
      const response = await apiService.testChatbot({
        message: userMessage.text,
        session_id: sessionId,
        chat_settings: chatSettings,
      });

      clearTimeout(timeoutId);
      
      // Don't process response if timeout already fired
      if (timeoutFired) {
        return;
      }

      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        text: response.response,
        isUser: false,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, aiMessage]);
      setSessionId(response.session_id);
    } catch (err: any) {
      clearTimeout(timeoutId);
      
      // Log error for debugging
      if (err?.response) {
        // Axios error with response
        logger.error('Chat test API error:', err.response.status, err.response.data);
      } else {
        // Other error
        logger.error('Chat test error:', err);
      }
      
      // Use the same error message as the actual LINE endpoint
      const errorMessage = "抱歉，我暫時無法處理您的訊息。請稍後再試，或直接聯繫診所。";
      
      const errorMsg: Message = {
        id: `error-${Date.now()}`,
        text: errorMessage,
        isUser: false,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!isOpen) return null;

  return (
    <BaseModal
      onClose={onClose}
      className="!w-full !h-full !p-0 !mx-0 !rounded-none !pb-4 sm:!max-w-2xl sm:!h-[90vh] sm:!max-h-[800px] sm:!rounded-lg sm:!mx-4 sm:!pb-0 flex flex-col"
      aria-label="測試聊天機器人"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white sm:rounded-t-lg">
        <div className="flex-1">
          <p className="text-sm text-gray-500">
            使用當前設定（含未儲存變更）測試 • 測試模式，不影響實際病患對話 • 需點擊「儲存更變」才會套用
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="關閉"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p className="text-sm">開始對話以測試聊天機器人</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                    message.isUser
                      ? 'bg-[#06C755] text-white'
                      : 'bg-white text-gray-900 border border-gray-200'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {message.text}
                  </p>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl px-4 py-2">
                  <div className="flex items-center gap-0.5 text-sm text-gray-500">
                    <span className="animate-bounce" style={{ animationDelay: '0ms' }}>
                      ●
                    </span>
                    <span className="animate-bounce" style={{ animationDelay: '150ms' }}>
                      ●
                    </span>
                    <span className="animate-bounce" style={{ animationDelay: '300ms' }}>
                      ●
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 pb-6 border-t border-gray-200 bg-white sm:rounded-b-lg sm:pb-4">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="輸入訊息..."
            disabled={isLoading}
            rows={1}
            className="flex-1 resize-none border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755] focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed overflow-y-auto"
            style={{ minHeight: '40px', maxHeight: '120px' }}
            aria-label="輸入測試訊息"
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputText.trim() || isLoading}
            className="px-4 py-2 bg-[#06C755] text-white rounded-lg font-medium text-sm hover:bg-[#05B048] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            傳送
          </button>
        </div>
      </div>
    </BaseModal>
  );
};

