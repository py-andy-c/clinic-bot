import React, { useState, useRef, useEffect } from 'react';
import { ClinicInfo } from '../types';
import { logger } from '../utils/logger';

interface ClinicSwitcherProps {
  currentClinicId: number | null;
  availableClinics: ClinicInfo[];
  onSwitch: (clinicId: number) => Promise<void>;
  isSwitching?: boolean;
}

const ClinicSwitcher: React.FC<ClinicSwitcherProps> = ({
  currentClinicId,
  availableClinics,
  onSwitch,
  isSwitching = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setError(null);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return undefined;
  }, [isOpen]);

  // Close dropdown on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setError(null);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  // Don't show switcher if user has no clinics
  if (!availableClinics || availableClinics.length === 0) {
    return null;
  }

  const currentClinic = availableClinics.find(c => c.id === currentClinicId);
  const otherClinics = availableClinics.filter(c => c.id !== currentClinicId);
  const hasMultipleClinics = availableClinics.length > 1;

  const handleSwitch = async (clinicId: number): Promise<void> => {
    if (clinicId === currentClinicId || isSwitching) {
      return;
    }

    try {
      setError(null);
      await onSwitch(clinicId);
      setIsOpen(false);
    } catch (err: any) {
      logger.error('Clinic switch failed:', err);
      setError(err.message || '切換診所失敗，請稍後再試');
    }
  };


  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => hasMultipleClinics && setIsOpen(!isOpen)}
        disabled={isSwitching}
        className={`
          flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium
          ${isSwitching
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
            : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
          }
          ${hasMultipleClinics ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500' : 'cursor-default'}
        `}
        aria-expanded={hasMultipleClinics ? isOpen : false}
        aria-haspopup={hasMultipleClinics ? "true" : "false"}
      >
        {isSwitching ? (
          <>
            <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>切換中...</span>
          </>
        ) : (
          <>
            <span className="font-semibold">{currentClinic?.display_name || currentClinic?.name || '診所'}</span>
            {hasMultipleClinics && (
              <svg
                className={`h-4 w-4 text-gray-500 transition-transform ${isOpen ? 'transform rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </>
        )}
      </button>

      {isOpen && !isSwitching && (
        <div className="absolute right-0 mt-2 w-80 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
          <div className="py-1" role="menu" aria-orientation="vertical">
            {/* Current Clinic */}
            {currentClinic && (
              <div className="px-4 py-3 bg-primary-50 border-b border-primary-200">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">{currentClinic.display_name || currentClinic.name}</span>
                  <svg className="h-5 w-5 text-primary-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="px-4 py-2 bg-red-50 border-b border-red-200">
                <div className="flex items-center space-x-2">
                  <svg className="h-4 w-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm text-red-800">{error}</span>
                </div>
              </div>
            )}

            {/* Other Clinics */}
            {otherClinics.length > 0 && (
              <div className="py-1">
                {otherClinics.map((clinic) => (
                  <button
                    key={clinic.id}
                    type="button"
                    onClick={() => handleSwitch(clinic.id)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition-colors"
                    role="menuitem"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900 truncate">
                          {clinic.display_name || clinic.name}
                        </span>
                        {!clinic.is_active && (
                          <div className="mt-1 text-xs text-red-600">
                            已停用
                          </div>
                        )}
                      </div>
                      <svg
                        className="h-5 w-5 text-gray-400 flex-shrink-0 ml-2"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* No other clinics message */}
            {otherClinics.length === 0 && (
              <div className="px-4 py-3 text-sm text-gray-500 text-center">
                沒有其他可用的診所
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClinicSwitcher;

