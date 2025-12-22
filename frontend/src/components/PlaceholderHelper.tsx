import React, { useState, useRef, useEffect } from 'react';
import { PLACEHOLDERS, MessageType } from '../constants/messageTemplates';

interface PlaceholderHelperProps {
  messageType: MessageType;
  onInsert: (placeholder: string) => void;
  disabled?: boolean;
}

export const PlaceholderHelper: React.FC<PlaceholderHelperProps> = ({
  messageType,
  onInsert,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
      >
        可用變數
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto">
          <div className="p-2">
            <div className="text-xs font-medium text-gray-700 mb-2 px-2">點擊插入變數：</div>
            <div className="space-y-1">
              {allPlaceholders.map((placeholder) => (
                <button
                  key={placeholder.key}
                  type="button"
                  onClick={() => handleInsert(placeholder.key)}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 rounded transition-colors"
                  title={placeholder.description}
                >
                  <div className="font-mono text-blue-600">{placeholder.key}</div>
                  <div className="text-gray-600 text-xs mt-0.5">{placeholder.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

