import React from 'react';
import { useTranslation } from 'react-i18next';

interface SelectedSlotsDisplayProps {
  selectedTimeSlots: string[];
  onRemoveSlot: (time: string) => void;
  onConfirmSlots: () => void;
}

const SelectedSlotsDisplay: React.FC<SelectedSlotsDisplayProps> = ({
  selectedTimeSlots,
  onRemoveSlot,
  onConfirmSlots,
}) => {
  const { t } = useTranslation();

  if (selectedTimeSlots.length === 0) {
    return null;
  }

  const handleKeyDown = (event: React.KeyboardEvent, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  };

  return (
    <div className="mt-4 p-3 bg-primary-50 border border-primary-200 rounded-md">
      <h4 className="text-sm font-medium text-primary-800 mb-2" id="selected-slots-heading">
        {t('datetime.selectedSlots', { count: selectedTimeSlots.length, max: 10 })}
      </h4>
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-labelledby="selected-slots-heading"
        aria-label={t('datetime.selectedSlotsGroup')}
      >
        {selectedTimeSlots.sort().map((time) => (
          <span
            key={time}
            className="inline-flex items-center px-2 py-1 bg-primary-100 text-primary-800 text-xs font-medium rounded"
          >
            <span aria-hidden="true">{time}</span>
            <button
              onClick={() => onRemoveSlot(time)}
              onKeyDown={(e) => handleKeyDown(e, () => onRemoveSlot(time))}
              className="ml-1 text-primary-600 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 rounded"
              aria-label={`${t('datetime.removeSlot')} ${time}`}
              aria-describedby={`selected-slots-heading`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {/* Proceed Button */}
      <div className="mt-3">
        <button
          onClick={onConfirmSlots}
          onKeyDown={(e) => handleKeyDown(e, onConfirmSlots)}
          className="w-full bg-primary-600 text-white py-3 px-4 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 transition-colors font-medium"
          aria-describedby="selected-slots-heading"
        >
          {t('datetime.confirmSlots', { count: selectedTimeSlots.length })}
        </button>
      </div>
    </div>
  );
};

export default SelectedSlotsDisplay;