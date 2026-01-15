import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatAppointmentDateOnly } from '../../../utils/calendarUtils';

interface SelectedSlotsDisplayProps {
  selectedTimeSlots: Array<{date: string, time: string}>;
  onRemoveSlot: (date: string, time: string) => void;
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

  // Format date for display using standardized LIFF format

  // Group slots by date
  const groupedSlots = selectedTimeSlots.reduce((acc, slot) => {
    if (!acc[slot.date]) {
      acc[slot.date] = [];
    }
    acc[slot.date]!.push(slot); // Use non-null assertion since we just checked it exists
    return acc;
  }, {} as Record<string, Array<{date: string, time: string}>>);

  return (
    <div className="mt-4 p-3 bg-primary-50 border border-primary-200 rounded-md">
      <h4 className="text-sm font-medium text-primary-800 mb-3" id="selected-slots-heading">
        {t('datetime.selectedSlots', { count: selectedTimeSlots.length, max: 10 })}
      </h4>

      {Object.entries(groupedSlots)
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .map(([date, slots]) => (
          <div key={date} className="mb-3 last:mb-0">
            <div className="text-sm text-primary-700 font-medium mb-2">
              {formatAppointmentDateOnly(date)}
            </div>
            <div
              className="flex flex-wrap gap-1"
              role="group"
              aria-label={`${t('datetime.selectedSlotsGroup')} - ${formatAppointmentDateOnly(date)}`}
            >
              {slots.sort((a, b) => a.time.localeCompare(b.time)).map((slot) => (
                <span
                  key={`${slot.date}-${slot.time}`}
                  className="inline-flex items-center px-2 py-1 bg-primary-100 text-primary-800 text-xs font-medium rounded"
                >
                  <span aria-hidden="true">{slot.time}</span>
                  <button
                    onClick={() => onRemoveSlot(slot.date, slot.time)}
                    onKeyDown={(e) => handleKeyDown(e, () => onRemoveSlot(slot.date, slot.time))}
                    className="ml-1 text-primary-600 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 rounded"
                    aria-label={`${t('datetime.removeSlot')} ${slot.time}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
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