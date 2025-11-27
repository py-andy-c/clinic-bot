import React from 'react';
import { getPractitionerColor } from '../utils/practitionerColors';

interface Practitioner {
  id: number;
  full_name: string;
}

interface PractitionerChipsProps {
  practitioners: Practitioner[];
  selectedPractitionerIds: number[];
  currentUserId: number | null;
  isPractitioner: boolean;
  onRemove: (practitionerId: number) => void;
}

const PractitionerChips: React.FC<PractitionerChipsProps> = ({
  practitioners,
  selectedPractitionerIds,
  currentUserId,
  isPractitioner,
  onRemove,
}) => {
  // Get selected practitioner names for display
  const selectedPractitioners = practitioners.filter((p) =>
    selectedPractitionerIds.includes(p.id)
  );

  // Calculate all practitioner IDs for color indexing
  const allPractitionerIds = React.useMemo(() => {
    return currentUserId && isPractitioner
      ? [currentUserId, ...selectedPractitionerIds]
      : selectedPractitionerIds;
  }, [currentUserId, isPractitioner, selectedPractitionerIds]);

  // Memoize color calculations for each selected practitioner
  const chipColors = React.useMemo(() => {
    const primaryId = (currentUserId && isPractitioner) ? currentUserId : -1;
    
    return selectedPractitioners.map((p) => {
      const color = getPractitionerColor(p.id, primaryId, allPractitionerIds);
      
      if (!color) {
        // Primary practitioner (only for practitioners) - use blue
        return {
          id: p.id,
          bg: 'bg-blue-100',
          text: 'text-blue-800',
          border: 'border-blue-200',
        };
      }

      // Use the practitioner's color for the chip
      return {
        id: p.id,
        bg: `bg-${color}-100`,
        text: `text-${color}-800`,
        border: `border-${color}-200`,
      };
    });
  }, [selectedPractitioners, currentUserId, isPractitioner, allPractitionerIds]);

  if (selectedPractitioners.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {selectedPractitioners.map((practitioner) => {
        const colorInfo = chipColors.find(c => c.id === practitioner.id);
        return (
          <div
            key={practitioner.id}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${colorInfo?.bg || 'bg-gray-100'} ${colorInfo?.text || 'text-gray-800'} ${colorInfo?.border || 'border-gray-200'} border`}
          >
            <span>{practitioner.full_name}</span>
            <button
              onClick={() => onRemove(practitioner.id)}
              className="ml-0.5 hover:bg-black/10 rounded-full p-0.5 focus:outline-none focus:ring-1 focus:ring-offset-1"
              aria-label={`移除 ${practitioner.full_name}`}
            >
              <span className="text-xs">×</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default PractitionerChips;

