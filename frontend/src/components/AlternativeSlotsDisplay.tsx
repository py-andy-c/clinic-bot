import React from 'react';
import { useTranslation } from 'react-i18next';
import moment from 'moment-timezone';

interface AlternativeSlotsDisplayProps {
  currentSlot: string;
  alternativeSlots: string[];
  onSlotSelect: (time: string) => void;
  selectedSlot?: string;
}

const AlternativeSlotsDisplay: React.FC<AlternativeSlotsDisplayProps> = ({
  currentSlot,
  alternativeSlots,
  onSlotSelect,
  selectedSlot,
}) => {
  const { t } = useTranslation();

  // Convert ISO strings to formatted display times
  const formatTimeSlot = (isoString: string) => {
    const momentObj = moment.tz(isoString, 'Asia/Taipei');
    return momentObj.format('YYYY年M月D日 HH:mm');
  };

  // Combine current slot and alternatives, sort chronologically
  const allSlots = [currentSlot, ...alternativeSlots].sort();

  const handleKeyDown = (event: React.KeyboardEvent, slot: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSlotSelect(slot);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-3">
          {t('clinic.timeConfirmation.title', '選擇最終時段')}
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          {t('clinic.timeConfirmation.description', '請選擇最適合的時段，此選擇將成為最終預約時間。')}
        </p>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-700 mb-2">
          {t('clinic.timeConfirmation.availableSlots', '可用時段')}
        </h4>

        <div className="grid gap-2">
          {allSlots.map((slot) => {
            const isCurrentSlot = slot === currentSlot;
            const isSelected = selectedSlot === slot;
            const formattedTime = formatTimeSlot(slot);

            return (
              <button
                key={slot}
                onClick={() => onSlotSelect(slot)}
                onKeyDown={(e) => handleKeyDown(e, slot)}
                className={`w-full text-left p-3 border rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 ${
                  isSelected
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : isCurrentSlot
                    ? 'border-amber-300 bg-amber-50 text-gray-900'
                    : 'border-gray-200 bg-white text-gray-900 hover:border-primary-300 hover:bg-primary-50'
                }`}
                aria-pressed={isSelected}
                aria-label={`${t('clinic.timeConfirmation.selectSlot', '選擇時段')} ${formattedTime}${
                  isCurrentSlot ? ` (${t('clinic.timeConfirmation.currentSlot', '目前時段')})` : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      isSelected
                        ? 'border-primary-500 bg-primary-500'
                        : 'border-gray-300'
                    }`}>
                      {isSelected && (
                        <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-sm">
                        {formattedTime}
                      </div>
                      {isCurrentSlot && (
                        <div className="text-xs text-amber-600 mt-1">
                          {t('clinic.timeConfirmation.currentSlot', '目前時段')}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <svg className="w-5 h-5 text-primary-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">
              {t('clinic.timeConfirmation.note', '注意事項')}
            </h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                {t('clinic.timeConfirmation.noteText', '確認後將立即通知病患，並產生行事曆事件。')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlternativeSlotsDisplay;