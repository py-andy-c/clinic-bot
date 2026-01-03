import React, { useState, useRef, useEffect } from 'react';

interface FABItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  color?: 'green' | 'blue' | 'purple' | 'orange' | 'red' | 'cyan';
}

interface FloatingActionButtonProps {
  items: FABItem[];
  mainIcon?: React.ReactNode;
  className?: string;
}

const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({ 
  items, 
  mainIcon = '+',
  className = '' 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const fabRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (fabRef.current && !fabRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  const handleMainButtonClick = () => {
    setIsOpen(!isOpen);
  };

  const handleItemClick = (item: FABItem) => {
    item.onClick();
    setIsOpen(false);
  };

  const getColorClasses = (color?: string) => {
    switch (color) {
      case 'green':
        return 'bg-green-600 hover:bg-green-700';
      case 'blue':
        return 'bg-primary-600 hover:bg-primary-700';
      case 'purple':
        return 'bg-purple-600 hover:bg-purple-700';
      case 'orange':
        return 'bg-orange-600 hover:bg-orange-700';
      case 'red':
        return 'bg-red-600 hover:bg-red-700';
      case 'cyan':
        return 'bg-cyan-600 hover:bg-cyan-700';
      default:
        return 'bg-gray-600 hover:bg-gray-700';
    }
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* FAB Container */}
      <div ref={fabRef} className={`fixed bottom-6 right-6 z-50 flex flex-col items-center gap-3 ${className}`}>
        {/* Menu Items */}
        {isOpen && (
          <>
            {items.map((item, index) => (
              <div
                key={item.id}
                className="relative flex items-center animate-slide-up"
                style={{
                  animationDelay: `${index * 50}ms`,
                  animationFillMode: 'both',
                }}
              >
                <button
                  onClick={() => handleItemClick(item)}
                  className="absolute right-14 mr-3 bg-white text-gray-700 px-3 py-1.5 rounded-lg shadow-lg text-sm font-medium whitespace-nowrap text-right hover:bg-gray-50 transition-colors"
                  aria-label={item.label}
                >
                  {item.label}
                </button>
                <button
                  data-testid={`fab-item-${item.id}`}
                  onClick={() => handleItemClick(item)}
                  className={`${getColorClasses(item.color)} text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-transparent focus:ring-white`}
                  aria-label={item.label}
                >
                  {item.icon ? (
                    <span className="flex items-center justify-center w-full h-full">
                      {item.icon}
                    </span>
                  ) : (
                    item.label.charAt(0)
                  )}
                </button>
              </div>
            ))}
          </>
        )}

        {/* Main FAB Button */}
        <button
          data-testid="fab-main-button"
          onClick={handleMainButtonClick}
          className={`bg-primary-600 hover:bg-primary-700 text-white rounded-full w-16 h-16 flex items-center justify-center shadow-lg transition-transform ${isOpen ? 'rotate-45' : 'rotate-0'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-transparent focus:ring-primary-500`}
          aria-label={isOpen ? 'Close menu' : 'Open menu'}
        >
          <span className="text-2xl font-light leading-none">{mainIcon}</span>
        </button>
      </div>
    </>
  );
};

export default FloatingActionButton;

