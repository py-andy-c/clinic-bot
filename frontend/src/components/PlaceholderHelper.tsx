import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PLACEHOLDERS, MessageType } from '../constants/messageTemplates';

interface PlaceholderHelperProps {
  messageType: MessageType;
  onInsert: (placeholder: string) => void;
  disabled?: boolean;
  clinicInfoAvailability?: {
    has_address?: boolean;
    has_phone?: boolean;
  };
}

export const PlaceholderHelper: React.FC<PlaceholderHelperProps> = ({
  messageType,
  onInsert,
  disabled = false,
  clinicInfoAvailability,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Update dropdown position on scroll/resize when open
  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    
    const updatePosition = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      // For fixed positioning, use viewport coordinates
      setPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    };
    
    // Update position on scroll/resize
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const allPlaceholders = [
    ...PLACEHOLDERS.common,
    ...(messageType === 'reminder' ? [] : PLACEHOLDERS.confirmation),
  ];

  const handleInsert = (placeholder: string) => {
    onInsert(placeholder);
    setIsOpen(false);
  };

  const handleToggle = () => {
    if (!isOpen && buttonRef.current) {
      // Calculate position immediately when opening
      // For fixed positioning, use viewport coordinates (getBoundingClientRect)
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4, // 4px gap below button
        left: rect.left,
      });
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  return (
    <>
      <div className="relative flex items-center">
        <button
          ref={buttonRef}
          type="button"
          onClick={handleToggle}
          disabled={disabled}
          className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
        >
          可用變數
        </button>
      </div>

      {isOpen && typeof document !== 'undefined' && document.body && createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-64 bg-white border border-gray-200 rounded-lg shadow-lg"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            zIndex: 9999,
          }}
        >
          <div className="p-2">
            <div className="text-xs font-medium text-gray-700 mb-2 px-2">
              點擊插入變數
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {allPlaceholders.map((placeholder, index) => {
                // Check if this placeholder is unavailable
                const isOptional = (placeholder as any).optional === true;
                const isUnavailable = isOptional && (
                  (placeholder.key === '{診所地址}' && !clinicInfoAvailability?.has_address) ||
                  (placeholder.key === '{診所電話}' && !clinicInfoAvailability?.has_phone)
                );
                
                const unavailableTooltip = isUnavailable
                  ? placeholder.key === '{診所地址}'
                    ? '診所尚未設定地址，請至診所設定頁面設定'
                    : '診所尚未設定電話，請至診所設定頁面設定'
                  : placeholder.description;
                
                return (
                  <button
                    key={`${placeholder.key}-${index}`}
                    type="button"
                    onClick={() => !isUnavailable && handleInsert(placeholder.key)}
                    disabled={isUnavailable}
                    className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors ${
                      isUnavailable
                        ? 'opacity-75 cursor-not-allowed'
                        : 'hover:bg-blue-50 cursor-pointer'
                    }`}
                    data-placeholder-key={placeholder.key}
                    data-placeholder-index={index}
                  >
                    <div className="flex items-center gap-1">
                      <span className={`font-mono ${isUnavailable ? 'text-gray-500' : 'text-blue-600'}`}>
                        {placeholder.key}
                      </span>
                    </div>
                    <div className={`text-xs mt-0.5 ${isUnavailable ? 'text-gray-500' : 'text-gray-600'}`}>
                      {isUnavailable ? unavailableTooltip : placeholder.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

