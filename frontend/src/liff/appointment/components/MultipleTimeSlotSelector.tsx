import React from 'react';
import { useTranslation } from 'react-i18next';

interface SlotDetails {
  is_recommended?: boolean;
}

interface MultipleTimeSlotSelectorProps {
  availableSlots: string[];
  selectedTimeSlots: string[];
  slotDetails: Map<string, SlotDetails>;
  onTimeSelect: (time: string) => void;
}

const MultipleTimeSlotSelector: React.FC<MultipleTimeSlotSelectorProps> = ({
  availableSlots,
  selectedTimeSlots,
  slotDetails,
  onTimeSelect,
}) => {
  const { t } = useTranslation();
  const MAX_SLOTS = 10;

  const handleKeyDown = (event: React.KeyboardEvent, time: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onTimeSelect(time);
    }
  };

  return (
    <div
      className="grid grid-cols-3 gap-2"
      role="grid"
      aria-label={t('datetime.availableSlots')}
    >
      {[...availableSlots].sort().map((time) => {
        const isRecommended = slotDetails.get(time)?.is_recommended === true;
        const isSelected = selectedTimeSlots.includes(time);
        const isAtMaxSlots = selectedTimeSlots.length >= MAX_SLOTS && !isSelected;

        return (
          <button
            key={time}
            onClick={() => onTimeSelect(time)}
            onKeyDown={(e) => handleKeyDown(e, time)}
            disabled={isAtMaxSlots}
            role="gridcell"
            aria-selected={isSelected}
            aria-disabled={isAtMaxSlots}
            aria-label={`${time}${isSelected ? `, ${t('common.selected')}` : ''}${isRecommended ? `, ${t('datetime.recommended')}` : ''}${isAtMaxSlots ? `, ${t('datetime.maxSlotsReached')}` : ''}`}
            className={`relative bg-white border rounded-md py-2 px-2 transition-colors text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 ${
              isSelected
                ? 'border-primary-500 bg-primary-50 text-primary-700 font-semibold'
                : isAtMaxSlots
                ? 'border-gray-200 text-gray-400 cursor-not-allowed bg-gray-50'
                : isRecommended
                ? 'border-teal-400 border-2 text-gray-900 hover:border-primary-300 hover:bg-primary-50'
                : 'border-gray-200 text-gray-900 hover:border-primary-300 hover:bg-primary-50'
            }`}
          >
            {time}
            {isSelected && (
              <span
                className="absolute -top-2 -right-2 bg-primary-500 text-white text-xs font-medium px-1.5 py-0.5 rounded shadow-sm"
                aria-hidden="true"
              >
                ✓
              </span>
            )}
            {isRecommended && !isSelected && (
              <span
                className="absolute -top-2 -right-2 bg-teal-500 text-white text-xs font-medium px-1.5 py-0.5 rounded shadow-sm"
                aria-hidden="true"
              >
                {t('datetime.recommended')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default MultipleTimeSlotSelector;